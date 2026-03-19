# ChainIQ — Audit-Ready Autonomous Sourcing Agent

> START Hack 2026 — ChainIQ Challenge

An AI-powered procurement sourcing agent that converts unstructured purchase requests into audit-ready supplier comparisons with deterministic policy enforcement, multi-agent evaluation, and explainable escalation routing.

## Quick Start

```bash
# Backend (port 8000)
export ANTHROPIC_API_KEY="sk-ant-..."
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (port 3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Tech Stack

- **Backend**: Python + FastAPI
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **AI**: Claude API (claude-sonnet-4-6) — hybrid deterministic + agentic architecture
- **Data**: 6 static files (304 requests, 151 suppliers, 599 pricing tiers, policies, historical awards, categories)

## Architecture: 3-Layer Hybrid

```
         ┌────────────────────────────┐
         │    Pipeline (pipeline.py)  │
         └──────────┬─────────────────┘
                    │
   ┌────────────────┼────────────────────┐
   │                │                    │
Layer 1          Layer 2             Layer 3
DETERMINISTIC    AGENTIC             SYNTHESIS
(guaranteed)     (Claude-powered)    (merge + explain)
   │                │                    │
 Extract         Historical Agent    Confidence Scorer
 Validate        Risk Agent          Explainer Agent
 Filter          Value Agent         Approval Router
 Escalate        Strategic Agent
