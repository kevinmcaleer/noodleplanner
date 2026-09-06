How to Use the Communications Plan
====================================

The Communications Plan view lets you plan and track stakeholder
communications alongside your project schedule. Entries are stored directly
in the plan file and can be exported as a Word document or included as a
worksheet in the Excel export.

Where Communications Data Is Stored
-------------------------------------

Communications plan entries are embedded in the plan text after a
``---comms---`` separator, formatted as a markdown table:

.. code-block:: text

   ---comms---

   # Communications Plan

   | ID | Activity | Audience | Content | Frequency | Channel | Owner | Status |
   |----|----------|----------|---------|-----------|---------|-------|--------|
   | 1  | Weekly Status Update | Steering Board | Progress summary | Weekly | Email | PM | Active |
   | 2  | Sprint Demo | Dev Team | Feature walkthrough | Fortnightly | Teams | Tech Lead | Active |

This section is managed by the Comms Plan view. You do not normally need to
edit it by hand.

Open the Communications Plan View
-----------------------------------

Select **Comms Plan** from the navigation menu. If the plan already contains a
``---comms---`` section, the existing entries are loaded automatically.

Add a Communications Item
---------------------------

1. Click the **+ Add Item** button above the table.
2. The detail pane opens with a form containing the following fields:

   - **Activity** -- the name of the communication (e.g. "Weekly Status Update").
   - **Audience** -- who receives the communication.
   - **Content** -- a brief description of what is communicated.
   - **Frequency** -- how often it occurs (e.g. Weekly, Monthly, Ad hoc).
   - **Channel** -- the medium used (e.g. Email, Teams, In-person).
   - **Owner** -- the person responsible for sending it.
   - **Status** -- current status (e.g. Active, Paused, Complete).

3. Save the item. It appears in the table immediately.

Edit or Delete an Item
-----------------------

Click any row in the communications table to open the item in the detail pane
form. Update the fields and save, or use the **Delete** button to remove the
item.

Filter and Sort
----------------

- Use the **Status** filter dropdown above the table to show only items with a
  specific status.
- Click any column header to sort the table by that column.

Export as Word Document
------------------------

Click the **Export as Word** button in the toolbar. NoodlePlanner generates a
landscape-format Word document (``.docx``) containing the full communications
plan table and downloads it to your browser.

The exported file is named ``<Project Name> - Communications Plan.docx``.

The document is built in your browser, so the plan is not sent to the server
to produce it.

Excel Export
-------------

When you export the project to Excel, the communications plan is automatically
included as a separate **Comms Plan** worksheet. The worksheet contains the
same columns as the on-screen table: ID, Activity, Audience, Content,
Frequency, Channel, Owner, and Status.

Table Columns Reference
-------------------------

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - Column
     - Description
   * - ID
     - Auto-assigned numeric identifier.
   * - Activity
     - The name or title of the communication event.
   * - Audience
     - The intended recipients or stakeholder group.
   * - Content
     - A summary of what the communication covers.
   * - Frequency
     - How often the communication occurs.
   * - Channel
     - The delivery method (email, meeting, report, etc.).
   * - Owner
     - The person responsible for producing and sending it.
   * - Status
     - Current status of the communication item.

Related
--------

- :doc:`product-planning` -- Product-based planning guide
- :doc:`use-the-raid-log` -- RAID Log guide
- :doc:`../reference/plan-syntax` -- full syntax reference
