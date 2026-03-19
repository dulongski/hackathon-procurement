"""Load all procurement data files at startup and build lookup indexes.

Uses a singleton pattern so data is loaded exactly once per process.
"""

from __future__ import annotations

import csv
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.config import DATA_FILES


@dataclass
class ProcurementData:
    """Container for all loaded procurement data with pre-built indexes."""

    # ----- raw lists -----
    requests: list[dict[str, Any]] = field(default_factory=list)
    suppliers: list[dict[str, Any]] = field(default_factory=list)
    pricing: list[dict[str, Any]] = field(default_factory=list)
    policies: dict[str, Any] = field(default_factory=dict)
    historical_awards: list[dict[str, Any]] = field(default_factory=list)
    categories: list[dict[str, Any]] = field(default_factory=list)

    # ----- lookup dicts -----
    requests_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Multiple rows per supplier (one per category), so value is a list.
    suppliers_by_id: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    # (supplier_id, category_l1, category_l2, region) -> list of pricing rows
    pricing_lookup: dict[tuple[str, str, str, str], list[dict[str, Any]]] = field(
        default_factory=dict
    )
    historical_awards_by_request: dict[str, list[dict[str, Any]]] = field(
        default_factory=dict
    )
    # (category_l1, category_l2) -> category row
    categories_lookup: dict[tuple[str, str], dict[str, Any]] = field(
        default_factory=dict
    )
    # (category_l1, category_l2) -> list of supplier rows that serve that category
    supplier_category_index: dict[tuple[str, str], list[dict[str, Any]]] = field(
        default_factory=dict
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _read_csv(path: Path) -> list[dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        return list(reader)


def _coerce_numeric(row: dict[str, Any]) -> dict[str, Any]:
    """Best-effort conversion of numeric-looking string values."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, str):
            # Try int, then float
            try:
                out[k] = int(v)
                continue
            except (ValueError, TypeError):
                pass
            try:
                out[k] = float(v)
                continue
            except (ValueError, TypeError):
                pass
            # Booleans
            if v.lower() in ("true", "false"):
                out[k] = v.lower() == "true"
                continue
        out[k] = v
    return out


def _load() -> ProcurementData:
    """Load all data files and build indexes."""
    data = ProcurementData()

    # --- requests.json ---
    data.requests = _read_json(DATA_FILES["requests"])
    data.requests_by_id = {r["request_id"]: r for r in data.requests}

    # --- suppliers.csv ---
    raw_suppliers = _read_csv(DATA_FILES["suppliers"])
    data.suppliers = [_coerce_numeric(r) for r in raw_suppliers]
    for row in data.suppliers:
        sid = row["supplier_id"]
        data.suppliers_by_id.setdefault(sid, []).append(row)
        cat_key = (row["category_l1"], row["category_l2"])
        data.supplier_category_index.setdefault(cat_key, []).append(row)

    # --- pricing.csv ---
    raw_pricing = _read_csv(DATA_FILES["pricing"])
    data.pricing = [_coerce_numeric(r) for r in raw_pricing]
    for row in data.pricing:
        key = (
            row["supplier_id"],
            row["category_l1"],
            row["category_l2"],
            row["region"],
        )
        data.pricing_lookup.setdefault(key, []).append(row)

    # --- policies.json ---
    data.policies = _read_json(DATA_FILES["policies"])

    # --- historical_awards.csv ---
    raw_awards = _read_csv(DATA_FILES["historical_awards"])
    data.historical_awards = [_coerce_numeric(r) for r in raw_awards]
    for row in data.historical_awards:
        rid = row["request_id"]
        data.historical_awards_by_request.setdefault(rid, []).append(row)

    # --- categories.csv ---
    raw_categories = _read_csv(DATA_FILES["categories"])
    data.categories = [_coerce_numeric(r) for r in raw_categories]
    for row in data.categories:
        cat_key = (row["category_l1"], row["category_l2"])
        data.categories_lookup[cat_key] = row

    return data


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: ProcurementData | None = None
_lock = threading.Lock()


def get_data() -> ProcurementData:
    """Return the singleton ProcurementData instance, loading on first call."""
    global _instance
    if _instance is None:
        with _lock:
            # Double-checked locking
            if _instance is None:
                _instance = _load()
    return _instance


def reload_data() -> ProcurementData:
    """Force a reload of all data (useful for testing)."""
    global _instance
    with _lock:
        _instance = _load()
    return _instance
