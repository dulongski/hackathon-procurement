"""Whitespace category store — tracks unmatched procurement categories."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.models import WhitespaceEntry


def _update_budget_range(existing: str | None, new_budget: float) -> str:
    """Update budget range string with a new budget value."""
    if not existing:
        return f"{new_budget:.0f}"
    try:
        parts = existing.split(" – ")
        if len(parts) == 2:
            low, high = float(parts[0]), float(parts[1])
            return f"{min(low, new_budget):.0f} – {max(high, new_budget):.0f}"
        else:
            old = float(existing)
            low, high = min(old, new_budget), max(old, new_budget)
            if low == high:
                return f"{low:.0f}"
            return f"{low:.0f} – {high:.0f}"
    except (ValueError, TypeError):
        return f"{new_budget:.0f}"


class WhitespaceStore:
    """In-memory store for whitespace (unmatched) procurement categories."""

    def __init__(self):
        self._entries: dict[str, WhitespaceEntry] = {}
        self._lock = threading.Lock()

    def record(self, request: dict[str, Any]) -> WhitespaceEntry:
        """Record a whitespace request. Aggregates by inferred category label."""
        label = (request.get("title") or "Unknown Category").strip().lower()
        request_id = request.get("request_id", "")
        countries = request.get("delivery_countries", [])
        budget = request.get("budget_amount")

        with self._lock:
            if label in self._entries:
                entry = self._entries[label]
                if request_id and request_id not in entry.request_ids:
                    entry.request_ids.append(request_id)
                entry.frequency_count = len(entry.request_ids)
                for c in countries:
                    if c and c not in entry.countries:
                        entry.countries.append(c)
                entry.last_seen = datetime.now(timezone.utc).isoformat()
                if budget:
                    entry.estimated_budget_range = _update_budget_range(
                        entry.estimated_budget_range, float(budget)
                    )
            else:
                entry = WhitespaceEntry(
                    entry_id=f"WS-{uuid.uuid4().hex[:8]}",
                    inferred_category_label=request.get("title") or "Unknown Category",
                    request_ids=[request_id] if request_id else [],
                    frequency_count=1,
                    countries=[c for c in countries if c],
                    estimated_budget_range=f"{float(budget):.0f}" if budget else None,
                    first_seen=datetime.now(timezone.utc).isoformat(),
                    last_seen=datetime.now(timezone.utc).isoformat(),
                )
                self._entries[label] = entry
        return entry

    def list_entries(self) -> list[WhitespaceEntry]:
        with self._lock:
            return sorted(
                self._entries.values(),
                key=lambda e: e.frequency_count,
                reverse=True,
            )

    def get_entry(self, entry_id: str) -> WhitespaceEntry | None:
        with self._lock:
            for e in self._entries.values():
                if e.entry_id == entry_id:
                    return e
        return None

    def update_entry(self, entry_id: str, **kwargs: Any) -> WhitespaceEntry | None:
        with self._lock:
            for e in self._entries.values():
                if e.entry_id == entry_id:
                    for k, v in kwargs.items():
                        if hasattr(e, k):
                            setattr(e, k, v)
                    return e
        return None


# Singleton
_store: WhitespaceStore | None = None
_store_lock = threading.Lock()


def get_whitespace_store() -> WhitespaceStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = WhitespaceStore()
    return _store
