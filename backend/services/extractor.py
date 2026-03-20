"""
Extraction service for procurement sourcing agent.
Uses Claude API to extract/translate structured requirements from free-text requests.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

import anthropic

from backend.config import ANTHROPIC_API_KEY, AGENT_MODEL, AGENT_MAX_TOKENS, EXTRACTOR_MODEL

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY or "missing")

# Simple extraction cache to avoid re-extracting identical text
_extraction_cache: dict[int, dict[str, Any]] = {}

def _get_base_system_prompt() -> str:
    from datetime import date
    today = date.today().isoformat()
    return (
        "You are a procurement requirement extraction specialist. "
        f"TODAY'S DATE IS {today}. Use this for all date calculations. "
        "The current year is " + str(date.today().year) + ". "
        "Extract structured procurement data from the request text provided. "
        "If the text is not in English, translate it first and include both the "
        "original text and your English translation in the output.\n\n"

        "CRITICAL RULES FOR PARSING:\n"
        "1. DAYS vs QUANTITY: 'days' mentioned in context like 'within 30 days', "
        "'needed in 15 days', 'days until required' refer to DELIVERY TIMELINE, NOT quantity. "
        "Only count days as quantity if the request is explicitly for consulting days "
        "(e.g., '200 consulting days'). If someone says '500 units, needed in 30 days', "
        "quantity=500, and required_by_date = today + 30 days.\n"
        "2. BUDGET vs QUANTITY: These are COMPLETELY INDEPENDENT fields. NEVER confuse them.\n"
        "   - '500 windows and 500k budget' → quantity=500, budget_amount=500000. TOTALLY DIFFERENT numbers.\n"
        "   - '200 laptops, budget 50k' → quantity=200, budget_amount=50000.\n"
        "   - The 'k' suffix means ×1000 and ONLY applies to the exact token it's attached to.\n"
        "   - '500' is five hundred. '500k' is five hundred thousand. They are NOT the same.\n"
        "   - NEVER set budget_min/budget_max unless the user gives an EXPLICIT range like '400k-600k'.\n"
        "   - '+/- X%' means a TOLERANCE, not a range. '500k +/- 11%' means budget_amount=500000, budget_min=445000, budget_max=555000.\n"
        "   - If no range or tolerance is stated, set budget_min=null, budget_max=null.\n"
        "   - There is NEVER a contradiction between quantity and budget. They measure different things.\n"
        "   - '500 items at 500k budget' = 500 items, 500000 budget. Unit price = 1000/item. That is NORMAL.\n"
        "3. DATES: When the user says 'in X days' or 'within X days', calculate "
        f"required_by_date = {today} + X days (in YYYY-MM-DD format). "
        "When they say 'by next month', calculate the last day of next month. "
        "When they say a specific date, use that date directly.\n\n"

        "Return ONLY a JSON object with the following keys (use null for any field "
        "you cannot determine from the text):\n"
        "- category_l1: top-level procurement category (e.g. 'IT', 'Professional Services', "
        "'Facilities', 'Marketing')\n"
        "- category_l2: sub-category (e.g. 'Cloud Compute', 'IT Project Management Services')\n"
        "- category_confidence: a float between 0.0 and 1.0 indicating how confident you are "
        "in the category match\n"
        "- quantity: numeric quantity of items/units requested (NOT days unless explicitly consulting days)\n"
        "- unit_of_measure: unit for the quantity (e.g. 'units', 'consulting_day', 'instance_hour')\n"
        "- budget_amount: numeric budget amount (the total budget, not unit price)\n"
        "- budget_min: minimum budget if a range is given\n"
        "- budget_max: maximum budget if a range is given\n"
        "- quantity_inferred: boolean, true if quantity was guessed/inferred rather than explicitly stated\n"
        "- quantity_confidence: one of 'high', 'medium', 'low'\n"
        "- quantity_dimensions: list of objects, each with {dimension: string, quantity: number, unit: string}. "
        "Use when the request mentions multiple distinct dimensions "
        "(e.g., '8 consulting days and 50 devices' → "
        "[{\"dimension\": \"service\", \"quantity\": 8, \"unit\": \"consulting_day\"}, "
        "{\"dimension\": \"goods\", \"quantity\": 50, \"unit\": \"devices\"}]). "
        "Do NOT put delivery timeline days as a quantity dimension. "
        "If only one dimension, still include it in the list.\n"
        "- currency: currency code (e.g. 'EUR', 'USD', 'CHF')\n"
        "- country: requester country code (e.g. 'DE', 'FR', 'US')\n"
        "- delivery_countries: list of country codes where delivery is needed\n"
        "- required_by_date: date string in YYYY-MM-DD format\n"
        "- days_until_required: integer number of days from today until required\n"
        "- preferred_supplier: name of preferred supplier if mentioned\n"
        "- urgency_level: one of 'low', 'medium', 'high', 'critical'\n"
        "- special_requirements: list of strings for any special requirements "
        "(e.g. data residency, ESG, certifications)\n"
        "- data_residency_constraint: boolean, true if data residency is mentioned\n"
        "- esg_requirement: boolean, true if ESG/sustainability requirements are mentioned\n"
        "- original_language: ISO language code of the original text\n"
        "- original_text: the original text if not English, otherwise null\n"
        "- translated_text: English translation if original was not English, otherwise null\n"
        "- budget_confidence: one of 'high', 'medium', 'low' (high if explicit exact amount given, medium if a range or approximate, low if inferred or unclear)\n"
        "- budget_source: one of 'text', 'structured' (text if budget was extracted from free text, structured if it came from a form field)\n"
        "- title: a short title summarizing the request\n\n"
        "For budget ranges like '50k-100k', set budget_min=50000, budget_max=100000. "
        "For 'around 40k', set budget_min=36000, budget_max=44000 (+/-10%). "
        "Set budget_amount to the midpoint. "
        "If quantity is not explicit, infer it. For campaigns/projects/services, default to 1. "
        "Always set quantity_inferred and quantity_confidence.\n\n"
        "Return ALL mentioned delivery countries in the delivery_countries list, not just one.\n"
    )


def _classify_query(text: str) -> tuple[bool, str | None]:
    """Classify whether a query is a valid procurement request.

    Returns:
        (is_procurement, rejection_message) — if not procurement, rejection_message is set.
    """
    lower = text.lower()

    _REJECTION_MSG = (
        "Sorry, your request can't be processed. "
        "A contact agent will reach out to you immediately."
    )

    # Profanity check
    profanity_words = [
        "fuck", "shit", "damn", "ass", "bitch", "bastard", "crap",
        "hell", "dick", "piss",
    ]
    for word in profanity_words:
        if re.search(rf"\b{re.escape(word)}\b", lower):
            return False, _REJECTION_MSG

    # Complaints check
    complaint_phrases = [
        "complaint", "not happy", "dissatisfied", "terrible service",
    ]
    for phrase in complaint_phrases:
        if phrase in lower:
            return False, _REJECTION_MSG

    # Status inquiries
    status_phrases = [
        "where is my order", "tracking", "order status", "shipment status",
    ]
    for phrase in status_phrases:
        if phrase in lower:
            return False, _REJECTION_MSG

    # Off-topic
    offtopic_phrases = [
        "weather", "joke", "tell me a joke", "what time", "who are you",
    ]
    for phrase in offtopic_phrases:
        if phrase in lower:
            return False, _REJECTION_MSG

    return True, None


def _normalize_shorthand(text: str) -> str:
    """Normalize shorthand notations in the request text.

    Instead of silently expanding numbers (which confuses the LLM when
    '500 units' and '500k budget' coexist), we annotate expansions so the
    LLM sees the original AND the expanded form.

    - 50k / 50K → 50k (=50,000)
    - 2M / 2m → 2M (=2,000,000)
    - SQM → square meters, pcs → pieces, qty → quantity
    """
    def _annotate_k(m: re.Match) -> str:
        num = int(m.group(1))
        return f"{num},000 [BUDGET:{num}k]"

    def _annotate_m(m: re.Match) -> str:
        num = int(m.group(1))
        return f"{num},000,000 [BUDGET:{num}M]"

    text = re.sub(r"(\d+)\s*[Kk]\b", _annotate_k, text)
    text = re.sub(r"(\d+)\s*[Mm]\b", _annotate_m, text)

    # Common abbreviations (case-insensitive, word boundaries)
    text = re.sub(r"\bSQM\b", "square meters", text, flags=re.IGNORECASE)
    text = re.sub(r"\bpcs\b", "pieces", text, flags=re.IGNORECASE)
    text = re.sub(r"\bqty\b", "quantity", text, flags=re.IGNORECASE)

    return text


def _build_system_prompt(valid_categories: list[tuple[str, str]] | None = None) -> str:
    """Build system prompt, optionally injecting valid category pairs."""
    prompt = _get_base_system_prompt()
    if valid_categories:
        cat_list = "\n".join(f"  - {l1} / {l2}" for l1, l2 in valid_categories)
        prompt += (
            "\nIMPORTANT: You MUST set category_l1 and category_l2 to one of these exact "
            "category pairs. "
            "If the request genuinely does not fit any valid category pair, return null for "
            "both category_l1 and category_l2. Also return category_confidence as a float "
            "between 0.0 and 1.0 indicating how confident you are in the category match. "
            "If the request is for physical goods, map to Facilities. "
            "If it involves technology/devices, map to IT. "
            "If it involves consulting/services, map to Professional Services.\n"
            f"Valid categories:\n{cat_list}\n"
        )
    return prompt


def _fuzzy_match_category(
    extracted_l1: str | None,
    extracted_l2: str | None,
    valid_pairs: list[tuple[str, str]],
    confidence: float = 1.0,
) -> tuple[str | None, str | None, float]:
    """Return a valid category pair with confidence. May return (None, None, 0.0) if no match."""
    if confidence < 0.3 or (extracted_l1 is None and extracted_l2 is None):
        return None, None, 0.0

    if not valid_pairs:
        return extracted_l1 or "Facilities", extracted_l2 or "Office Chairs", confidence

    # Check for exact match first
    for l1, l2 in valid_pairs:
        if l1 == extracted_l1 and l2 == extracted_l2:
            return l1, l2, confidence

    # Try matching l2 exactly (l1 might be wrong)
    if extracted_l2:
        for l1, l2 in valid_pairs:
            if l2.lower() == extracted_l2.lower():
                return l1, l2, confidence * 0.8

    # Try substring match on l2
    if extracted_l2:
        needle = extracted_l2.lower()
        for l1, l2 in valid_pairs:
            if needle in l2.lower() or l2.lower() in needle:
                return l1, l2, confidence * 0.8

    # Try matching l1 and pick first l2 under it
    if extracted_l1:
        for l1, l2 in valid_pairs:
            if l1.lower() == extracted_l1.lower():
                return l1, l2, confidence * 0.8

    # Try word overlap between extracted values and valid category names
    search_terms = set()
    if extracted_l1:
        search_terms.update(extracted_l1.lower().split())
    if extracted_l2:
        search_terms.update(extracted_l2.lower().split())

    if search_terms:
        best_score = 0
        best_pair = valid_pairs[0]
        for l1, l2 in valid_pairs:
            cat_words = set(l1.lower().split()) | set(l2.lower().split())
            overlap = len(search_terms & cat_words)
            if overlap > best_score:
                best_score = overlap
                best_pair = (l1, l2)
        if best_score > 0:
            return best_pair[0], best_pair[1], confidence * 0.8

    # No match found — do NOT fall back to first pair
    logger.warning(
        "No category match found for %s/%s — returning None with confidence %.2f",
        extracted_l1, extracted_l2, confidence,
    )
    return None, None, confidence


def _parse_json_response(text: str) -> dict:
    """Extract JSON from Claude response, handling markdown code blocks."""
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    return json.loads(text)


def extract_requirements(
    request_text: str,
    optional_fields: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Extract structured procurement requirements from free-text input.

    Args:
        request_text: The free-text procurement request.
        optional_fields: Optional dict of field overrides to apply after extraction.

    Returns:
        A dict that can populate a request-like object for the pipeline, with keys
        matching the request JSON schema (request_id, category_l1, category_l2, etc.).
    """
    # Classify the query first
    is_procurement, rejection_message = _classify_query(request_text)
    if not is_procurement:
        return {
            "is_rejected": True,
            "rejection_message": rejection_message,
        }

    if optional_fields is None:
        optional_fields = {}

    # Check extraction cache
    cache_key = hash(request_text)
    if cache_key in _extraction_cache:
        cached = _extraction_cache[cache_key].copy()
        for key, value in optional_fields.items():
            if value is not None:
                cached[key] = value
        return cached

    # Normalize shorthand before sending to Claude
    normalized_text = _normalize_shorthand(request_text)

    # Load valid categories for constrained extraction
    from backend.data_loader import get_data
    data = get_data()
    valid_pairs = list(data.categories_lookup.keys())  # list of (l1, l2) tuples
    system_prompt = _build_system_prompt(valid_pairs if valid_pairs else None)

    user_prompt = (
        "Extract structured procurement requirements from the following request text:\n\n"
        f"{normalized_text}"
    )

    try:
        response = client.messages.create(
            model=EXTRACTOR_MODEL,
            max_tokens=AGENT_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_text = response.content[0].text
        extracted = _parse_json_response(raw_text)

        # Post-validate: fuzzy-match category if it doesn't match valid pairs
        if valid_pairs:
            extracted_confidence = extracted.get("category_confidence", 1.0)
            if extracted_confidence is None:
                extracted_confidence = 1.0
            matched_l1, matched_l2, match_confidence = _fuzzy_match_category(
                extracted.get("category_l1"),
                extracted.get("category_l2"),
                valid_pairs,
                confidence=float(extracted_confidence),
            )
            if matched_l1 != extracted.get("category_l1") or matched_l2 != extracted.get("category_l2"):
                logger.info(
                    "Category corrected: %s/%s -> %s/%s",
                    extracted.get("category_l1"), extracted.get("category_l2"),
                    matched_l1, matched_l2,
                )
            extracted["category_l1"] = matched_l1
            extracted["category_l2"] = matched_l2
            extracted["category_confidence"] = match_confidence
    except Exception:
        logger.exception("Claude extraction failed, returning minimal result")
        extracted = {}

    # POST-EXTRACTION SANITY: fix budget/quantity confusion
    budget_amt = extracted.get("budget_amount")
    budget_min = extracted.get("budget_min")
    budget_max = extracted.get("budget_max")
    qty = extracted.get("quantity")

    # Pattern 1: budget_min equals quantity and budget_max >> budget_min (fake range)
    if (budget_min is not None and budget_max is not None and qty is not None
            and budget_min == qty and budget_max != budget_min
            and budget_max / max(budget_min, 1) > 10):
        logger.info("Budget/quantity confusion fix: budget_min=%s==qty, budget_max=%s. Using budget_max.", budget_min, budget_max)
        extracted["budget_amount"] = budget_max
        extracted["budget_min"] = None
        extracted["budget_max"] = None
        extracted["budget_confidence"] = "high"
        budget_amt = budget_max

    # Pattern 2: budget_amount equals quantity (small number) but budget_max is large
    if (budget_amt is not None and qty is not None
            and budget_amt == qty and budget_amt < 10000
            and budget_max and budget_max > budget_amt * 10):
        extracted["budget_amount"] = budget_max
        extracted["budget_min"] = None
        extracted["budget_max"] = None
        budget_amt = budget_max

    # Pattern 3: budget range spans from quantity to a much larger number
    # e.g., quantity=500, budget_min=500, budget_max=500000 — the 500 is quantity not budget
    if (budget_min is not None and budget_max is not None
            and budget_min < 10000 and budget_max > 100000
            and budget_max / max(budget_min, 1) > 50):
        logger.info("Budget range too wide (%s to %s), likely quantity confusion. Using budget_max.", budget_min, budget_max)
        extracted["budget_amount"] = budget_max
        extracted["budget_min"] = None
        extracted["budget_max"] = None
        budget_amt = budget_max

    # Pattern 4: quantity got inflated to match budget (e.g., qty=500000 when user said "500 items, 500k budget")
    if (qty is not None and budget_amt is not None
            and qty == budget_amt and qty > 10000):
        # Check original text for a smaller quantity
        import re as _re
        qty_match = _re.search(r"(\d{1,4})\s+(?:units?|items?|pieces?|pcs|windows?|panels?|laptops?|chairs?|desks?|devices?)", request_text, _re.IGNORECASE)
        if qty_match:
            real_qty = int(qty_match.group(1))
            logger.info("Quantity inflated to %s, found %s in text. Fixing.", qty, real_qty)
            extracted["quantity"] = real_qty
            extracted["quantity_inferred"] = False
            extracted["quantity_confidence"] = "high"

    # Handle quantity inference
    qty_dims = extracted.get("quantity_dimensions", [])
    if extracted.get("quantity") is None:
        if qty_dims:
            # Use the first/primary dimension
            extracted["quantity"] = qty_dims[0].get("quantity", 1)
            extracted["unit_of_measure"] = qty_dims[0].get("unit", "units")
            extracted["quantity_inferred"] = False
        else:
            extracted["quantity"] = 1
            extracted["quantity_inferred"] = True
            extracted["quantity_confidence"] = "low"

    # Handle budget midpoint
    budget_min = extracted.get("budget_min")
    budget_max = extracted.get("budget_max")
    if budget_min is not None and budget_max is not None and extracted.get("budget_amount") is None:
        extracted["budget_amount"] = (budget_min + budget_max) / 2

    # Build a request-compatible dict from extracted fields
    result: dict[str, Any] = {
        "request_id": optional_fields.get("request_id", "CUSTOM-001"),
        "created_at": optional_fields.get("created_at"),
        "request_channel": optional_fields.get("request_channel", "api"),
        "request_language": extracted.get("original_language", "en"),
        "business_unit": optional_fields.get("business_unit", "Unknown"),
        "country": extracted.get("country"),
        "category_l1": extracted.get("category_l1"),
        "category_l2": extracted.get("category_l2"),
        "category_confidence": extracted.get("category_confidence", 0.0),
        "is_whitespace": extracted.get("category_l1") is None,
        "title": extracted.get("title", "Custom procurement request"),
        "request_text": request_text,
        "currency": extracted.get("currency", "EUR"),
        "budget_amount": extracted.get("budget_amount"),
        "budget_min": extracted.get("budget_min"),
        "budget_max": extracted.get("budget_max"),
        "budget_confidence": extracted.get("budget_confidence", "medium"),
        "budget_source": extracted.get("budget_source", "text"),
        "quantity": extracted.get("quantity"),
        "quantity_inferred": extracted.get("quantity_inferred", False),
        "quantity_confidence": extracted.get("quantity_confidence", "high"),
        "quantity_dimensions": extracted.get("quantity_dimensions", []),
        "unit_of_measure": extracted.get("unit_of_measure"),
        "required_by_date": extracted.get("required_by_date"),
        "preferred_supplier_mentioned": extracted.get("preferred_supplier"),
        "incumbent_supplier": None,
        "delivery_countries": extracted.get("delivery_countries", []),
        "data_residency_constraint": extracted.get("data_residency_constraint", False),
        "esg_requirement": extracted.get("esg_requirement", False),
        "status": "new",
        "urgency_level": extracted.get("urgency_level", "medium"),
        "special_requirements": extracted.get("special_requirements", []),
        # Preserve translation info
        "original_text": extracted.get("original_text"),
        "translated_text": extracted.get("translated_text"),
    }

    # Apply any explicit overrides from optional_fields
    for key, value in optional_fields.items():
        if value is not None:
            result[key] = value

    # Ensure delivery_countries is a list
    if isinstance(result.get("delivery_countries"), str):
        result["delivery_countries"] = [result["delivery_countries"]]
    if result.get("delivery_countries") is None:
        result["delivery_countries"] = []

    # If country is set but delivery_countries is empty, default delivery to country
    if result.get("country") and not result.get("delivery_countries"):
        result["delivery_countries"] = [result["country"]]

    # Store in cache
    _extraction_cache[cache_key] = result.copy()
    # Limit cache size
    from backend.config import EXTRACTOR_CACHE_SIZE
    if len(_extraction_cache) > EXTRACTOR_CACHE_SIZE:
        # Remove oldest entry
        oldest_key = next(iter(_extraction_cache))
        del _extraction_cache[oldest_key]

    return result
