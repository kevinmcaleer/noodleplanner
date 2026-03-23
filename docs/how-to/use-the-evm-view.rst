How to Use the EVM View
========================

The EVM (Earned Value Management) view provides analytical metrics for tracking project performance against the schedule and budget baselines.

Open the EVM View
------------------

1. Click **Tracking** in the project sub-navigation bar
2. Select **EVM** or **Analysis** from the dropdown

Metrics Displayed
------------------

The EVM view shows the following earned value metrics:

- **Planned Value (PV)** — the budgeted cost of work scheduled to date
- **Earned Value (EV)** — the budgeted cost of work actually completed
- **Actual Cost (AC)** — the actual cost incurred for work completed
- **Schedule Variance (SV)** — EV minus PV; negative means behind schedule
- **Cost Variance (CV)** — EV minus AC; negative means over budget
- **Schedule Performance Index (SPI)** — EV divided by PV; below 1.0 means behind schedule
- **Cost Performance Index (CPI)** — EV divided by AC; below 1.0 means over budget

Read the Charts
----------------

The EVM view includes an S-curve chart plotting PV, EV, and AC over time. The gap between the curves shows schedule and cost variance at any point.

- If the **EV line is below PV**, the project is behind schedule
- If the **AC line is above EV**, the project is over budget
- The curves converging indicates the project is recovering

.. note::

   EVM metrics are most useful when tasks have estimated costs or effort values. Without cost data, the metrics are based on task duration and percentage complete.

Related
--------

- :doc:`use-baselines` — setting schedule baselines
- :doc:`use-the-gantt-view` — Gantt view guide
- :doc:`../reference/views` — overview of all views
