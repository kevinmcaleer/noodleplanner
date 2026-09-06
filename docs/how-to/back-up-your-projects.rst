How to Back Up and Restore Your Projects
=========================================

NoodlePlanner stores your projects in your browser only. There is no
account and no server copy, so a backup is the only way to survive a
cleared browser profile, a lost laptop, or a move to a new machine. This
guide covers backing up everything at once, restoring a backup, and
tidying up after the move from the old storage.

For a single plan, the Markdown file is the backup: press **Ctrl+S**
(**Cmd+S** on a Mac) or use **Tools → Export → Markdown**. The rest of this
page is about all of your projects together.

Download a backup of everything
-------------------------------

1. Open **Settings** (the gear icon) and choose the **Storage** tab.
2. Click **Download backup**.

Or, from the portfolio page, open the three-dot menu next to **+ New
Project** and choose **Back Up All Projects**.

Either way you get one file, ``noodleplanner-backup-YYYY-MM-DD.json``,
containing:

* every project's plan text, exactly as stored;
* every project's version history;
* the programme dependencies between projects.

The Storage tab shows what is about to be backed up: how many projects and
snapshots the store holds and how much text that is. UI preferences (theme,
panel widths, AI settings) are not included; they are not plan data.

Restore a backup
----------------

1. Open **Settings → Storage** and click **Restore backup…**, or choose
   **Restore Backup** from the portfolio's three-dot menu.
2. Pick the backup file.

You can also drop the file anywhere on the NoodlePlanner window.

Restoring **adds** what the backup has and this browser does not: projects
that are already here (matched by id) are kept as they are, and their
history is not touched. Restoring the same file twice therefore does
nothing the second time. Programme dependencies are merged by id.

To move to a new machine: download a backup on the old one, open
NoodlePlanner on the new one, restore the file. The current project and
theme are per-browser settings, so pick the project you want from the
selector afterwards.

After the move from ``localStorage``
------------------------------------

Versions before issue #794 kept every project in one ``localStorage``
entry. The first time the new version starts it copies everything from
there into the new store and leaves the old entry exactly as it was. From
then on the old copy is not updated, so it falls further behind with every
save.

When you are satisfied that everything is where it should be, open
**Settings → Storage**. If the old copy is still present, the tab says so,
with the number of projects and snapshots in it and the date they were
copied, and offers **Remove old copy**. That button is the only thing that
ever deletes the old data; nothing happens automatically. If you never
press it, the old copy simply stays, taking up part of the 5 MB
``localStorage`` allowance and nothing else.

If something looks wrong after the move, do not press it: download a
backup first (the Storage tab), then open an issue. The old copy is still
readable by the previous version of the app.

If browser storage is full
--------------------------

The new store's limit is a share of your free disk, so this should be
rare. If a save cannot be written, the status bar shows a persistent
message and a toast says what to do. Your edit is still in the editor and
in memory; download the plan (**Ctrl+S**) straight away, then free space by
deleting projects or version history you no longer need. The next
successful save clears the message.

Browsers without IndexedDB (rare, and some private-browsing modes) use the
old ``localStorage`` store with its 5 MB limit. The Storage tab says which
store is in use.
