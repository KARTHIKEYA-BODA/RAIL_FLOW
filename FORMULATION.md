# Solver formulation — Railway Brain

Railway Brain is a synthetic section-control decision-support prototype for the SC–WDR corridor. It produces an advisory schedule; it is not connected to railway signalling. The model and the simulator simplify real railway operations.

## Variables and objective

For each train and station, CP-SAT chooses arrival and departure seconds. Their difference is a station occupancy interval with at least the train's minimum dwell. Consecutive departure and arrival times define occupation of the block between the stations. The solver minimizes weighted delay at each train's final station. Class weights are synthetic modelling choices: express 3, suburban 2, passenger 1.5, freight 1. When a previous schedule is supplied, an additional stability penalty discourages changes to arrival times; this can trade off against delay.

## Constraints

- The schedule cannot run earlier than the modelled timetable; dwell and block running times must meet the modelled minima.
- A single-track block cannot contain overlapping train or maintenance intervals. On double track, same-direction entries observe a modelled headway, and maintenance excludes the affected directions for the whole occupancy interval.
- A cumulative limit bounds simultaneous station dwell intervals by the modelled platform and loop capacity.
- Signal and speed restrictions change running time when the actual block entry occurs during the specified interval. A modelled locomotive failure adds time on the selected block; a late train starts later.
- The solver has an optional frozen-window constraint when a current time and previous schedule are passed. The present controller endpoint does not yet supply a current-time rolling-horizon state, so it must not be described as protecting already-issued movement authorities.

The optimizer uses a three-second search limit. `OPTIMAL` means CP-SAT proved optimality for this formulation; `FEASIBLE` means a feasible solution was found without an optimality proof. A baseline schedule can be supplied as a search hint; it does not change the objective or guarantee the hint is feasible.

## Explanation and comparison

A hold is taken from the proposed schedule. Where the plan shows another train clearing the same single-track block during that hold, the reason names that movement. Otherwise the reason describes the hold without inventing a beneficiary. The rejection preview solves an alternative in which the train takes only its minimum dwell at the chosen station and compares total weighted destination delay. Both plans may be time-limited feasible solutions; the difference depends on the selected alternative and is not a guarantee for real operations.

The benchmark replays FCFS, priority and solver-guided schedules using the same synthetic scenarios and rejects runs that do not complete within the simulation horizon. The replay makes conservative berth reservations and has its own simplifications, so replay outcomes can differ from the optimizer's objective. Run `python backend/benchmark.py` from the project root to regenerate the Proof screen's source-fingerprinted report.
