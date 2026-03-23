How to Import from Microsoft Project
======================================

NoodlePlanner can import project plans from Microsoft Project files, either native ``.mpp`` format or exported ``.xml`` format.

Import a Plan
--------------

1. Click **Tools** in the project sub-navigation
2. Select **Import from MS Project**
3. Choose your ``.mpp`` or ``.xml`` file
4. NoodlePlanner converts the project data into plan text in the editor

The importer reads tasks, durations, dates, resources, dependencies, and progress from the Microsoft Project file and generates NoodlePlanner markdown.

Supported Formats
------------------

``.mpp`` (native Microsoft Project)
   Direct import from Microsoft Project ``.mpp`` files. Supports tasks, resources, dependencies, and assignments.

``.xml`` (Microsoft Project XML)
   If you have trouble with ``.mpp`` import, export your project from Microsoft Project as XML first: **File** > **Save As** > select **XML Format (*.xml)**.

What Gets Imported
-------------------

- **Tasks** — task names, durations, start and finish dates
- **Resources** — resource names and assignments
- **Dependencies** — task dependencies (finish-start links)
- **Progress** — percentage complete on each task
- **Hierarchy** — summary tasks and subtasks are preserved as indented phases

Export to MS Project
---------------------

You can also export your NoodlePlanner plan to Microsoft Project XML format:

1. Click **Tools** in the project sub-navigation
2. Select **Export to MS Project**
3. A ``.xml`` file is downloaded that can be opened in Microsoft Project

Tips
-----

- Review the generated markdown after import and adjust formatting as needed
- Resource names from Microsoft Project are mapped to NoodlePlanner ``@resource`` syntax
- Very large plans (hundreds of tasks) may take a moment to process

Related
--------

- :doc:`import-from-excel` — importing from Excel spreadsheets
- :doc:`export-your-plan` — exporting to other formats
- :doc:`../reference/plan-syntax` — full syntax reference
