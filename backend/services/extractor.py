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

SYSTEM_PROMPT = (
    "You are a procurement requirement extraction specialist. "
    "Extract structured procurement data from the request text provided. "
    "If the text is not in English, translate it first and include both the "
    "original text and your English translation in the output.\n\n"
    "Return ONLY a JSON object with the following keys (use null for any field "
    "you cannot determine from the text):\n"
    "- category_l1: top-level procurement category (e.g. 'IT', 'Professional Services', "
    "'Facilities', 'Marketing')\n"
    "- category_l2: sub-category (e.g. 'Cloud Compute', 'IT Project Management Services')\n"
    "- quantity: numeric quantity requested\n"
    "- unit_of_measure: unit for the quantity (e.g. 'units', 'consulting_day', 'instance_hour')\n"
    "- budget_amount: numeric budget amount\n"
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
    "- title: a short title summarizing the request\n"
)


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
    if optional_fields is None:
        optional_fields = {}

    user_prompt = (
        "Extract structured procurement requirements from the following request text:\n\n"
        f"{request_text}"
    )

    try:
        response = client.messages.create(
            model=AGENT_MODEL,
            max_tokens=AGENT_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_text = response.content[0].text
        extracted = _parse_json_response(raw_text)
    except Exception:
        logger.exception("Claude extraction failed, returning minimal result")
        extracted = {}

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
        "title": extracted.get("title", "Custom procurement request"),
        "request_text": request_text,
        "currency": extracted.get("currency", "EUR"),
        "budget_amount": extracted.get("budget_amount"),
        "quantity": extracted.get("quantity"),
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
