How to Import a Plan from Excel
=================================

NoodlePlanner can import project plans from Excel files, making it easy to migrate from spreadsheet-based planning.

Import a Plan
--------------

1. Click **Tools** in the project sub-navigation
2. Select **Import → Excel**
3. The **Import Wizard** dialog opens
4. Click **Browse** or drag your ``.xlsx`` file onto the upload area
5. The wizard shows a preview of the detected columns and rows
6. Map the spreadsheet columns to NoodlePlanner fields:
   - Task Name
   - Start Date
   - Finish Date (or Duration)
   - Resources
   - Progress
7. Click **Import**

NoodlePlanner converts the spreadsheet data into plan text in the editor. Review the editor output before rendering.

Import a RAID Log from Excel
-----------------------------

From the **Tracking** → **RAID Log** view:

1. Click the **Import** icon in the RAID log toolbar
2. Select an Excel file formatted as a RAID log table
3. The items are loaded into the RAID log

Expected RAID Excel columns: ID, Type, Title, Description, Raised By, Owner, Mitigation Actions, Impact, Likelihood, Score, Status.

Tips for a Smooth Import
--------------------------

- Ensure your Excel file has a header row with column names
- Dates should be in a consistent format (ISO 8601 preferred: ``YYYY-MM-DD``)
- Resource names should match the short names defined in the front matter if possible
- The wizard supports common column name variations (e.g. ``Task``, ``Task Name``, ``Activity``)

Related
--------

- :doc:`export-your-plan` — exporting plans to Excel
- :doc:`use-the-raid-log` — managing the RAID log