```

**Core principle**: Hard rules (thresholds, restrictions, escalations) are deterministic Python code — never delegated to LLMs. Soft evaluations (ranking intelligence, risk nuance, strategic fit) use specialized Claude agents whose opinions are merged with confidence scoring. Policy compliance is guaranteed correct; ranking intelligence benefits from AI.

## Pipeline: 12 Steps Per Request

1. **Load request** — from dataset or extract from free text (Claude translates non-English)
2. **Filter suppliers** — category → delivery country → not restricted → data residency → active contract
3. **Get pricing** — match quantity to tier (min/max qty), highest tier if exceeds all ranges
4. **Validate** — missing fields, text contradictions, budget sufficiency, lead time feasibility
5. **Evaluate policies** — 15 approval thresholds (EUR/CHF/USD), preferred/restricted suppliers, 10 category rules, 8 geography rules
6. **Check escalation rules** — 8 rules (ER-001 to ER-008) with specific routing targets
7. **Run 4 Claude agents in parallel** — historical precedent, risk, value-for-money, strategic fit
8. **Merge results** — 60% deterministic + 40% agent composite score with dynamic weights
9. **Compute confidence** — agent agreement, data completeness, validation severity
10. **Generate explanation** — audit-ready text referencing rule IDs and agent opinions
11. **Build approval routing** — simulated flow from escalations + policy
12. **Return AnalysisResponse** — full JSON with all layers visible for audit

## Deterministic Engine

### Validation (`rule_engine.py`)
- Missing budget/quantity → critical severity
- Text vs field contradictions (quantity, budget) → high severity
- Budget insufficient (cheapest supplier × qty > budget) → critical
- Lead time infeasible (days to deadline < min expedited) → high

### Policy Evaluation (`rule_engine.py`)
- **Approval thresholds**: 15 tiers across EUR/CHF/USD, uses actual contract value (cheapest × qty)
- **Preferred suppliers**: Category + region match from policies.json
- **Restricted suppliers**: Country-scoped and value-conditional (e.g., SUP-0045 restricted above EUR 75K)
- **Category rules**: CR-001 to CR-010
- **Geography rules**: GR-001 to GR-008

### Escalation Rules (`escalation.py`)

| Rule | Trigger | Routes To | Blocking |
|------|---------|-----------|----------|
| ER-001 | Missing info / budget insufficient | Requester | Yes |
| ER-002 | Preferred supplier is restricted | Procurement Manager | Yes |
| ER-003 | High-value threshold | Head of Strategic Sourcing | No |
| ER-004 | No compliant supplier / lead times infeasible | Head of Category | Yes |
| ER-005 | Data residency unmet | Security & Compliance | Yes |
| ER-006 | Quantity exceeds all capacity | Sourcing Excellence Lead | No |
| ER-007 | Marketing/Influencer category | Marketing Governance Lead | No |
| ER-008 | Supplier not registered in country | Regional Compliance Lead | No |

## Claude Agents

All 4 run **in parallel** via ThreadPoolExecutor, each returning structured JSON with supplier rankings, confidence, and reasoning.

| Agent | Analyzes | Key Output |
|-------|----------|------------|
| **Historical Precedent** | Past awards, win rates, savings patterns | Rankings + weight adjustments |
| **Risk Assessment** | Risk scores, capacity, concentration risk | Adjusted risk per supplier |
| **Value-for-Money** | Pricing tiers, budget fit, trade-offs | Value scores + budget advice |
| **Strategic Fit** | ESG, preferred/incumbent, category strategy | Strategic scores + alignment |

### Score Merging (`orchestrator.py`)
- **Base weights**: price 30%, quality 20%, risk 15%, ESG 10%, lead time 10%, preferred 10%, incumbent 5%
- **Final composite**: 60% deterministic + 40% agent average → sorted descending

### Confidence Scoring (`confidence.py`)
- All agents agree on #1 → 0.92 | 2-way split → 0.70 | All disagree → 0.55
- Penalties: missing budget (-0.15), missing quantity (-0.15), critical issues (-0.10 each)

## Frontend

### Dashboard (`/`)
- Scenario tag stats (9 types with color-coded badges)
- Custom free-text request submission with optional structured fields
- Filterable/paginated table of 304 requests

### Analysis View (`/request/[id]`) — 6 Tabs
1. **Recommendation** — status banner (green/amber/red), confidence gauge, approval routing
2. **Supplier Comparison** — ranked table with composite scores, bar charts, excluded suppliers
3. **Agent Opinions** — per-agent cards with confidence, rankings, key factors
4. **Policy & Validation** — severity-colored issues, threshold details, rule checks
5. **Escalation** — blocking (red) and warning (amber) cards with routing
6. **Audit Trail** — policies checked, data sources, dynamic weight adjustments

## API Endpoints

```
GET  /api/requests                  List/filter all 304 requests
GET  /api/requests/{id}             Single request details
POST /api/analyze/{id}              Full analysis pipeline
POST /api/analyze/custom            Analyze free-text input
GET  /api/stats                     Dashboard aggregate stats
GET  /api/health                    Health check
```

## Project Structure

```
hackathon-procurement/
├── data/                            # 6 procurement dataset files
├── backend/
│   ├── main.py                      # FastAPI app + CORS + startup
│   ├── config.py                    # API keys, paths, region maps
│   ├── data_loader.py               # Singleton data loader with indexes
│   ├── models.py                    # 25+ Pydantic models
│   ├── routers/
│   │   ├── requests.py              # Request list/detail endpoints
│   │   └── analysis.py              # Analysis endpoints
│   └── services/
│       ├── extractor.py             # Claude: requirement extraction + translation
│       ├── rule_engine.py           # Validation + policy evaluation
│       ├── supplier_filter.py       # Eligibility filtering + pricing lookup
│       ├── escalation.py            # 8 escalation rules
│       ├── agents/
│       │   ├── base.py              # BaseAgent with Claude client
│       │   ├── historical_agent.py  # Historical precedent analysis
│       │   ├── risk_agent.py        # Risk assessment
│       │   ├── value_agent.py       # Value-for-money evaluation
│       │   └── strategic_agent.py   # Strategic fit + ESG
│       ├── orchestrator.py          # Parallel agents + score merging
│       ├── confidence.py            # Multi-factor confidence scoring
│       ├── explainer.py             # Audit-ready explanation generation
│       └── pipeline.py              # 12-step pipeline orchestration
├── frontend/
│   ├── app/
│   │   ├── layout.tsx               # Sidebar navigation shell
│   │   ├── page.tsx                 # Dashboard
│   │   └── request/[id]/page.tsx    # Analysis view (6 tabs)
│   └── lib/
│       ├── api.ts                   # API client
│       └── types.ts                 # TypeScript interfaces
├── examples/
│   ├── example_output.json          # Reference output for REQ-000004
│   └── example_request.json         # Reference input
└── requirements.txt
```

## Key Data Handling

1. **Policy field inconsistency**: EUR/CHF use `min_amount`/`max_amount`, USD uses `min_value`/`max_value` — normalized at evaluation time
2. **Restriction cross-referencing**: `is_restricted` flag in suppliers.csv is insufficient — always cross-ref with policies.json for country-scoped and value-conditional restrictions
3. **Switzerland pricing**: CH uses EU region pricing but CHF currency thresholds
4. **Contract value basis**: Uses cheapest_price × quantity (not stated budget) for threshold determination
5. **Country-to-region mapping**: EU: DE,FR,NL,BE,AT,IT,ES,PL,UK,CH | Americas: US,CA,BR,MX | APAC: SG,AU,IN,JP | MEA: UAE,ZA
