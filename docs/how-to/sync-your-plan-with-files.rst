Sync Your Plan with Files
=========================

Not everyone who works on a project uses NoodlePlanner. A network engineer
without an MS Project licence can mark tasks done in a spreadsheet, and a
colleague can keep the schedule in Microsoft Project. **Sync** brings their
changes back into your plan and writes your plan back out to their files,
with a review of every change before anything is applied.

A plan can be linked to three kinds of file, each a **sync target**:

.. list-table::
   :header-rows: 1
   :widths: 22 28 50

   * - Target
     - The file
     - What syncs back into the plan
   * - **Project workbook**
     - The whole-plan workbook from **Report › Share › Excel**
     - On the **Tasks** sheet: **% Complete**, **Comment**, and new rows,
       which become new tasks. Every other column and sheet, including the
       workbook's own RAID Log sheet, is export-only.
   * - **RAID Log**
     - The RAID-only workbook from the RAID view
     - Every RAID item. See :doc:`use-the-raid-log`.
   * - **MS Project Schedule**
     - An ``.mpp`` or MSPDI ``.xml`` file
     - The task tree. See :doc:`import-from-ms-project`.

The two workbooks are different files. RAID edits made in the project
workbook's RAID Log sheet are **not** synced. Link the RAID workbook for
those.

Press Sync
----------

**Sync** is on the **Report** tab of the ribbon, in the **Data** group.

- **Nothing linked yet.** A dialog explains what Sync does and lists the
  three targets. Choose **Link existing file…** for a file you already have.
  For the project workbook you can also choose **Create…**, which saves a
  new workbook of the current plan and links it in one step.
- **Everything linked.** Sync runs straight away, one target after
  another. The button shows it is busy until the run finishes. Each target
  with changes opens its own review. When the run ends, a message lists what
  happened to each target: changes applied, already up to date, review
  cancelled, skipped or failed.
- **A link needs permission again.** Browsers forget file permissions
  between sessions. The dialog lists the targets that need permission again,
  each with a **Re-link** button, and a button that syncs the targets that
  are ready. A target that still needs permission is never skipped without
  telling you.
- **A browser that can't link files.** Firefox and Safari can't remember a
  file between syncs, so there is no one-click sync there. The dialog says
  so, and each target gets a **Choose file…** button. The updated file is
  downloaded rather than written over the original.

**Settings › Sync** lists the same targets, with each one's link, when it
last synced, **Sync Now**, and **Unlink**.

Review workbook changes
-----------------------

Each change in the **Sync project workbook** dialog is one of:

- **Updated**: changed in the workbook since it was written, and not in the
  plan. Ticked to apply by default.
- **Conflict**: changed in both. **Keep mine** is the default. Choose
  **Keep workbook** to take the workbook's value.
- **Added**: a new row in the Tasks sheet. It is added to the plan after the
  row above it, under the same parent. Ticked by default.
- **Removed**: a row deleted from the Tasks sheet. Unticked by default,
  because a deleted spreadsheet row is as often a slip as a decision.
  Removing a summary task also removes its sub-tasks.

A change you made in the plan since the workbook was written is kept as it
is. It is not listed, and syncing does not undo it.

Click **Apply selected**. The plan updates, and the whole plan is then
written back to the workbook, so it shows your changes as well as theirs.

A few things are export-only on purpose. A summary task's **% Complete** is
rolled up from its sub-tasks. A task tracked by effort (``~2h/4h``) takes
its percent from the effort. Dates, durations, resources and RAG are
calculated from the plan, so editing them in the workbook changes nothing.

How rows are matched
--------------------

Every workbook NoodlePlanner writes carries a hidden sheet that records each
row's ID and task, and the values the file was written with. It is how a
sync tells an edit made in the workbook from one made in the plan. Because
the record is inside the file, this works for a workbook exported months ago
or on someone else's computer. Keep the **ID** column as it is: the ID is how
a row whose name was re-indented or edited is still matched to its task.

If the hidden sheet has been lost (some tools drop hidden sheets when they
save), the last sync in this browser is used instead. If there is no last
sync either, every difference is shown as a conflict, and the plan's value
is the default.

What the plan records
---------------------

Each target writes the linked file's name and the time of the last sync to
the plan's front matter:

- ``workbook_file`` / ``workbook_file_synced`` for the project workbook
- ``excel_file`` / ``excel_file_synced`` for the RAID workbook
- ``msproject_file`` / ``msproject_file_synced`` for MS Project

The one-click link itself is kept in your browser. A browser can't store a
file's location in the plan, so opening the plan in another browser needs
one **Re-link**.
