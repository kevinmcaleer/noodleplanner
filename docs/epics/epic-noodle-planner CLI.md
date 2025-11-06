# Epic: Noodle Planner CLI Tool
Epic ID: EPIC-NOODLE-001
Status: Proposed
Author: Team
Date Created: 2025-08-26

## Objective
To create a commandline tool for reading in a list of project tasks written in a natural language styled Markdown format, and outputting a timeline visualization and Gantt chart in Markdown/ASCII format.

The idea is that a simple markdown formated project list can be turned into a project plan with minimal effort. No data needs to be stored in a database, everything is file based and portable.

Project artefacts can be generated from this simple format including:
- Project timeline in Markdown table format
- Gantt chart in ASCII format
- Resource allocation chart in ASCII format
- An Excel spreadsheet containing all project data in a project table format, similar to MS Project export.

Natural language can be used to define tasks, durations, dependencies, and milestones in a way that is easy to read and write. the aim is to minimize the amount of data and structure that the project manager needs to provide, while still capturing all necessary information for effective project planning and tracking.

Example input format:

```markdown
--- 
title: Sample Project
project manager: Kevin
Resources:
- @Andy: Andy Mcarthy, Lead Developer
- @Bob: Bob Smith, Developer, 50%
- @Charlie: Charlie Brown, QA Engineer
- @Diana: Diana Prince, Product Owner
- @Frank: Frank Castle, DevOps Engineer
- @Eve: Eve Adams, Project Coordinator

Holidays:
- 2025-12-25
- 2025-12-26
---

Requirements
  capture requirements @Alice 3days 50%
Design
  Low Level Design @Andy 2days [depends capture requirements]
Build
  develop software @Bob 5days [depends Low Level Design]
Test
  test plan @Charlie 3days [depends develop software]
  * system testing @Charlie 4days
  * user acceptance testing @Diana 2days
  * Testing Complete 0d
Deploy
  go-no-go decision @Eve 1day [depends user acceptance testing]
  * go live @Frank 1day
  * Deploy Complete 0d
Support
  hypercare @Grace 7days [depends go live]
```

Project resources can be defined at the start of the file using the `@resource_name: Full Name, Role, Allocation%` format.
Project holidays can also be defined to exclude non-working days from task scheduling.
Task scheduling will default to a 8 hour day, 5-day work week, excluding weekends and defined holidays. These defaults can be adjusted via frontmatter parameters.

## Background
The Noodle Planner is inspired by the need for a more intuitive and flexible project management tool that can easily adapt to various workflows and team structures. By leveraging natural language processing and a simple Markdown syntax, we aim to create a tool that is both powerful and easy to use.

One of the challenges with existing project management tools is that they require special software to run and are complex to configure.

Noodle planner aims to simply the capture of tasks, filling in information where provided and using defaults where it is not. 

Noodle planner will default task durations to 1 day by default, with a start day of the current day if not provided in the first task.

A Summary task has no duration and is used to group related tasks together, summary tasks have indented sub-tasks beneath them.  Subtasks can also have their own sub-tasks (making them summary tasks in their own right).

Task dependencies are implied if the task contains a "*" character (dependent on the previously listed task in the file - excluding summary tasks).

Task dependencies can also be explicitly defined using the `#task_id` format.

Task completion can be provided using the `!` character followed by the completion status. e.g.

Miletones are tasks that have a duration of 0 days.

Project completion percentage can be provided as `%100` which indicates that the task is 100% complete.

---

## Resource Management

Task Resources can be specified using the `@resource_name` convention for each task.  Resource allocation percentage can also be specified after the duration using the `50%` format.

A resource profile will be created for each unique resource name, allowing for better tracking and management of resources across tasks.

---
