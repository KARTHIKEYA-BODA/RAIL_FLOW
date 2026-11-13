# Station access and real train data setup

This is a decision-support simulation, not an operational railway control system. It does not control signals or contact railway personnel. The existing chart, station master arrivals, recommendations, infrastructure, incident handling and benchmark remain simulated. The RailRadar station board is a separate, on-demand reference display. Saved timetables can be used in an isolated preview and displayed and reviewed in Section Control as a recorded replay; they do not change the active solver plan. Do not use this prototype to direct trains or emergency response.

## Start in order (Windows PowerShell)

1. Create an account and activate an API key at https://railradar.in/docs/quickstart. Check the current plan and quota. The provider's quickstart currently describes 100 requests per month on its free plan, not 300 per day.
2. In a terminal at the project root, set the credentials for this backend process (choose your own 4–12 digit PIN). Do not share or commit either value:

   ```powershell
   $env:STATION_MASTER_PIN = 'your-numeric-pin'
   $env:RAILRADAR_API_KEY = 'your-railradar-key'
   .\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
   ```

   Replace both placeholders; the PIN must contain digits only. Environment variables apply to this terminal session. The application does not automatically load backend/.env.
3. In a second terminal, run `npm run dev` and open the address printed by Vite.
4. Open **Station Master (SC)**, enter the PIN, choose a reference station and select **Load station board**. SC, Medchal, Manoharabad and Wadiaram are available as public reference boards; the station-master session and instruction access remain scoped to SC. Results are cached per station on the server for 15 minutes; the button will not make another provider request within that time. If the provider later fails, a previous cached result is marked stale. Restarting the backend clears the in-memory cache. Each successful fresh board fetch is recorded locally in backend/data/station_snapshots.sqlite3; select Show recorded boards to replay it without another API call.
5. To find corridor candidates, choose stations and a direction under Find trains between stations. Each uncached search costs one request and only finds trains serving both endpoints. Search both directions and use multiple pairs; some services bypass SC. Select a result or enter a train number, then use Check route or Check live status. Each uncached lookup uses another request. Route and between-station responses are cached for 24 hours in memory, and live status for 15 minutes. A successful route check also saves a normalized timetable for review in the same local database. Use Show saved routes to inspect the list. The normalizer preserves provider day offsets and flags missing times, missing days, gaps, and route reversals; it never fills in missing times.
6. Lock the view when finished. The session expires after one hour; reopening the view also requires the PIN. If the PIN or key changes, restart the backend. Never add the key to frontend `VITE_` variables.

## What this data means

RailRadar's station board supplies scheduled and expected times, delay and status for its two-hour window; entries marked `scheduled` do not necessarily have a live observation. It is not a complete list of all trains in the corridor or an exact GPS feed. The provider's separate live train endpoint can supply position when available; even then the observation can be stale or estimated. A timetable does not identify the cause of a delay. Confirm current operational information through authorized railway systems and staff.

The pasted train list and DataMeet historical dataset have not been verified as a current timetable. The simulated SC–WDR track layout, loops, platforms, blocks and train movements are assumptions, not validated infrastructure. Current track configuration and train lists require railway verification. Kacheguda/Malkajgiri services may not call at Secunderabad; a station board for SC alone will not discover every corridor service.

## How the existing simulation works

A schedule helps the solver compare which trains compete for the same modelled track and when. A passenger app primarily displays an individual journey; the prototype compares alternative simulated movements, holds and maintenance windows. The controller reviews the result, and acceptance changes only the simulation. An accepted recommendation can still be wrong; the model lacks verified real occupancy, infrastructure, real incidents and an independent operational safety validation. Railway signalling, interlocking, prescribed procedures and qualified staff remain essential; no safety outcome is guaranteed by this prototype.

Reports enter the running backend's memory as provisional and a separate impact preview is calculated. The active simulated plan changes only after Section Control selects Confirm report. Show report history lists the saved simulation lifecycle events. Reports do not send a message to railway staff, rescue services or external systems, and are saved locally. After a backend restart, unresolved reports return as provisional and require a fresh impact preview before confirmation; old simulated constraints are not automatically reapplied. The form records a station and requires an explicit simulated block for signal, locomotive and speed-restriction reports, or an explicit platform for a platform blockage. A safety incident without a selected platform does not close a track block in the model; it does not establish a crash's location. Use official channels immediately for real incidents. A report that cannot be sent is not saved or automatically retried. Do not interpret a report as verified, dispatched, acknowledged, or cleared in a real railway system.

## Access limitations and next steps

