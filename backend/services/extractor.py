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

from backend.config import ANTHROPIC_API_KEY, AGENT_MODEL, AGENT_MAX_TOKENS

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY or "missing")

_BASE_SYSTEM_PROMPT = (
    "You are a procurement requirement extraction specialist. "
    "Extract structured procurement data from the request text provided. "
    "If the text is not in English, translate it first and include both the "
    "original text and your English translation in the output.\n\n"
    "Return ONLY a JSON object with the following keys (use null for any field "
    "you cannot determine from the text):\n"
    "- category_l1: top-level procurement category (e.g. 'IT', 'Professional Services', "
    "'Facilities', 'Marketing')\n"
    "- category_l2: sub-category (e.g. 'Cloud Compute', 'IT Project Management Services')\n"
    "- category_confidence: a float between 0.0 and 1.0 indicating how confident you are "
    "in the category match\n"
    "- quantity: numeric quantity requested\n"
    "- unit_of_measure: unit for the quantity (e.g. 'units', 'consulting_day', 'instance_hour')\n"
    "- budget_amount: numeric budget amount\n"
    "- budget_min: minimum budget if a range is given\n"
    "- budget_max: maximum budget if a range is given\n"
    "- quantity_inferred: boolean, true if quantity was guessed/inferred rather than explicitly stated\n"
    "- quantity_confidence: one of 'high', 'medium', 'low'\n"
    "- currency: currency code (e.g. 'EUR', 'USD', 'CHF')\n"
    "- country: requester country code (e.g. 'DE', 'FR', 'US')\n"
    "- delivery_countries: list of country codes where delivery is needed\n"
    "- required_by_date: date string in YYYY-MM-DD format\n"
    "- preferred_supplier: name of preferred supplier if mentioned\n"
    "- urgency_level: one of 'low', 'medium', 'high', 'critical'\n"
    "- special_requirements: list of strings for any special requirements "
    "(e.g. data residency, ESG, certifications)\n"
    "- data_residency_constraint: boolean, true if data residency is mentioned\n"
    "- esg_requirement: boolean, true if ESG/sustainability requirements are mentioned\n"
    "- original_language: ISO language code of the original text\n"
    "- original_text: the original text if not English, otherwise null\n"
    "- translated_text: English translation if original was not English, otherwise null\n"
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

    - 50k / 50K → 50000
    - 2M / 2m → 2000000
    - SQM → square meters, pcs → pieces, qty → quantity
    """
    def _expand_k(m: re.Match) -> str:
        return str(int(m.group(1)) * 1000)

    def _expand_m(m: re.Match) -> str:
        return str(int(m.group(1)) * 1000000)

    text = re.sub(r"(\d+)\s*[Kk]\b", _expand_k, text)
    text = re.sub(r"(\d+)\s*[Mm]\b", _expand_m, text)

    # Common abbreviations (case-insensitive, word boundaries)
    text = re.sub(r"\bSQM\b", "square meters", text, flags=re.IGNORECASE)
    text = re.sub(r"\bpcs\b", "pieces", text, flags=re.IGNORECASE)
    text = re.sub(r"\bqty\b", "quantity", text, flags=re.IGNORECASE)

    return text


def _build_system_prompt(valid_categories: list[tuple[str, str]] | None = None) -> str:
    """Build system prompt, optionally injecting valid category pairs."""
    prompt = _BASE_SYSTEM_PROMPT
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
            model=AGENT_MODEL,
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

    # Handle quantity inference
    if extracted.get("quantity") is None:
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
        "quantity": extracted.get("quantity"),
        "quantity_inferred": extracted.get("quantity_inferred", False),
        "quantity_confidence": extracted.get("quantity_confidence", "high"),
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

    return result
