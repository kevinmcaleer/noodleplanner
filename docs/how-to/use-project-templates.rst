How to Use Project Templates
==============================

Project templates provide pre-built plan structures for common project types, saving you time when starting a new project.

Start a New Plan from Backstage
---------------------------------

Click **File** to open Backstage. The **Start a new plan** strip across the top
holds **Blank plan** and the four most popular templates; **More templates**
(or **Templates** in the left rail) opens all of them.

Each template card is a picture of the *shape* of its plan, not a generic icon:

- every row is one top-level summary task (a phase), with its name above a bar;
- the bar's length is how many work tasks that phase holds, relative to the
  busiest phase, so you can see at a glance whether the effort is front- or
  back-loaded;
- a small circle to the right of the bar is a milestone (a zero-duration task)
  in that phase;
- the line under the rows counts the phases and milestones.

Picking a card asks for a name and creates a **new** plan from the template.
It does not touch the plan you have open.

The bundled templates are Event Planning, Marketing Campaign, Mobile App
Launch, Software Delivery (a gated, waterfall project), Software Deployment (a
release and cutover plan: change approval, staging rehearsal, rollback cover
and hypercare), Software Development Project and Website Redesign. A template
marked ``popular: true`` in its ``template.yml`` is eligible for the strip.

Open the Templates Browser
----------------------------

1. Click **Tools** in the main navigation bar
2. Select **Project Templates**

The templates browser opens, showing available templates organised by category.

Browse Categories
------------------

Templates are grouped into categories such as:

- **Software Development** — sprints, releases, product launches
- **Construction** — phases, permits, inspections
- **Marketing** — campaigns, events, product launches
- **General** — simple plans, phased delivery, agile ceremonies

Click a category to filter the templates shown.

Create a Project from a Template
----------------------------------

1. Browse or search for the template you want
2. Click the template card to preview its structure
3. Click **Use Template**
4. A new project is created with the template's task structure pre-filled in the editor
5. Modify the plan to suit your project — update task names, dates, resources, and durations

.. note::

   Templates provide a starting structure only. All dates are relative and will be recalculated when you render the plan. Customise the template to match your project needs.

Related
--------

- :doc:`create-a-project` — creating a project from scratch
- :doc:`../reference/plan-syntax` — plan syntax reference
- :doc:`../reference/front-matter` — front matter reference
