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

1. Open the **Tools** menu and choose **Export RAID to Excel**
2. An ``.xlsx`` file will download with all RAID items formatted as a table

Sync with Excel
----------------

Rather than a one-way, one-shot import that discards what's in the plan,
RAID Excel is a **registered sync target**: NoodlePlanner reads the workbook,
compares it against the plan *and* against what was seen at the last sync,
and shows a reviewable list of changes before anything is applied — nothing
is silently overwritten.

1. Open the **Tools** menu and choose **Sync RAID with Excel**
2. Select the ``.xlsx`` file to sync against
3. Review the **Sync RAID with Excel** dialog. Each change is one of:

   - **Added** — present in the workbook, not yet in the plan. Checked to
     add by default.
   - **Updated** — changed in the workbook since the last sync, unchanged in
     the plan. Checked to apply by default.
   - **Removed** — present at the last sync, now missing from the workbook.
     Unchecked by default — removal always needs an explicit tick.
   - **Conflict** — changed on *both* sides since the last sync. Choose
     **Keep mine** (default) or **Keep Excel** per row; nothing is decided
     for you.

   A row you added locally that the workbook doesn't know about yet, or a
   row you deliberately removed from the plan, is left alone and doesn't
   appear in the list.
4. Click **Apply Selected**. The plan's ``---raid log---`` table updates
   with your choices, the linked filename and sync time are recorded in the
   plan's front matter (``excel_file`` / ``excel_file_synced``), and an
   updated ``.xlsx`` downloads automatically — save it over your original
   file so both sides stay in step for the next sync.

The last-synced snapshot that powers this comparison is kept in the
browser's local storage, scoped to the project. Syncing the same project on
a different device or browser starts fresh, so the first sync there treats
every differing row as a conflict rather than assuming either side is
correct.

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
