---
title: Kitchen Sink — every feature in one plan
project manager: Kévin McAleer
sponsor: 田中 太郎
budget: £125,000
status: Amber
theme: system
start date: 2026-06-01
custom_key: kept exactly as written, even though the app ignores it
Resources:
- @kev: Kévin McAleer, Project Manager
- @adam: Adam Reid, Platform Architect
- @qa: Quality Team, Testing
labels: [Urgent, DEV, review]
dependencies:
  - from: Infrastructure Project
    task: Server Setup Complete
    to_task: Deploy
    type: FS
    lag: 0
version: 1.4
last_saved: 2026-09-01 09:15
rag: amber
---

// A line comment: the app must keep it, indentation and all.

Discovery $discovery
  Kick-off workshop @kev 1d 100% "Held on site" #urgent
  *Interviews @kev, @adam 3d 60% !!
  *Write findings @kev 2d ~8h/16h #dev
  Decision point $decision 0d [depends Write findings] !!!

Build $build [depends $discovery]
  Design
    Wireframes @adam 5d [depends $decision] {Design} #review
    *Visual design @adam 3d
  Develop
    Backend @adam 10d [depends Wireframes:SS +2d, Visual design -1d]
    *Frontend @adam 8d
    *+1d Integration @adam, @qa 2d
  Test @qa 5d [depends Backend, Frontend] [repeats weekly] 2026-08-03
  Deploy ^$deploy 1d [depends Test] "Needs the change board"

Close /$closure
  Lessons learned @kev 1d
  *Handover @kev 1d 'single-quoted comment'
  Project closed 0d

---highlights---
## 2026-06-08 @kev
- Kick-off held; sponsor happy
- Interviews under way — two done

## 2026-06-15 @adam
**Progress summary**

- Findings drafted
---end-highlights---

---raid log---
| ID | Type  | Title      | Description                     | Raised By | Owner | Mitigation Actions      | Impact | Likelihood | Score | Status |
|----|-------|------------|---------------------------------|-----------|-------|-------------------------|--------|------------|-------|--------|
| 1  | risk  | Late spec  | Spec may slip into July         | Kev       | Adam  | Weekly check-in         | 3      | 2          | 6     | open   |
| 2  | issue | Test env   | Test environment not available  | QA        | Adam  | Borrow staging          | 4      | 5          | 20    | closed |

---comms---
# Communications Plan

| ID | Activity             | Audience       | Content          | Frequency | Channel | Owner | Status |
|----|----------------------|----------------|------------------|-----------|---------|-------|--------|
| 1  | Weekly status update | Steering Board | Progress summary | Weekly    | Email   | Kev   | Active |

---budget---
| ID | Description        | Estimate | Forecast | Type  | Invoice | PO    | Supplier | Total | Date Ordered | Date Received | Category |
|----|--------------------|----------|----------|-------|---------|-------|----------|-------|--------------|---------------|----------|
| 1  | Licences           | 5000     | 5200     | opex  | INV-1   | PO-1  | Vendor A | 5200  | 2026-06-02   | 2026-06-10    | Software |

---benefits---
| ID | Type      | Title           | Description             | Objective Type | Target Value | Current Value | Target Date | Measurement Method | Linked To | Contribution % |
|----|-----------|-----------------|-------------------------|----------------|--------------|---------------|-------------|--------------------|-----------|----------------|
| 1  | financial | Lower run cost  | Retire the old platform | reduce         | 20000        | 0             | 2026-12-31  | Finance report     | Deploy    | 100            |

---lessons learned---
| ID | Project Manager | Project Type | Technology | Project Phase | Area     | Impact Type | Observation                 | Impact          | Recommendations        | Date       |
|----|-----------------|--------------|------------|---------------|----------|-------------|-----------------------------|-----------------|------------------------|------------|
| 1  | Kev             | Software     | Python     | Discovery     | Planning | positive    | Early interviews paid off   | Fewer reworks   | Always interview first | 2026-06-15 |

---baseline---
| Task Name         | Start      | Finish     | Duration |
|-------------------|------------|------------|----------|
| Kick-off workshop | 2026-06-01 | 2026-06-01 | 1d       |
| Interviews        | 2026-06-02 | 2026-06-04 | 3d       |
