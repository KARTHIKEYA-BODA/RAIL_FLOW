# Railway Brain — four-minute demo

Use the values shown in the application; never read a fixed delay saving or solve time from this script. Section Control uses synthetic trains unless a recorded timetable replay is selected. The replay uses provider timetable records with assumed infrastructure and synthetic disruptions, not verified live occupancy.

## Before presenting

From the project root start the backend with `.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000`, and in another terminal run `npm run dev`. Open the local URL printed by Vite. Run `.\.venv\Scripts\python.exe backend/benchmark.py` to refresh the benchmark report after model changes. Check that the Proof page says the results are current.

## 0:00–0:45 — The problem

“A section controller must decide which trains wait or cross when a shared track is disrupted. Railway Brain is a simulation prototype that proposes a section schedule, lets the controller inspect an alternative, and helps plan maintenance. It does not control real trains.”

Point out the SC–WDR time–distance chart, the simulation label, solver status and weighted-delay metric.

## 0:45–1:45 — Disruption and re-plan

Choose **Report disruption**, select a simulated train from the displayed list and a duration, and choose **Preview**. Explain that the preview is not applied. Show the displayed weighted-delay change, then choose **Apply preview**. Point out the old and revised plan on the chart and read the actual solver time and status. Do not claim the five-second requirement is met for every situation based on this single run.

## 1:45–2:35 — Explain and compare a decision

Read the current hold recommendation. If it names another train, explain that the plan shows that train clearing the same block first. Choose **Preview without this hold**. Read the actual change in weighted delay and the minimum-dwell assumption. Explain that `FEASIBLE` is a time-limited solution, and that the alternative is one possible modelled choice. Choose **Accept**, or **Reject & re-plan** after reviewing the preview.

## 2:35–3:20 — Maintenance

Open **Maintenance**, choose a block, duration and a same-day window, then select **Find a slot**. Compare the feasible candidates by weighted delay. Explain that this is the best result found among the sampled slots and time-limited solves. Choose **Commit maintenance** and point out the block on the chart.

## 3:20–4:00 — Evidence and limits

Open **Proof**. Read the measured FCFS, priority and solver results for a scenario where the solver wins and one where it does not, if present. Identify the seeds, synthetic timetable and solver status. Finish: “This demonstrates a controller workflow on a simplified model; it still needs stronger benchmarking, operational data and safety validation before any real-world use.”


## Optional: recorded timetable and report flow

Before the demo, use the Station Master PIN to check and save provider routes, select a corridor date, and run a timetable preview. Optionally select one synthetic late train, locomotive failure, or block closure. Check excluded trains and solver status; save a feasible result. No claim about real track occupancy follows from the preview. To avoid relying on provider availability during the demo, keep the saved preview on the same backend machine.

In Section Control, choose **Choose recorded timetable** and select the saved replay. Point out that the chart uses a provider timetable with assumed infrastructure and does not replace the active synthetic plan. If a current-model replay has a hold, preview the alternative, optionally show it on the chart, and record acceptance or rejection. The saved review and any station instruction are simulation records; they do not control trains. Return to simulation for incident or maintenance changes.

Use **Report** to submit a simulated incident. Show the provisional report and its impact preview in Section Control, then confirm it. A provisional report does not apply a constraint. A report in this prototype does not notify railway staff. A confirmed incident remains simulated. After restarting, unresolved saved reports are provisional and require a fresh preview.

When a pending active-simulation decision at SC is accepted, open the PIN-gated Station Master view and show the recorded instruction and its acknowledgement. This is an audit record, not a real train order; older records can relate to earlier plans. The Station Master view can report and acknowledge; it cannot accept/reject section-wide recommendations or clear a confirmed incident. Section Control owns those simulated decisions.

For track-model questions, point to `backend/data/infrastructure.json` or `/corridor/infrastructure`. It lists the complete prototype model and class runtime estimates, all explicitly marked assumed. Do not present its single/double track flags, loop counts, or runtimes as verified railway infrastructure.
