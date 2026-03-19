"""Base agent class for procurement analysis agents."""

from __future__ import annotations

import json
import logging
import re

import anthropic
from httpx import Timeout

from backend.config import (
    ANTHROPIC_API_KEY,
    AGENT_MODEL,
    AGENT_MAX_TOKENS,
    AGENT_TIMEOUT,
)

logger = logging.getLogger(__name__)


class BaseAgent:
    """Base class that all procurement analysis agents inherit from."""

    def __init__(self, name: str, max_tokens: int | None = None):
        self.name = name
        api_key = ANTHROPIC_API_KEY or "missing"
        self.client = anthropic.Anthropic(
            api_key=api_key,
            timeout=Timeout(AGENT_TIMEOUT, connect=10.0),
        )
        self.model = AGENT_MODEL
        self.max_tokens = max_tokens or AGENT_MAX_TOKENS

    async def analyze(self, context: dict) -> dict:
        raise NotImplementedError

    def analyze_sync(self, context: dict) -> dict:
        """Synchronous wrapper for analyze() - runs the async method."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside a running loop (called from executor), just call sync parts
                return self._analyze_sync_impl(context)
            return loop.run_until_complete(self.analyze(context))
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(self.analyze(context))
            finally:
                loop.close()

    def _analyze_sync_impl(self, context: dict) -> dict:
        """Override in subclasses that need pure sync execution."""
        # Default: just run analyze in a new event loop
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(self.analyze(context))
        finally:
            loop.close()

    def _call_claude(self, system_prompt: str, user_prompt: str, max_tokens: int | None = None) -> str:
        """Make a synchronous call to Claude and return the text response."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens or self.max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return response.content[0].text

    def _parse_json_response(self, text: str) -> dict:
        """Extract JSON from Claude response, handling markdown code blocks."""
        # Try to find JSON in code blocks first
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        # Try parsing the whole text
        return json.loads(text)
