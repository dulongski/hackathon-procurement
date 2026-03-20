"""Admin API — CRUD for policies, suppliers, and categories."""

import json
import csv
import io
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.data_loader import get_data, reload_data
from backend.config import DATA_FILES

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------

@router.get("/policies")
async def get_policies():
    """Return the full policies.json."""
    data = get_data()
    return data.policies


@router.put("/policies/{section}")
async def update_policy_section(section: str, body: dict[str, Any]):
    """Update a specific policy section (e.g., approval_thresholds)."""
    data = get_data()
    valid_sections = ["approval_thresholds", "preferred_suppliers", "restricted_suppliers",
                      "category_rules", "geography_rules", "escalation_rules"]
    if section not in valid_sections:
        raise HTTPException(status_code=400, detail=f"Invalid section. Must be one of: {valid_sections}")

    data.policies[section] = body.get("data", body)

    # Persist to file
    with open(DATA_FILES["policies"], "w", encoding="utf-8") as f:
        json.dump(data.policies, f, indent=2, ensure_ascii=False)

    return {"status": "updated", "section": section}


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------

@router.get("/suppliers")
async def list_suppliers():
    """Return all supplier rows."""
    data = get_data()
    return {"suppliers": data.suppliers, "total": len(data.suppliers)}


class SupplierUpdate(BaseModel):
    supplier_name: str | None = None
    category_l1: str | None = None
    category_l2: str | None = None
    country_hq: str | None = None
    service_regions: str | None = None
    currency: str | None = None
    quality_score: int | None = None
    risk_score: int | None = None
    esg_score: int | None = None
    preferred_supplier: bool | None = None
    is_restricted: bool | None = None
    restriction_reason: str | None = None
    contract_status: str | None = None
    capacity_per_month: int | None = None


@router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, body: SupplierUpdate):
    """Update supplier fields. Applies to ALL rows for this supplier_id."""
    data = get_data()
    rows = data.suppliers_by_id.get(supplier_id)
    if not rows:
        raise HTTPException(status_code=404, detail=f"Supplier {supplier_id} not found")

    updates = body.model_dump(exclude_none=True)
    for row in rows:
        for key, value in updates.items():
            row[key] = value
    # Also update the main suppliers list
    for sup in data.suppliers:
        if sup.get("supplier_id") == supplier_id:
            for key, value in updates.items():
                sup[key] = value

    _persist_suppliers(data.suppliers)
    return {"status": "updated", "supplier_id": supplier_id, "fields_updated": list(updates.keys())}


@router.post("/suppliers")
async def add_supplier(body: dict[str, Any]):
    """Add a new supplier row."""
    data = get_data()
    required = ["supplier_id", "supplier_name", "category_l1", "category_l2"]
    for field in required:
        if field not in body:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")

    # Set defaults
    body.setdefault("country_hq", "")
    body.setdefault("service_regions", "")
    body.setdefault("currency", "EUR")
    body.setdefault("pricing_model", "tiered")
    body.setdefault("quality_score", 50)
    body.setdefault("risk_score", 50)
    body.setdefault("esg_score", 50)
    body.setdefault("preferred_supplier", False)
    body.setdefault("is_restricted", False)
    body.setdefault("restriction_reason", "")
    body.setdefault("contract_status", "active")
    body.setdefault("data_residency_supported", False)
    body.setdefault("capacity_per_month", 1000)
    body.setdefault("notes", "")

    data.suppliers.append(body)
    data.suppliers_by_id.setdefault(body["supplier_id"], []).append(body)
    cat_key = (body["category_l1"], body["category_l2"])
    data.supplier_category_index.setdefault(cat_key, []).append(body)

    _persist_suppliers(data.suppliers)
    return {"status": "created", "supplier_id": body["supplier_id"]}


@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str):
    """Remove all rows for a supplier."""
    data = get_data()
    if supplier_id not in data.suppliers_by_id:
        raise HTTPException(status_code=404, detail=f"Supplier {supplier_id} not found")

    data.suppliers = [s for s in data.suppliers if s.get("supplier_id") != supplier_id]
    del data.suppliers_by_id[supplier_id]
    # Clean category index
    for key in list(data.supplier_category_index.keys()):
        data.supplier_category_index[key] = [
            s for s in data.supplier_category_index[key] if s.get("supplier_id") != supplier_id
        ]

    _persist_suppliers(data.suppliers)
    return {"status": "deleted", "supplier_id": supplier_id}


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@router.get("/categories")
async def list_categories():
    """Return all categories."""
    data = get_data()
    return {"categories": data.categories, "total": len(data.categories)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _persist_suppliers(suppliers: list[dict[str, Any]]):
    """Write suppliers back to CSV."""
    if not suppliers:
        return
    fieldnames = list(suppliers[0].keys())
    with open(DATA_FILES["suppliers"], "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(suppliers)
