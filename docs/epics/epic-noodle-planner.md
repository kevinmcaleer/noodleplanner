# Epic: Noodle Planner
Epic ID: EPIC-NOODLE-001
Status: Proposed
Author: Team
Date Created: 2025-08-26

## Objective
To create a commandline tool for reading in a list of project tasks written in a natural language styled YAML format, and outputting a timeline visualization and Gantt chart in Markdown/ASCII format.

## Background
The Noodle Planner is inspired by the need for a more intuitive and flexible project management tool that can easily adapt to various workflows and team structures. By leveraging natural language processing and a simple YAML syntax, we aim to create a tool that is both powerful and easy to use.

One of the challenges with existing project management tools is that they require special software to run and are complex to configure.

Noodle planner aims to simply the capture of tasks, filling in information where provided and using defaults where it is not. 

Noodle planner will default task durations to 1 day by default, with a start day of the current day if not provided in the first task.

Task dependencies are implied if the task contains a "*" character (dependent on the previously listed task in the file).

Task dependencies can also be explicitly defined using the `#task_id` format.

Task completion can be provided using the `!` character followed by the completion status. e.g.

`!p100`

which indicates that the task is 100% complete.

---

## Resource Management

Task Resources can be specified using the `@resource_name` convention.

A resource profile will be created for each unique resource name, allowing for better tracking and management of resources across tasks.

---