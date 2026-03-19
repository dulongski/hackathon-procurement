"""Governance memory store — structured, typed, scoped memory for governance agents."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.models import MemoryEntry


class GovernanceMemoryStore:
    """In-memory governance memory store with scoped access.

    Scopes:
        supervisor — process memory (routing mistakes, activation heuristics)
        critic — challenge patterns (contradictions, weak evidence)
        judge — governance memory (bias alerts, confidence calibration)
        reviewer — quality-control memory (audit defects, missing traceability)
        specialist:{name} — narrow checklists per specialist
    """

    def __init__(self):
        self._memory: dict[str, list[MemoryEntry]] = {}
        self._lock = threading.Lock()

    def store_memory(
        self,
        scope: str,
        entry_type: str,
        content: str,
        source_request_id: str,
        relevance_score: float = 1.0,
    ) -> MemoryEntry:
        entry = MemoryEntry(
            entry_id=f"MEM-{uuid.uuid4().hex[:8]}",
            scope=scope,
            entry_type=entry_type,
            content=content,
            created_at=datetime.now(timezone.utc).isoformat(),
            source_request_id=source_request_id,
            relevance_score=relevance_score,
        )
        with self._lock:
            self._memory.setdefault(scope, []).append(entry)
        return entry

    def query_memory(
        self,
        scope: str,
        entry_type: Optional[str] = None,
        limit: int = 10,
    ) -> list[MemoryEntry]:
        with self._lock:
            entries = list(self._memory.get(scope, []))
        if entry_type:
            entries = [e for e in entries if e.entry_type == entry_type]
        # Most recent and highest relevance first
        entries.sort(key=lambda e: (e.relevance_score, e.created_at), reverse=True)
        return entries[:limit]

    def get_scoped_context(self, scope: str, limit: int = 5) -> list[MemoryEntry]:
        return self.query_memory(scope, limit=limit)

    def get_all_scopes(self) -> list[str]:
        with self._lock:
            return list(self._memory.keys())

    def clear(self, scope: Optional[str] = None):
        with self._lock:
            if scope:
                self._memory.pop(scope, None)
            else:
                self._memory.clear()


# Singleton
_instance: GovernanceMemoryStore | None = None
_lock = threading.Lock()


def get_governance_memory() -> GovernanceMemoryStore:
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                _instance = GovernanceMemoryStore()
    return _instance
