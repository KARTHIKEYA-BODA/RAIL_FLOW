# Data Plan & Corridor Simulation Specification (PS-09 Railway Brain)

## 1. Physical Corridor Specification: Secunderabad – Wadiaram

The operational network models a critical 70 km segment of the Indian Railways South Central Railway (SCR) division connecting Secunderabad to Wadiaram, including terminal links to Hyderabad Deccan (HYB) and Kacheguda (KCG).

### Station Infrastructure Topology

| Station Code | Station Name | Cumulative Distance (km) | Platforms / Loops | Track Topology to Next Station |
|---|---|---|---|---|
| **HYB** | Hyderabad Deccan (Terminus) | -9.8 km | 4 Platforms | Double Track to SC |
| **KCG** | Kacheguda (Junction) | -7.2 km | 3 Platforms | Double Track to SC |
| **SC** | Secunderabad Junction | **0.0 km** | 6 Platforms | Double Track to MJF (5.5 km) |
| **MJF** | Malkajgiri Junction | **5.5 km** | 3 Loops | Double Track to BMO (9.3 km) |
| **BMO** | Bolarum | **14.8 km** | 3 Loops | **Single Track begins** to MED (13.2 km) |
| **MED** | Medchal | **28.0 km** | 2 Loops | Single Track to MOB (14.0 km) |
| **MOB** | Manoharabad Junction | **42.0 km** | 3 Loops | Single Track to ME (14.5 km) |
| **ME** | Masaipet | **56.5 km** | 2 Loops | Single Track to WDR (13.5 km) |
| **WDR** | Wadiaram | **70.0 km** | 3 Loops | Corridor Terminus / Handover |

### Critical Operational Bottlenecks
1. **The BMO – WDR Single-Track Chokepoint (55.2 km)**:
   - Between Bolarum and Wadiaram, the mainline collapses to a single bidirectional track.
   - Any two trains traveling in opposite directions (UP towards SC, DOWN towards WDR) must be scheduled to pass each other exclusively at the intermediate station loops (`MED`, `MOB`, `ME`).
   - If a train is delayed entering this single-track bottleneck, an uncoordinated dispatcher will cause an accordion deadlock where opposing trains meet face-to-face, forcing reverse shunting or massive cascade delays.

2. **Secunderabad Junction Throat (SC)**:
   - Intersecting junction where suburban MMTS, long-distance express rakes, and through freight traffic converge onto shared platform leads.

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
