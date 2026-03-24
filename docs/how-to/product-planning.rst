How to Use Product-Based Planning
==================================

Product-based planning lets you organise your project around the things it delivers rather than just the work required. Each deliverable is marked with a ``$name`` token, giving you dedicated views for tracking products, their dependencies, and their status.

What Is a Deliverable?
-----------------------

A deliverable (also called a product) is a tangible output of your project — a document, a component, a release, or any other concrete result. In NoodlePlanner, you mark a task as a deliverable by adding a ``$name`` token to the task line.

Mark Tasks as Deliverables
---------------------------

Add a ``$name`` token to any task to turn it into a deliverable:

.. code-block:: text

   Aircraft Assembly
     Fuselage $fuselage @structures 8w
     Wings $wings @structures 6w
     Avionics $avionics @electronics 4w
     Landing Gear $landing-gear @mechanical 3w

The ``$`` prefix followed by a short identifier is all that is needed. The identifier is used when referencing the deliverable in dependencies and in the product views.

Create Product Dependencies
-----------------------------

Use ``[depends $product]`` to declare that one deliverable depends on another:

.. code-block:: text

   Aircraft Assembly
     Fuselage $fuselage @structures 8w
     Wings $wings @structures 6w [depends $fuselage]
     Avionics $avionics @electronics 4w [depends $fuselage]
     Final Assembly $final-assembly @integration 2w [depends $wings, $avionics, $landing-gear]
     Landing Gear $landing-gear @mechanical 3w

Product dependencies work just like task-name dependencies: the dependent task cannot start until all referenced deliverables are complete. You can mix product dependencies with regular task-name dependencies in the same ``[depends ...]`` block.

Product Views
--------------

Once you have deliverables defined, three dedicated views become available.

Product Breakdown Structure (PBS)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The PBS view displays a hierarchical tree of all deliverables in the project. It shows how products relate to each other and which phase they belong to. Use it to verify that every required deliverable has been identified.

Deliverables Matrix
~~~~~~~~~~~~~~~~~~~~

The Deliverables Matrix shows each deliverable alongside its assigned resource, status, and key dates in a tabular format. It is a quick way to see which products are on track and which need attention.

Product Flow
~~~~~~~~~~~~~

The Product Flow view renders the dependency graph between deliverables as a directed diagram. Arrows show the order in which products must be completed. This view is useful for identifying the critical path through your deliverables and spotting bottlenecks.

Product Details Form
---------------------

Click on any deliverable in a product view to open the **Product Details** form. The form shows:

- The deliverable name and identifier
- Assigned resources
- Start and finish dates
- Current progress
- Upstream and downstream product dependencies
- Associated comments and notes

Use the form to review or update a deliverable without switching back to the plan text.

Example Plan
-------------

Below is a complete example showing deliverables with a product hierarchy and dependencies:

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
     Fuel System $fuel-system @propulsion 8w [depends $engine]
     Propulsion Testing $prop-test @propulsion 4w [depends $fuel-system]

   Payload Module
     Instrument Package $instruments @payload 10w
     Communications Array $comms @payload 6w
     Payload Integration $payload-int @payload 3w [depends $instruments, $comms]

   Ground Systems
     Launch Pad Preparation $launch-pad @ground-systems 16w
     Mission Control Software $mission-sw @ground-systems 12w

   Final Integration
     Vehicle Assembly $vehicle @integration 4w [depends $prop-test, $payload-int]
     Launch Rehearsal $rehearsal @integration 2w [depends $vehicle, $launch-pad, $mission-sw]
     Launch 0d [depends $rehearsal]

Related
--------

- :doc:`../reference/plan-syntax` — full syntax reference including the ``$name`` token
- :doc:`use-the-gantt-view` — Gantt view guide
- :doc:`../reference/views` — overview of all views
