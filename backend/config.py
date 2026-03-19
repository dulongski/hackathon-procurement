"""Configuration for the procurement sourcing agent backend."""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

DATA_FILES = {
    "requests": DATA_DIR / "requests.json",
    "suppliers": DATA_DIR / "suppliers.csv",
    "pricing": DATA_DIR / "pricing.csv",
    "policies": DATA_DIR / "policies.json",
    "historical_awards": DATA_DIR / "historical_awards.csv",
    "categories": DATA_DIR / "categories.csv",
}

# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")

# ---------------------------------------------------------------------------
# Agent / model configuration
# ---------------------------------------------------------------------------
AGENT_MODEL = "claude-sonnet-4-6"
AGENT_MAX_TOKENS = 4096
AGENT_TEMPERATURE = 0.0

# Per-role token limits
SPECIALIST_MAX_TOKENS = 1500
GOVERNANCE_MAX_TOKENS = 2000

# Timeout for agent API calls (seconds)
AGENT_TIMEOUT = 45

# ---------------------------------------------------------------------------
# Country-to-region mapping
# ---------------------------------------------------------------------------
COUNTRY_TO_REGION: dict[str, str] = {}

_REGION_COUNTRIES: dict[str, list[str]] = {
    "EU": ["DE", "FR", "NL", "BE", "AT", "IT", "ES", "PL", "UK", "CH"],
    "Americas": ["US", "CA", "BR", "MX"],
    "APAC": ["SG", "AU", "IN", "JP"],
    "MEA": ["UAE", "ZA"],
}

for _region, _countries in _REGION_COUNTRIES.items():
    for _country in _countries:
        COUNTRY_TO_REGION[_country] = _region

REGION_COUNTRIES = _REGION_COUNTRIES

GOVERNANCE_MEMORY_ENABLED: bool = True
BUNDLING_ENABLED: bool = True
