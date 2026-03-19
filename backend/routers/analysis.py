from fastapi import APIRouter, HTTPException
from backend.services.pipeline import analyze_request, analyze_custom
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter(prefix="/api", tags=["analysis"])


class CustomRequestBody(BaseModel):
    request_text: str
    category_l1: Optional[str] = None
    category_l2: Optional[str] = None
    country: Optional[str] = None
    budget_amount: Optional[float] = None
    currency: Optional[str] = None
    quantity: Optional[float] = None
    delivery_countries: Optional[List[str]] = None
    required_by_date: Optional[str] = None


# Register the custom endpoint BEFORE the {request_id} endpoint
# to avoid FastAPI treating "custom" as a request_id.
@router.post("/analyze/custom")
async def analyze_custom_request(body: CustomRequestBody):
    """Analyze a free-text custom request."""
    optional_fields = {
        k: v
        for k, v in body.model_dump().items()
        if v is not None and k != "request_text"
    }
    try:
        result = await analyze_custom(body.request_text, optional_fields)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze/{request_id}")
async def analyze_existing_request(request_id: str):
    """Run full analysis pipeline on an existing request."""
    try:
        result = await analyze_request(request_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
