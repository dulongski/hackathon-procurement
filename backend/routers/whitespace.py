"""Whitespace categories router — tracks and researches unmatched procurement categories."""

import json
import logging
import re

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["whitespace"])


@router.get("/whitespace")
async def list_whitespace():
    """List all whitespace category entries."""
    from backend.services.whitespace_store import get_whitespace_store
    store = get_whitespace_store()
    return {"entries": [e.model_dump() for e in store.list_entries()]}


@router.post("/whitespace/{entry_id}/research")
async def research_whitespace(entry_id: str):
    """Trigger agentic supplier research for a whitespace category."""
    from backend.services.whitespace_store import get_whitespace_store
    store = get_whitespace_store()
    entry = store.get_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Whitespace entry not found")

    # Mark as in progress
    store.update_entry(entry_id, research_status="in_progress")

    try:
        import anthropic
        from backend.config import ANTHROPIC_API_KEY, AGENT_MODEL

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY or "missing")
        response = client.messages.create(
            model=AGENT_MODEL,
            max_tokens=1500,
            system=(
                "You are a procurement research specialist. Suggest potential suppliers "
                "for procurement categories that are not currently covered in the organization's "
                "approved supplier catalog. Be specific and practical."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"Suggest 3-5 potential vendors for this procurement need:\n\n"
                    f"Category: {entry.inferred_category_label}\n"
                    f"Countries needed: {', '.join(entry.countries) if entry.countries else 'Not specified'}\n"
                    f"Budget range: {entry.estimated_budget_range or 'Not specified'}\n"
                    f"Number of requests: {entry.frequency_count}\n\n"
                    f"Return ONLY a JSON object: "
                    f'{{"suppliers": [{{"name": "...", "description": "...", '
                    f'"website": "...", "coverage": "...", "strengths": "..."}}]}}'
                ),
            }],
        )

        raw = response.content[0].text
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", raw, re.DOTALL)
        parsed = json.loads(match.group(1) if match else raw)
        suppliers = parsed.get("suppliers", [])

        store.update_entry(entry_id, research_status="completed", discovered_suppliers=suppliers)
    except Exception as e:
        logger.exception("Whitespace research failed for %s", entry_id)
        store.update_entry(entry_id, research_status="failed")
        raise HTTPException(status_code=500, detail=f"Research failed: {str(e)}")

    updated = store.get_entry(entry_id)
    return updated.model_dump() if updated else {}
