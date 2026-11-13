# Data Plan & Corridor Simulation Specification (PS-09 Railway Brain)

## 1. Corridor Model and Data Boundaries

The executable prototype model is exported to [`backend/data/infrastructure.json`](backend/data/infrastructure.json) by `backend/export_infrastructure.py`; the API exposes the same current model at `/corridor/infrastructure`. The export includes every modeled station and block, track type, assumed platform and loop counts, class speed caps, and calculated minimum runtime for all four classes.

**Every infrastructure value is currently an assumption.** The repository does not contain railway engineering records that verify track configuration, block boundaries, loop capacity, platform capacity, speed limits, or headways. The labels `single` and `double` describe the simulation model only. They must not be read as a surveyed route or as proof of safe train separation.

The main solver order is `SC → MJF → BMO → MED → MOB → ME → WDR`. HYB and KCG are auxiliary modeled nodes. Intermediate halts such as Gowdavalli, Dabilpur, Brahmanpalli, and Srinivasa Nagar have not been inserted into the solver because this workspace does not have a checked source defining their current order, block relationship, and model timings. Their absence is a known coverage gap; a route that skips a modeled station is excluded from timetable replay instead of having an invented movement filled in.

Runtime values in the manifest use `distance / class speed × 3600`, rounded to seconds. They are simplified model minimums, not runtimes derived from verified operating timetables. Model speed assumptions are 100 km/h Express, 80 Suburban, 75 Passenger, and 60 Freight; weighted-delay costs use weights 3, 2, 1.5, and 1 respectively. These weights and speeds describe the experiment, not Indian Railways policy.

Do not use the suggested Google/Claude train list or the synthetic benchmark as a verified traffic census. Provider schedules are normalized from RailRadar only after a user checks a route. The provider board and saved route records are timetable/reference observations, not block occupancy or proof of the train's exact location.

---

## 2. 24-Hour Synthetic Timetable Generation

To rigorously evaluate the optimization system under heavy traffic density, the generator synthesizes a realistic 24-hour timetable based on South Central Railway operating patterns.

### Generation Parameters & Distribution
- **Total Monitored Trains**: 80 to 120 trains per 24-hour simulation cycle.
- **Random Seed**: Deterministic PRNG seed (`seed=42` default, `seed=101` for validation) ensuring 100% reproducible benchmarks.
- **Traffic Density Temporal Profile**:
  - **Morning Peak (07:00 – 10:30)**: High suburban (MMTS) frequency + inbound express arrivals.
  - **Midday Inter-City (10:30 – 16:30)**: Passenger trains and container freight slots.
  - **Evening Peak (16:30 – 21:00)**: Heavy commuter departures + outbound superfast trains.
  - **Night Window (21:00 – 06:00)**: Long-haul freight paths and track maintenance opportunities.

### Train Class Characteristics

| Class | Share of Traffic | Priority Weight ($w_i$) | Max Speed | Base Dwell Time | Passenger Halts |
|---|---|---|---|---|---|
| **Express / Superfast** | 30% | **3.0** | 100–110 km/h | 2–4 min | SC, BMO, MED, WDR |
| **Suburban (MMTS)** | 35% | **2.0** | 80 km/h | 1–2 min | All stations |
| **Ordinary Passenger** | 20% | **1.5** | 75 km/h | 2–3 min | All stations |
| **Freight** | 15% | **1.0** | 60 km/h | 0 min (technical only) | Non-stopping unless looped |

### Kinematic Run Times & Gaussian Friction Noise
For each block $b$ connecting station $k$ and $k+1$ with distance $d_b$:
$$t^{run}_{nominal} = \frac{d_b}{v_{max}(class)} \times 3600 \text{ seconds}$$

To reflect real-world physical friction (cautious driving, slight braking variations, passenger boarding surges), runtime noise is sampled from a truncated Gaussian distribution:
$$t^{run}_{actual} = t^{run}_{nominal} + \epsilon, \quad \epsilon \sim \mathcal{N}\left(\mu=0, \sigma=25\text{s}\right), \quad \epsilon \in [-60\text{s}, +120\text{s}]$$

---

## 3. Disruption Injection & Simulation Suite

The system includes a concrete, unified disruption injection framework supporting four distinct operational failure modes:

1. **Late Priority Train (`late_train`)**:
   - Primary delay injected at corridor entry (e.g. Express T101 arrives +15 to +45 min late at SC/WDR).
   - Tests if the solver holds lower-priority trains to restore express punctuality or allows the express to follow without triggering secondary cascades.

2. **Locomotive Failure / Stalled Train (`loco_failure`)**:
   - A train stalls inside a single-track block (e.g. `BMO_MED` or `MOB_ME`) for 30 to 60 minutes.
   - Completely closes the single-track section. Tests whether the solver queues trains at upstream passing loops or routes around the bottleneck.

3. **Signal Failure / Temporary Speed Restriction (`signal_failure` / `speed_restriction`)**:
   - Signal drops to caution/danger or engineering caution order imposed: block speed capped at 25 km/h for a 60–120 minute window.
   - Block traversal times triple, creating dynamic capacity shrinkage.

4. **Hard Maintenance Block (`maintenance_window`)**:
   - Absolute closure of a chosen block for 90 to 180 minutes.
   - Evaluates the Maintenance Placement Optimizer to discover the minimum-loss execution window.

---

## 4. Ground Truth & Honesty Disclosure

1. **Synthetic vs Operational Data**:
   - All benchmark timetables are deterministically generated synthetic data modeled after South Central Railway timetable patterns.
   - They do not represent live Indian Railways COA (Control Office Application) feeds.
2. **Kinematic Simplification**:
   - Acceleration and deceleration curves are represented via block-level minimum runtimes with Gaussian variance rather than continuous multi-body traction dynamics.
3. **Reproducibility Guarantee**:
   - All numbers reported in documentation and UI are generated by executing `backend/benchmark.py` and `backend/cpsat_solver.py` with fixed random seeds (`seed=42, 101, 2024`).
