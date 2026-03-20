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

# Per-role token limits — keep short for speed
SPECIALIST_MAX_TOKENS = 800
GOVERNANCE_MAX_TOKENS = 1200

# Use Haiku for all agents — 10x faster
SPECIALIST_MODEL = os.environ.get("SPECIALIST_MODEL", "claude-haiku-4-5-20251001")

# Use Haiku for extraction too — faster parsing
EXTRACTOR_MODEL = os.environ.get("EXTRACTOR_MODEL", "claude-haiku-4-5-20251001")

# Extraction cache size
EXTRACTOR_CACHE_SIZE = 128

# Timeout for agent API calls (seconds) — hard cap
AGENT_TIMEOUT = 15

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

# Exchange rates to EUR (base)
EXCHANGE_RATES_TO_EUR: dict[str, float] = {
    "EUR": 1.0,
    "USD": 0.92,
    "CHF": 1.04,
    "GBP": 1.16,
}

def convert_to_eur(amount: float | None, currency: str) -> float | None:
    if amount is None:
        return None
    rate = EXCHANGE_RATES_TO_EUR.get(currency, 1.0)
    return round(amount * rate, 2)

GOVERNANCE_MEMORY_ENABLED: bool = True
BUNDLING_ENABLED: bool = True
