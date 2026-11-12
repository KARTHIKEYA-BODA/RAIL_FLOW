# Railway Brain — four-minute demo

Use the current application and live numbers. All data is synthetic; never read a fixed delay saving or solve time from this script.

## Before presenting

From the project root start the backend with `.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000`, and in another terminal run `npm run dev`. Open the local URL printed by Vite. Run `.\.venv\Scripts\python.exe backend/benchmark.py` to refresh the benchmark report after model changes. Check that the Proof page says the results are current.

## 0:00–0:45 — The problem

“A section controller must decide which trains wait or cross when a shared track is disrupted. Railway Brain is a simulation prototype that proposes a section schedule, lets the controller inspect an alternative, and helps plan maintenance. It does not control real trains.”

Point out the SC–WDR time–distance chart, the simulation label, solver status and weighted-delay metric.

## 0:45–1:45 — Disruption and re-plan

Choose **Report disruption**, select a real train from the displayed list and a duration, and choose **Preview**. Explain that the preview is not applied. Show the displayed weighted-delay change, then choose **Apply preview**. Point out the old and revised plan on the chart and read the actual solver time and status. Do not claim the five-second requirement is met for every situation based on this single run.

## 1:45–2:35 — Explain and compare a decision

Read the current hold recommendation. If it names another train, explain that the plan shows that train clearing the same block first. Choose **Preview without this hold**. Read the actual change in weighted delay and the minimum-dwell assumption. Explain that `FEASIBLE` is a time-limited solution, and that the alternative is one possible modelled choice. Choose **Accept**, or **Reject & re-plan** after reviewing the preview.

## 2:35–3:20 — Maintenance

Open **Maintenance**, choose a block, duration and a same-day window, then select **Find a slot**. Compare the feasible candidates by weighted delay. Explain that this is the best result found among the sampled slots and time-limited solves. Choose **Commit maintenance** and point out the block on the chart.

## 3:20–4:00 — Evidence and limits

Open **Proof**. Read the measured FCFS, priority and solver results for a scenario where the solver wins and one where it does not, if present. Identify the seeds, synthetic timetable and solver status. Finish: “This demonstrates a controller workflow on a simplified model; it still needs stronger benchmarking, operational data and safety validation before any real-world use.”
