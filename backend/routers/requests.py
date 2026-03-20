from fastapi import APIRouter, HTTPException, Query
from backend.data_loader import get_data
from typing import Optional

router = APIRouter(prefix="/api", tags=["requests"])


@router.get("/requests")
async def list_requests(
    scenario_tag: Optional[str] = Query(None),
    category_l1: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List all requests with optional filtering."""
    data = get_data()
    results = data.requests

    if scenario_tag:
        results = [r for r in results if scenario_tag in r.get("scenario_tags", [])]
    if category_l1:
        results = [r for r in results if r.get("category_l1") == category_l1]
    if country:
        results = [r for r in results if r.get("country") == country]
    if status:
        results = [r for r in results if r.get("status") == status]

    total = len(results)
    start = (page - 1) * page_size
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "requests": results[start : start + page_size],
    }


@router.get("/historical")
async def list_historical_awards(
    category_l1: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
):
    """List historical awards with optional filtering."""
    data = get_data()
    results = data.historical_awards

    if category_l1:
        results = [r for r in results if r.get("category_l1") == category_l1]
    if country:
        results = [r for r in results if r.get("country") == country or r.get("delivery_country") == country]

    # Enrich with request title/tags
    enriched = []
    for award in results:
        row = dict(award)
        req = data.requests_by_id.get(award.get("request_id", ""))
        if req:
            row["request_title"] = req.get("title", "")
            row["scenario_tags"] = req.get("scenario_tags", [])
        enriched.append(row)

    total = len(enriched)
    start = (page - 1) * page_size
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "awards": enriched[start : start + page_size],
    }


@router.get("/historical/filters")
async def get_historical_filters():
    """Return unique filter values from historical awards."""
    data = get_data()
    categories = sorted(set(r.get("category_l1", "") for r in data.historical_awards if r.get("category_l1")))
    countries = sorted(set(r.get("country", "") for r in data.historical_awards if r.get("country")))
    suppliers = sorted(set(r.get("supplier_name", "") for r in data.historical_awards if r.get("supplier_name")))
    return {"categories": categories, "countries": countries, "suppliers": suppliers}


@router.get("/requests/{request_id}")
async def get_request(request_id: str):
    """Get a single request by ID."""
    data = get_data()
    req = data.requests_by_id.get(request_id)
    if not req:
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")
    return req


@router.get("/stats")
async def get_stats():
    """Return aggregate statistics about all requests."""
    data = get_data()
    requests = data.requests

    by_scenario_tag: dict[str, int] = {}
    by_category: dict[str, int] = {}
    by_country: dict[str, int] = {}
    by_status: dict[str, int] = {}

    for r in requests:
        # scenario tags
        for tag in r.get("scenario_tags", []):
            by_scenario_tag[tag] = by_scenario_tag.get(tag, 0) + 1

        # category_l1
        cat = r.get("category_l1", "unknown")
        by_category[cat] = by_category.get(cat, 0) + 1

        # country
        c = r.get("country", "unknown")
        by_country[c] = by_country.get(c, 0) + 1

        # status
        s = r.get("status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1

    return {
        "total_requests": len(requests),
        "by_scenario_tag": by_scenario_tag,
        "by_category": by_category,
        "by_country": by_country,
        "by_status": by_status,
    }
