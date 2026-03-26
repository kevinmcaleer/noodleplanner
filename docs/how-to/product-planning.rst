How to Use Product-Based Planning
==================================

Product-based planning lets you organise your project around the things it
delivers rather than just the work required. Each deliverable is marked with a
``$identifier`` token, unlocking dedicated views for visualising product
hierarchies, tracking dependencies, and monitoring status.

What Is a Deliverable?
-----------------------

A deliverable (also called a *product*) is a tangible output of your project
-- a document, a component, a release, or any other concrete result. In
NoodlePlanner you mark a task as a deliverable by adding a ``$identifier``
token to the task line. Spaces in the identifier are automatically replaced
with underscores.

Mark Tasks as Deliverables
---------------------------

Add a ``$identifier`` token to any task to turn it into a deliverable:

.. code-block:: text

   Aircraft Assembly
     Fuselage $fuselage @structures 8w
     Wings $wings @structures 6w
     Avionics $avionics @electronics 4w
     Landing Gear $landing_gear @mechanical 3w

The ``$`` prefix followed by a short identifier is all that is needed. The
identifier is used when referencing the deliverable in dependencies and across
product views.

You can also promote a task from the **Task Details** form by clicking the
**Make Deliverable** button. NoodlePlanner generates a unique ``$identifier``
automatically. Once a task is a deliverable, the button changes to **Product**
and opens the Product Details form when clicked.

Create Product Dependencies
-----------------------------

Use ``[depends $product]`` to declare that one deliverable depends on another:

.. code-block:: text

   Aircraft Assembly
     Fuselage $fuselage @structures 8w
     Wings $wings @structures 6w [depends $fuselage]
     Avionics $avionics @electronics 4w [depends $fuselage]
     Final Assembly $final_assembly @integration 2w [depends $wings, $avionics, $landing_gear]
     Landing Gear $landing_gear @mechanical 3w

Product dependencies work just like task-name dependencies: the dependent task
cannot start until all referenced deliverables are complete. You can mix
product dependencies with regular task-name dependencies in the same
``[depends ...]`` block.

Duplicate Detection
--------------------

NoodlePlanner detects duplicate ``$identifier`` tokens across the plan and
duplicate task names at the same indentation level. When duplicates are found:

- A warning appears in the editor status bar, listing the affected line
  numbers.
- The affected lines are highlighted with a yellow background in the editor.

Resolve duplicates by giving each deliverable a unique ``$identifier``.

Product Views
--------------

Once deliverables are defined, three dedicated views become available.

Product Breakdown Structure (PBS)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The PBS view displays a top-down hierarchical tree of all deliverables in the
project.

**Layout:**

- The first level of products is arranged horizontally beneath the project
  root.
- Deeper levels stack vertically with orthogonal bus-style connector lines.
- When a node has more than six descendants the children are split into dual
  columns. Left-column children mirror to the left of the parent.
- All nodes have a fixed width of 140 px with two-line word-wrapped titles.

**Node shapes:**

- **Parallelogram** -- parent nodes that contain child products.
- **Rounded rectangle** -- leaf nodes with no children.

**Interaction:**

- Hover over any node to reveal **+** buttons for adding a child, a sibling
  before, or a sibling after the node.
- Click a node to open the **Product Details** form. Click the root node to
  open **Project Details**.

**Toolbar:**

- **Copy as image** -- copies the diagram to the clipboard as a high-resolution
  PNG.
- **Zoom controls** -- zoom in, zoom out, fit to view, and reset zoom.

Product Flow
~~~~~~~~~~~~~

The Product Flow view renders a left-to-right dependency flow diagram showing
how deliverables feed into one another.

**Node types:**

- **Rectangular nodes** -- leaf products, displayed with their name and
  ``$identifier``.
- **Diamond gate nodes** -- summary products, labelled with the stage name and
  "X complete" to indicate how many child products must finish.

**Dependency creation:**

- Drag from the **right-side connector** (``+``) of any node and drop onto the
  body of another node to create a dependency. Connection connectors are hidden
  until you hover over a node.
- Click an arrow to select it (the arrow turns red). Press the **Delete** key
  to remove the dependency.

