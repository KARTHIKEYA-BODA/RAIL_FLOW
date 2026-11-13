# Safety and limitations — Railway Brain

Railway Brain is a **synthetic decision-support prototype**. It is not a signalling, interlocking, train-protection, or operational control system. Do not use its output to direct real trains. The screen labels the timetable as simulation and does not issue instructions to field equipment.

The CP-SAT model represents single-track occupancy, directional headways, simplified station capacities, minimum dwell and running times, and maintenance exclusions as constraints. These are model constraints, not proof of compliance with railway rules or safety certification. The simulator is an independent, simplified replay and conservatively reserves a berth before a train enters a block. Both require further validation against actual operating rules and data.

Important limitations:

- The active controller plan, corridor topology, train weights and disruptions are synthetic. The optional RailRadar board and route lookup are separate reference data; they do not provide verified block occupancy or signalling state.
- The controller workflow does not yet pass a live current-time rolling horizon into the solver; past and already-authorized movements must not be assumed frozen.
- The model does not represent individual signals, points, train braking, route locking, crew, rolling stock, or all real-world operating constraints. It does not implement or verify Kavach.
- Solver status is shown: `FEASIBLE` is not a proof of optimality. A time limit can yield no feasible result.
- An alternative preview is conditional on the chosen minimum-dwell assumption. A re-solve may produce a different time-limited result; its weighted delay difference is an estimate within this model, not a guarantee.
- The active controller plan remains in memory. Incident history, recorded timetable previews, replay reviews and simulated station instructions use local SQLite storage, but are not an immutable, shared or operational audit trail.
- The five-second requirement must be tested end to end for each relevant disruption and workload; a solver time limit alone is not proof.

Maintenance planning evaluates discrete candidate start times with time-limited solves. It recommends the best result found among feasible candidates, not a proven global optimum. The user reviews and commits a preview; the app refuses a stale preview after the plan changes.
