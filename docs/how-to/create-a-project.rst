How to Create a Project
========================

This guide explains how to set up a new project in NoodlePlanner, including the front matter, phases, and tasks.

Define the Front Matter
------------------------

Every plan begins with an optional front matter block enclosed in ``---`` lines. This sets project-level metadata:

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

You can depend on multiple tasks:

.. code-block:: text

     Integration @dev1 2d [depends Frontend, Backend]

Use explicit offsets to start before or after the dependency finishes:

.. code-block:: text

     Review @jane 1d [depends Design +1d]

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

Related
--------

- :doc:`../reference/plan-syntax` — full syntax reference
- :doc:`../reference/front-matter` — front matter field reference
- :doc:`manage-resources` — resource management guide
