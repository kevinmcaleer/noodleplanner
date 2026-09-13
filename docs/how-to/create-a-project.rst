How to Create a Project
========================

This guide explains how to set up a new project in NoodlePlanner, including the front matter, phases, and tasks.

Define the Front Matter
------------------------

Every plan begins with an optional front matter block enclosed in ``---`` lines. This sets project-level metadata:

.. figure:: /_static/img/how-to/cp-01-editor-frontmatter.png
   :alt: The editor's Properties panel listing title, project manager, sponsor, budget, status and resources, above the plan text
   :width: 60%

   The editor pane. NoodlePlanner lifts the front matter out of the plan text
   into the Properties panel above it, which is why the numbered lines below
   start partway down the file. ``YAML`` switches the panel back to the raw
   ``---`` block.

.. code-block:: text

   ---
   title: My Project
   project manager: Jane Smith
   sponsor: CEO
   budget: £50,000
   status: Green
   Resources:
   - @jane: Jane Smith, PM
   - @dev1: Dev One, Developer
   ---

Supported front matter fields:

- ``title`` — project name displayed in the header
- ``project manager`` / ``manager`` / ``owner`` — PM name
- ``sponsor`` — executive sponsor
- ``budget`` — budget figure (free text)
- ``status`` — RAG status (``Green``, ``Amber``, ``Red``)
- ``theme`` — UI theme (``light``, ``dark``, ``system``)
- ``Resources`` — list of team members with short names and descriptions

Add Phases
-----------

Phases are top-level (non-indented) lines. They act as summary tasks:

.. code-block:: text

   Phase One
   Phase Two
   Phase Three

Add Tasks
----------

Tasks are indented under their phase with at least two spaces:

.. code-block:: text

   Phase One
     Task A @jane 3d
     Task B @dev1 5d

Nest Subtasks
--------------

Add a second level of indentation for subtasks:

.. code-block:: text

   Phase One
     Main Task
       Subtask A @jane 2d
       Subtask B @dev1 1d

Set Dependencies
-----------------

Use ``[depends Task Name]`` to make a task wait for another to finish:

.. code-block:: text

   Phase One
     Design @jane 3d
     Development @dev1 5d [depends Design]

**Sequential shorthand with** ``*`` — prefix a task name with ``*`` to make it start the day after the previous task finishes. This is the simplest way to chain tasks:

.. code-block:: text

   Phase One
     Task A @jane 3d
     *Task B @dev1 5d
     *Task C @dev1 2d

Task B starts after Task A finishes, and Task C starts after Task B finishes. This is equivalent to writing ``[depends Task A]`` and ``[depends Task B]``, but much cleaner for simple chains.

You can depend on multiple tasks:

.. code-block:: text

     Integration @dev1 2d [depends Frontend, Backend]

Use explicit offsets to start before or after the dependency finishes:

.. code-block:: text

     Review @jane 1d [depends Design +1d]

**Dependency types** — by default, dependencies are Finish-Start (the successor starts after the predecessor finishes). You can specify other types:

- ``FS`` — Finish-Start (default): successor starts after predecessor finishes
- ``SS`` — Start-Start: successor starts when predecessor starts
- ``FF`` — Finish-Finish: successor finishes when predecessor finishes
- ``SF`` — Start-Finish: successor finishes when predecessor starts

.. code-block:: text

     Task B 5d [depends Task A:SS]
     Task C 3d [depends Task B:FF]

The type suffix is only needed for non-default types. ``[depends Task A]`` and ``[depends Task A:FS]`` are equivalent.

Set an Explicit Start Date
---------------------------

.. code-block:: text

     Task A @jane 3d 2026-06-01

Add Progress
-------------

.. code-block:: text

     Task A @jane 3d 75%

Or use the ``p`` prefix:

.. code-block:: text

     Task A @jane 3d p75

Add a Milestone
----------------

A milestone is a zero-duration task:

.. code-block:: text

     Phase Complete 0d [depends Final Task]

Add a Comment
--------------

.. code-block:: text

     Task A @jane 3d "Review with stakeholders before submitting"

Render the Plan
----------------

Press **Ctrl+Enter** (Windows/Linux) or **Cmd+Enter** (Mac) to render.

Import a File by Dropping It on the Window
-------------------------------------------

Any file dropped anywhere on the NoodlePlanner window is treated as an
import. A "Drop to import" panel appears while you drag, and the file is
routed by its type:

- ``.md``, ``.markdown`` or ``.txt`` — a new project is created from the
  plan text and opened in the editor
- ``.xlsx`` or ``.xls`` — the Excel import wizard opens
- ``.mpp`` or ``.xml`` — the Microsoft Project file is imported into a new
  project
- ``.json`` — a NoodlePlanner project export is added to your projects

Dropping several Markdown or JSON files at once imports each of them.
Excel and Microsoft Project files are imported one at a time. Anything else
is refused with a message saying what can be dropped.

Related
--------

- :doc:`../reference/plan-syntax` — full syntax reference
- :doc:`../reference/front-matter` — front matter field reference
- :doc:`manage-resources` — resource management guide
