How to Use the RAID Log
========================

The RAID log tracks project **Risks**, **Actions**, **Issues**, **Decisions**, and **Dependencies**. It is embedded in your plan file and managed from the **Tracking** section.

Open the RAID Log
------------------

Click **Tracking** in the project sub-navigation, then select **RAID Log** from the dropdown.

Add an Item
-----------

1. Click **Add Item** (or the **+** button)
2. Fill in the form:

   - **Type** — Risk, Action, Issue, Decision, or Dependency
   - **Title** — a brief title
   - **Description** — detailed description
   - **Raised By** — person who identified the item
   - **Owner** — person responsible for resolving it
   - **Mitigation Actions** — steps being taken
   - **Impact** — severity if it occurs (1 = Low, 5 = Critical)
   - **Likelihood** — probability of occurring (1 = Unlikely, 5 = Near certain)
   - **Status** — Open, Closed, or Transferred

3. Click **Save**

The **Score** (Impact × Likelihood) is calculated automatically and shown in the table.

Edit an Item
-------------

Click any row in the RAID table to open the item form and make changes.

Filter and Sort
----------------

- Use the **Type** filter dropdown to show only one type of item (e.g. Risks only)
- Use the **Status** filter to show only open or closed items
- Click any column header to sort by that column

Export to Excel
----------------

1. Click the **Export** button in the RAID log toolbar
2. An ``.xlsx`` file will download with all RAID items formatted as a table

Import from Excel
------------------

1. Click the **Import** button in the RAID log toolbar
2. Select an Excel file in the expected RAID log format
3. The imported items will replace (or merge with) the current RAID log

Save to Markdown
-----------------

The RAID log is stored as a markdown table embedded in your plan. To save it:

1. Click **Download** (the markdown/save icon) in the RAID log toolbar
2. This saves a ``raid.md`` file you can store alongside your project files

The RAID log section begins after a ``---raid log---`` separator in the plan file.

View on the Dashboard
----------------------

Open items (risks and issues) appear automatically in the **Risks & Issues** panel on the Project Dashboard, sorted by score (highest first).

Related
--------

- :doc:`../reference/views` — RAID log column reference
- :doc:`../explanation/rag-status` — how risk scores relate to RAG status
