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
   Read **in your browser** by the `mppwriter <https://www.npmjs.com/package/mppwriter>`_
   library; the file is never uploaded. Any MPP14 file (Project 2010 through
   Microsoft 365) is supported. Tasks, outline, durations, milestones,
   resources, assignments, dependencies with their type and lag, percent
   complete and task notes are imported.

``.xml`` (Microsoft Project XML)
   Sent to the server for conversion. If a ``.mpp`` file is older than Project
   2010, export it from Microsoft Project as XML first: **File** > **Save As**
   > select **XML Format (*.xml)**.

What Gets Imported
-------------------

- **Tasks** — task names, durations, start and finish dates, milestones (``0d``)
- **Resources** — resource names and assignments (``@shortname``, declared in the front matter)
- **Dependencies** — task dependencies with their type and lag, for example ``[depends: Build:SS -1w]``; a single link to the previous task becomes ``*``
- **Progress** — percentage complete on each task
- **Hierarchy** — summary tasks and subtasks are preserved as indented phases
- **Notes** — task notes become a quoted comment (``.mpp`` only)

Calendars, non-working days, constraints, baselines and costs are not imported.

Export to MS Project
---------------------

You can also export your NoodlePlanner plan as a native Microsoft Project
file:

1. Click **Tools** in the project sub-navigation
2. Select **Export to MS Project**
3. A ``.mpp`` file is downloaded that opens in Microsoft Project by
   double-click

The file is built in the browser and needs a one-time template saved from
Microsoft Project; see :doc:`export-your-plan` for the recipe and for what
does not round-trip yet.

.. note::

   Microsoft Project is stricter about dependencies than NoodlePlanner: it
   refuses to open a file in which a task is linked to its own phase, or in
   which a dependency on a phase heading loops back through that phase's
   subtasks. Such links are left out of the export and the reason is written
   to the task's **Notes** field, so the file always opens.

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