The PIN gate and RailRadar board use a short-lived server-side session with basic attempt limiting. This protects the new board endpoint and gates the station screen, but existing simulation endpoints are not protected by role-based authorization; anyone able to access the backend can call them directly. This is a local demo gate, not full station-scoped RBAC. Use a private local deployment only. Production requires authenticated individual accounts, authorization on every endpoint, TLS, persistent shared sessions and rate limits, a durable audit, secure credential management, an incident lifecycle and verified infrastructure/data agreements.

Before integrating live data into optimization, obtain authorized, timestamped train movements and validated topology, block occupancy, route permissions and maintenance constraints. Normalize schedules including operating days and overnight offsets, create a reliable replay, validate input freshness, and measure the solver and baselines on identical scenarios. Test with actual provider credentials and compare results against official railway sources. Do not advertise the five-second target or a baseline improvement as achieved for every scenario without measurements.

The route comparison checks station codes from the provider against the modelled stations. It does not prove that the intervening real-world infrastructure matches the model, or that a train is currently occupying it. A recorded board replays a station display only; it is not a solver replay. Provider timestamps and observations can be stale or estimated.


## Isolated timetable preview and replay

1. Check and save train routes as described above. Under **Test saved train routes**, select **Load saved routes**.
2. Choose the date each train reaches its first modelled corridor station, select up to 20 trains, optionally choose a synthetic late train, locomotive failure or closed block, and run the timetable preview. A provider's running days refer to its origin date, so the preview uses the timetable day offset to check whether each train runs on the corresponding origin date. Missing times, non-consecutive model stations, unknown classes and contradictory routes are excluded with a reason.
3. Results use the existing assumed infrastructure and assumed class priorities. They do not include live locations, occupancy, real-world incidents, real maintenance or verified operating instructions. The optional disruption is synthetic: locomotive failure adds block running time, and a block closure occupies the modelled section for its selected interval. The preview replays the same selected trains under FCFS, priority and solver-guided policies, reports completed trains and model violations, and suppresses delay totals for incomplete replays. No improvement is guaranteed. The active Section Control simulation is untouched.
4. Every preview stores its exact saved timetable inputs, results and an input fingerprint. **Show saved previews** loads the stored result without consuming provider quota or rerunning the solver. A replay reproduces the stored output; it is not evidence that a new solver run would produce identical choices.

The preview is a model experiment for a hackathon, not an operational train plan. Provider data may be outdated, and passing checks does not establish that track layout, speed limits or operating rules match the real railway.


## Controller report flow and infrastructure status

Use Report to create a provisional simulated incident; Section Control displays its preview and confirms it. Confirmation recomputes the active simulation, and an unsuccessful confirmation leaves the report provisional. Polling for reports is local to the app every five seconds; it does not call RailRadar. This is an interface workflow, not enforced role-based authorization, because the prototype controller endpoints have no controller authentication. A safety incident without an explicit modelled platform does not block a modelled line.

The `/corridor/blocks` endpoint labels every track type as `assumed`. Public station lists verify names and codes, but they do not establish block-by-block current track configuration or loop availability. Do not interpret the track model as verified until an authorized railway source confirms each section. The zero-delay check in an isolated timetable preview shows deviations over one minute; deviations can also come from timetable gaps, conflicts, solver modelling or speed assumptions, and do not by themselves prove a track-type error.


## Section Control replay and recorded station instructions

After creating a timetable preview in Station Master, select **Choose recorded timetable** on Section Control and choose a saved replay. The chart shows the saved result; platform numbers and infrastructure are not verified. The replay is not the active controller simulation. A recorded hold can be reviewed separately: preview an alternative and optionally show it on the chart, then record acceptance or rejection. Accepting records a simulation instruction for its station; rejecting records the comparison. Neither action changes the active plan. Return to simulation to use its incident and maintenance controls. No RailRadar request is made when loading the saved replay.

When a controller accepts a decision in the active synthetic simulation or a recorded replay, the app saves a simulation instruction to the local SQLite database. The SC Station Master can view and acknowledge SC instructions after entering the PIN. Records survive a backend restart but can refer to an old plan; they do not notify staff, change signals or establish a current railway instruction. Acknowledgement is a record only. Instructions for other stations are not exposed through the SC PIN. Controller endpoints remain unauthenticated in this local demo. Unresolved incident reports are restored as provisional after restart; the simulated active plan and old constraints are not restored.

Recorded hold comparisons require the same tracked model code and runtime versions as the saved result. If the model changes, or an older recording lacks a fingerprint, create a fresh timetable preview before reviewing; old results remain viewable. A replay rejection is a recorded review, not a change to the active controller plan.
