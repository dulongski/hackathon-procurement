# ChainIQ — Audit-Ready Autonomous Sourcing Agent

> **START Hack 2026** — Procurement Intelligence Challenge

An AI-powered procurement sourcing agent that converts unstructured purchase requests into structured, defensible supplier comparisons. Every decision flows through a full governance pipeline: **Supervisor → Specialists → Critic → Judge → Reviewer** — with deterministic fallbacks ensuring no request is ever left without an answer.

## Quick Start

```bash
# Backend (port 8000)
cd hackathon-procurement
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
export $(cat .env | xargs)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Frontend (port 3000) — in a separate terminal
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**

| Service | Port | Stack |
|---------|------|-------|
| Backend API | `8000` | FastAPI + Claude Haiku/Sonnet |
| Frontend UI | `3000` | Next.js 14 + Tailwind CSS |

---

## What It Does

1. **Interprets** unstructured purchase requests (any language, any format)
2. **Extracts** structured requirements: category, quantity, budget, delivery constraints
3. **Validates** for completeness, contradictions, and policy conflicts
4. **Applies** procurement rules: approval thresholds, preferred/restricted suppliers, geography rules
5. **Ranks** suppliers using 4 parallel AI specialists + 3 governance agents
6. **Explains** every decision with full audit trail — chain of thoughts from intake to recommendation
7. **Escalates** when policy conditions require human involvement

---

## Architecture

```
Request Text → Extractor (Haiku) → Deterministic Constraint Snapshot
                                         ↓
                              Activation Plan (which modules?)
                                         ↓
                    ┌────────────────────────────────────────┐
                    │     4 Specialist Agents (parallel)      │
                    │  Historical · Risk · Value · Strategic  │
                    └────────────────────────────────────────┘
                                         ↓
                    ┌────────────────────────────────────────┐
                    │      3 Governance Agents (sequential)   │
                    │     Critic → Judge → Reviewer           │
                    └────────────────────────────────────────┘
                                         ↓
                              Final Recommendation
                         (with full process trace)
```

**Deterministic fallback**: If all agents fail, the system falls back to a pure rule-based ranking (cheapest-first by total contract value) with confidence=0.2 — ensuring every request always gets an answer.

---

## Pages

| Page | Route | Description |
|------|-------|-------------|
| **Procure** | `/` | Submit free-text requests with real-time Chain of Thoughts pipeline visualization |
| **Backlog** | `/backlog` | Track active requests with Next Steps actions and follow-through recommendations |
| **Historical** | `/historical` | Browse 590 past procurement awards with category/country filters |
| **Analytics** | `/analytics` | CPO-level dashboard: spend trends, risk heatmap, supplier concentration (HHI), savings performance, audit report generation |
| **Whitespace** | `/whitespace` | Unmatched categories with market analysis (pros/cons) and vendor comparison |
| **About** | `/about` | System information |

---

## Key Features

### Real-Time Chain of Thoughts
Every analysis streams progress steps horizontally — the user sees each pipeline stage complete in real-time (extraction → validation → supplier screening → specialist agents → governance → recommendation).

### Audit Trail
Complete numbered decision chain showing every step from request interpretation to final recommendation. Every claim cites specific data points (award IDs, supplier scores, policy rules).

### Audit Report Generation
One-click PDF-ready audit report with 10 sections: Executive Summary, Scope, Policy Compliance, Escalation Routing, Supplier Concentration (HHI), Savings Performance, Risk Assessment, Geographic Coverage, Recommendations, and Sign-Off blocks.

### Next Steps & Backlog
After analysis, users toggle recommended actions (send RFPs, contact suppliers, escalate approvals) and track their status in the Backlog with simulated progress updates.

### Smart Parsing
Multi-layer extraction with guardrails:
- Budget vs quantity confusion prevention (500 units ≠ 500k budget)
- Timeline detection ("in 30 days" = delivery date, not quantity)
- +/- tolerance parsing ("500k +/- 11%" → min/max correctly computed)
- Post-extraction sanity checks catch remaining edge cases

---

## Data

| File | Records | Description |
|------|---------|-------------|
| `requests.json` | 304 | Unstructured purchase requests (9 scenario types) |
| `suppliers.csv` | 151 rows / 40 suppliers | Supplier capabilities, risk, ESG scores |
| `pricing.csv` | 599 | Volume-tiered pricing across regions |
| `policies.json` | 6 sections | Approval thresholds, restrictions, escalation rules |
| `historical_awards.csv` | 590 | Past sourcing decisions with rationale |
| `categories.csv` | 30 | Category taxonomy |

---

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, Anthropic Claude API (Haiku for speed, Sonnet available)
- **Frontend**: Next.js 14, React 18, Tailwind CSS, TypeScript
- **AI Models**: Claude Haiku 4.5 (specialists + extraction), Claude Sonnet 4.6 (available for complex cases)
- **Streaming**: Server-Sent Events (SSE) for real-time pipeline progress

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analyze/custom` | Analyze free-text request |
| `POST` | `/api/analyze/custom/stream` | Streaming analysis with SSE |
| `POST` | `/api/analyze/{id}/stream` | Stream analysis for existing request |
| `GET` | `/api/requests` | List requests (filterable) |
| `GET` | `/api/historical` | Historical awards (filterable) |
| `GET` | `/api/stats` | Aggregate statistics |
| `GET` | `/api/whitespace` | Whitespace categories |
| `GET` | `/api/health` | Health check |

---

## Team

Built at START Hack 2026.

---

*ChainIQ — Every procurement decision, focused and streamlined.*
