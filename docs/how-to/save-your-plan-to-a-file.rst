Save Your Plan to a File
========================

NoodlePlanner keeps your plans in your browser as you work, so nothing is
lost if you close the tab. **Save** also puts the plan in a Markdown
(``.md``) file on your computer, to back it up, share it, or keep it in a
synced folder such as OneDrive.

What Save does depends on your browser:

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Browser
     - What Save does
   * - Chrome, Edge and other desktop browsers built on Chromium
     - Writes to a file on your computer. You choose the file the first
       time, and every later Save updates it.
   * - Firefox, Safari, and every browser on a phone or tablet
     - Downloads a copy of the plan each time.

Browsers that can write to a file show **Save As…** and **Download a copy**
under **File**. If you don't see them, Save downloads.

Save a plan to a file
---------------------

In Chrome or Edge:

1. Press **Ctrl+S** (**Cmd+S** on a Mac), click **Save** (the floppy disk)
   in the title bar, or choose **File › Save**.
2. The first time, your browser's save dialog opens, suggesting the plan's
   name. Choose a folder and a name, then click **Save**.
3. The status bar shows 🔗 and the file's name. From now on, Save writes to
   that file straight away, with no dialog.

If you cancel the dialog, nothing is saved and nothing changes.

Each Save adds one to the plan's ``version`` in its front matter (1.1,
1.2, …) and records the time in ``last_saved``.

A plan you open with **File › Open…** (**Ctrl+O**) is linked to its file
in the same way, so Save writes back to the file you opened.

Save to a different file
------------------------

Choose **File › Save As…**. The save dialog opens, starting with the
current file's name. The plan is saved to the file you choose, and every
later Save writes there. The old file is left as it was.

Download a copy
---------------

Choose **File › Download a copy**. The plan downloads as
``<plan name>_plan_v<version>.md``, and the file on disk isn't touched.

When the browser asks for permission again
------------------------------------------

Your browser remembers the file after you close the tab or reload the
page, but it may want your permission again before it writes to the file.
The status bar then shows **🔗 Needs access:** and the file's name.

The next Save asks for that permission:

- **Allow it**, and Save writes to the file as before.
- **Refuse it**, and Save downloads a copy instead. A message says the file
  on disk was not updated. The file stays linked, so the next Save asks
  again.

If the file has been moved, renamed or deleted, Save downloads a copy and
forgets the file. The next Save asks where to save.

The link belongs to this browser on this computer. Open the same plan in
another browser, or on another computer, and its first Save asks for a
file again.

In Firefox, Safari and on phones
--------------------------------

Save downloads the plan as ``<plan name>_plan_v<version>.md`` each time,
wherever your browser puts downloads. To update a file you keep
elsewhere, replace it with the download.

**File › Open…** still opens a ``.md`` file, but the browser can't write
back to it, so Save goes on downloading copies.

See also
--------

- :doc:`back-up-your-projects`, to keep a copy of every project at once.
- :doc:`sync-your-plan-with-files`, to link a plan to an Excel workbook or
  an MS Project file.
