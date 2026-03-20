import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from backend.services.pipeline import analyze_request, analyze_custom, _run_pipeline
from backend.services.extractor import extract_requirements
from backend.data_loader import get_data
from pydantic import BaseModel
from typing import Optional, List

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analysis"])


class CustomRequestBody(BaseModel):
    request_text: str


# Register the custom endpoint BEFORE the {request_id} endpoint
# to avoid FastAPI treating "custom" as a request_id.
@router.post("/analyze/custom")
async def analyze_custom_request(body: CustomRequestBody):
    """Analyze a free-text custom request."""
    try:
        result = await analyze_custom(body.request_text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze/custom/stream")
async def analyze_custom_stream(body: CustomRequestBody):
    """SSE streaming endpoint for custom free-text requests."""
    from datetime import datetime, timezone
    import uuid

    request_text = body.request_text

    step_queue: asyncio.Queue = asyncio.Queue()

    async def on_step(step):
        await step_queue.put(step)

    async def event_generator():
        # Emit extraction step
        extract_step = {
            "step_id": "EXT-001",
            "step_name": "Understanding Your Request",
            "step_type": "deterministic",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "in_progress",
            "step_description": "Reading and structuring your procurement needs.",
        }
        yield f"data: {json.dumps(extract_step)}\n\n"

        # Run extraction
        try:
            request = extract_requirements(request_text)
        except Exception as e:
            extract_step["status"] = "failed"
            extract_step["output_summary"] = str(e)
            extract_step["completed_at"] = datetime.now(timezone.utc).isoformat()
            yield f"data: {json.dumps(extract_step)}\n\n"
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"
            return

        extract_step["status"] = "completed"
        extract_step["completed_at"] = datetime.now(timezone.utc).isoformat()
        budget_val = request.get('budget_amount', 0)
        budget_str = f"{request.get('currency', 'EUR')} {budget_val:,.0f}" if budget_val else "Not specified"
        extract_step["output_summary"] = f"{request.get('category_l1', '?')} · {request.get('country', '?')} · {budget_str}"
        yield f"data: {json.dumps(extract_step)}\n\n"

        # Check rejection
        if request.get("is_rejected"):
            rejection_response = {
                "request_id": request.get("request_id", f"CUSTOM-{uuid.uuid4().hex[:8].upper()}"),
                "processed_at": datetime.now(timezone.utc).isoformat() + "Z",
                "is_rejected": True,
                "rejection_message": request.get("rejection_message", "Request cannot be processed."),
                "supplier_shortlist": [],
                "suppliers_excluded": [],
                "escalations": [],
                "agent_opinions": [],
            }
            yield f"data: {json.dumps({'type': 'complete', 'result': rejection_response})}\n\n"
            return

        # Assign request_id
        request_id = f"CUSTOM-{uuid.uuid4().hex[:8].upper()}"
        request["request_id"] = request_id

        data = get_data()

        # Emit: Validate & Match — compact single step
        cat_key = (request.get("category_l1", ""), request.get("category_l2", ""))
        all_suppliers_for_cat = data.supplier_category_index.get(cat_key, [])
        eligible_count = len(all_suppliers_for_cat)

        qty = request.get('quantity', '?')
        uom = request.get('unit_of_measure', 'units')
        validate_step = {
            "step_id": "VAL-001", "step_name": "Matching Category",
            "step_type": "deterministic",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "output_summary": f"{request.get('category_l2', '?')} · {qty} {uom}",
        }
        yield f"data: {json.dumps(validate_step)}\n\n"

        # Emit: Supplier screening
        countries = ', '.join(request.get('delivery_countries', [])) or '?'
        sup_step = {
            "step_id": "SUP-001", "step_name": "Finding Suppliers",
            "step_type": "deterministic",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "output_summary": f"{eligible_count} suppliers in {countries}",
        }
        yield f"data: {json.dumps(sup_step)}\n\n"

        # Handle whitespace demand
        if request.get("is_whitespace") or request.get("category_l1") is None:
            from backend.services.whitespace_store import get_whitespace_store
            ws = get_whitespace_store()
            ws.record(request)

        # Start pipeline in background task
        pipeline_task = asyncio.create_task(
            _run_pipeline(request, data, on_step=on_step)
        )

        # Emit step events as they arrive
        while not pipeline_task.done():
            try:
                step = await asyncio.wait_for(step_queue.get(), timeout=1.0)
                step_data = step.model_dump() if hasattr(step, "model_dump") else step
                yield f"data: {json.dumps(step_data)}\n\n"
            except asyncio.TimeoutError:
                continue

        # Drain remaining steps
        while not step_queue.empty():
            step = step_queue.get_nowait()
            step_data = step.model_dump() if hasattr(step, "model_dump") else step
            yield f"data: {json.dumps(step_data)}\n\n"

        # Get result or error
        try:
            result = await pipeline_task
            yield f"data: {json.dumps({'type': 'complete', 'result': result})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/analyze/{request_id}/stream")
async def analyze_stream(request_id: str):
    """SSE streaming endpoint — emits progress steps then final result."""
    data = get_data()

    # Load request
    request = data.requests_by_id.get(request_id)
    if not request:
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")

    # Run extractor
    try:
        extracted = extract_requirements(
            request.get("request_text", ""),
            optional_fields={k: v for k, v in request.items() if v is not None},
        )
        for key, value in extracted.items():
            if request.get(key) is None and value is not None:
                request[key] = value
    except Exception:
        logger.warning("Extractor failed for %s; proceeding with raw request", request_id)

    # Check for rejection after extraction
    if request.get("is_rejected"):
        from datetime import datetime
        rejection_response = {
            "request_id": request_id,
            "processed_at": datetime.utcnow().isoformat() + "Z",
            "is_rejected": True,
            "rejection_message": request.get("rejection_message", "Request cannot be processed."),
            "supplier_shortlist": [],
            "suppliers_excluded": [],
            "escalations": [],
            "agent_opinions": [],
        }

        async def rejection_generator():
            yield f"data: {json.dumps({'type': 'complete', 'result': rejection_response})}\n\n"

        return StreamingResponse(
            rejection_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    step_queue: asyncio.Queue = asyncio.Queue()

    async def on_step(step):
        await step_queue.put(step)

    async def event_generator():
        # Start pipeline in background task
        pipeline_task = asyncio.create_task(
            _run_pipeline(request, data, on_step=on_step)
        )

        # Emit step events as they arrive
        while not pipeline_task.done():
            try:
                step = await asyncio.wait_for(step_queue.get(), timeout=1.0)
                step_data = step.model_dump() if hasattr(step, "model_dump") else step
                yield f"data: {json.dumps(step_data)}\n\n"
            except asyncio.TimeoutError:
                continue

        # Drain any remaining steps
        while not step_queue.empty():
            step = step_queue.get_nowait()
            step_data = step.model_dump() if hasattr(step, "model_dump") else step
            yield f"data: {json.dumps(step_data)}\n\n"

        # Get result or error
        try:
            result = await pipeline_task
            yield f"data: {json.dumps({'type': 'complete', 'result': result})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