**Orphan detection:**

Products that have no incoming or outgoing dependencies (dead ends) are
highlighted with a pulsing orange dashed border so you can spot gaps in the
flow.

**Expand / Collapse:**

- Stage-level nodes that have ``[depends]`` entries are shown collapsed by
  default on the first render.
- Use the **Expand All** and **Collapse All** buttons to toggle between
  phase-level and fully detailed views.

**Toolbar:**

- **Copy as image** and **Zoom controls** as described above.

Deliverables Matrix
~~~~~~~~~~~~~~~~~~~~

The Deliverables Matrix presents all deliverables in a tabular format with the
following columns:

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - Column
     - Description
   * - ID
     - The ``$identifier`` of the deliverable.
   * - Deliverable
     - The task name.
   * - Activities
     - All activities collected from the full descendant tree (not just direct
       children).
   * - Resources
     - Assigned resources.
   * - Dependencies
     - Product and task dependencies.
   * - Dates
     - Start and finish dates.
   * - Status
     - RAG status derived from child task completion percentages (rolled up).
   * - Progress
     - Overall completion percentage.

Click any row to open the **Product Details** form for that deliverable.

Product Details Form
---------------------

Click on any deliverable in a product view to open the Product Details form in
the detail pane. The form contains:

**Editable fields:**

- **Title** -- a contenteditable heading that stays in sync with the Product
  Title input field.
- **Identifier** -- the ``$identifier`` value. Spaces typed here are
  automatically replaced with underscores.
- **Purpose** -- free-text comments describing the deliverable's purpose.
- **Resources / Skills** -- assigned resources.
- **Dependencies** -- upstream product dependencies.

**Read-only information:**

- **Composition** -- child tasks with their individual completion percentages.
- **Child Products** -- clickable links to navigate to child deliverables.
- **Dates** -- start and finish dates (calculated by the scheduling engine).
- **Progress** -- rolled-up completion percentage.

**Mini flow diagram:**

A small dependency diagram at the bottom of the form shows
**inputs -> current product -> outputs**. Each node in the mini flow is
clickable, allowing quick navigation between related products.

**Actions:**

- **Task Details** -- switches to the standard task form for the same task.
- **Remove Deliverable Status** -- strips the ``$identifier`` token from the
  task, converting it back to a regular task.

Changes to the form are saved automatically with a 1.5-second debounce delay.

Task Form Integration
----------------------

The standard task form includes deliverable-related actions:

- **Make Deliverable** -- appears on tasks that are not yet deliverables.
  Clicking it generates a unique ``$identifier`` and marks the task as a
  deliverable.
- **Product** -- appears on tasks that are already deliverables. Clicking it
  opens the Product Details form.

Example Plan
-------------

Below is a complete example showing deliverables with a product hierarchy and
dependencies:

.. code-block:: text

   ---
   Title: Satellite Launch Programme
   Resources:
     - propulsion
     - payload
     - ground-systems
     - integration
   ---

   Propulsion Module
     Engine Design $engine @propulsion 12w
     Fuel System $fuel_system @propulsion 8w [depends $engine]
     Propulsion Testing $prop_test @propulsion 4w [depends $fuel_system]

   Payload Module
     Instrument Package $instruments @payload 10w
     Communications Array $comms_array @payload 6w
     Payload Integration $payload_int @payload 3w [depends $instruments, $comms_array]

   Ground Systems
     Launch Pad Preparation $launch_pad @ground-systems 16w
     Mission Control Software $mission_sw @ground-systems 12w

   Final Integration
     Vehicle Assembly $vehicle @integration 4w [depends $prop_test, $payload_int]
     Launch Rehearsal $rehearsal @integration 2w [depends $vehicle, $launch_pad, $mission_sw]
     Launch 0d [depends $rehearsal]

Related
--------

- :doc:`communications-plan` -- Communications Plan guide
- :doc:`../reference/plan-syntax` -- full syntax reference including the ``$identifier`` token
- :doc:`use-the-gantt-view` -- Gantt view guide
- :doc:`../reference/views` -- overview of all views
