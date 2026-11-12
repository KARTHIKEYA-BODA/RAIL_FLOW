# Railway Brain — Disruption-Resilient Train Control Decision Support (PS-09)

> **Theme**: Smart Automation · **Type**: Software (Optimisation)
> **Target Operational Territory**: South Central Railway (SCR), Secunderabad – Wadiaram Corridor (~70 km)

---

## 📌 Problem Background & Objective

Section controllers in Indian Railways make critical train precedence, crossing, and halting decisions largely by experience. On high-density lines—particularly corridors transitioning from multi-track hubs into single-track stretches—a single delayed express can cascade into dozens of delayed commuter and freight trains. Furthermore, periodic track maintenance blocks compete directly with revenue traffic for track occupancy.

**Railway Brain** is a simulation prototype for section controllers. The focused interface supports three tasks:

1. Re-plan the synthetic SC–WDR timetable after a disruption.
2. Review a proposed hold and preview a re-solved alternative before accepting or rejecting it.
3. Compare maintenance start times, then explicitly commit a selected block.

The controller screen is a simulation; it does not control trains or connect to signalling. A solver result marked `FEASIBLE` is time-limited, not necessarily optimal. The alternative preview compares weighted destination delay under a specific minimum-dwell assumption; it is not a guarantee of what would happen in real operations.

## Benchmark status

The **Proof** screen displays the latest generated report from 30 synthetic trains and seeds 42 and 101. Results vary by scenario: the solver can lose to a baseline, and time-limited feasible solutions are not guaranteed optimal. The replay and solver use simplified infrastructure and disruption models, so these results are not evidence of real railway performance. The older `benchmark_results.json` predates the current solver and must not be treated as current.

Run `python backend/benchmark.py` from the project root to regenerate the report. The interface marks it stale when benchmark, solver, simulator, or timetable-model code changes.

A single local late-train request completed in approximately 3.5 seconds, including the API request; this is not evidence that every scenario meets the five-second requirement.

---

## System architecture

The React controller screen reads the synthetic timetable and submits previews and decisions to a FastAPI service. The service stores simulation state in memory and calls the OR-Tools CP-SAT scheduler. A separate event simulator replays FCFS, priority and solver-guided plans for the benchmark. There is no live railway integration or durable operational audit.

- [Formulation](./FORMULATION.md): model constraints, objective and explanation approach.
- [Safety and limitations](./SAFETY_AND_LIMITATIONS.md): prototype boundaries and remaining work.
- [Demo script](./DEMO_SCRIPT.md): a four-minute walkthrough using current values.
- [Data plan](./DATA_PLAN.md): background on synthetic corridor generation; check it against the current model before using its older claims.

---

## 🛠️ Verification & Test Suites

The project features automated regression tests across both the Python optimization core and the React TypeScript frontend:

### 1. Backend Invariant & API Tests (Pytest)
```bash
# Run backend tests
.venv\Scripts\python.exe -m pytest -v
```
These tests cover solver timing, single- and double-track maintenance exclusion, and selected solver invariants. Passing them does not establish railway safety certification or end-to-end performance for all cases.

### 2. Frontend Component & Logic Tests (Vitest)
```bash
# Run all 47 frontend tests
npm test -- --run
```
Run this after frontend changes.

### 3. Production Build
```bash
npm run build
```
Run this to check the production build.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python**: 3.10+ (Tested on Python 3.11–3.14)
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later

### Step 1: Start Backend Server
```bash
cd backend
# Create and activate virtual environment if not present
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
# source venv/bin/activate

# Install dependencies (FastAPI, OR-Tools, Uvicorn, Pytest)
pip install -r requirements.txt

# Start the server
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
*Backend runs at `http://127.0.0.1:8000` with Swagger docs at `http://127.0.0.1:8000/docs`.*

### Step 2: Start Frontend Application
In a separate terminal window:
```bash
# In the root repository directory
npm install
npm run dev
```
*Open `http://localhost:5173` in your browser.*

---

## Demonstration

Open the Control view, report a disruption, and review the proposed hold. Use **Preview without this hold** to evaluate a specific alternative. Accept the recommendation or reject it and re-plan. Use **Maintenance** to compare candidate slots and explicitly commit a feasible one. All data is synthetic.

The benchmark proof target, end-to-end performance across scenarios, and operational safety validation remain open work. Earlier demo scripts and supporting documents may describe the previous interface and should be checked against the running application.
