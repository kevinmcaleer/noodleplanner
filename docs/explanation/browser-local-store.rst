Where Your Projects Are Stored
==============================

NoodlePlanner keeps every project in your browser. Nothing is sent to a
server to be stored, by design. This page explains what the browser-local
store is, why it uses IndexedDB rather than ``localStorage`` or an embedded
SQLite database, how the move from the old store happened, and how to back
the store up and move it to another machine.

The problem with ``localStorage``
---------------------------------

Until issue #794 every project lived inside a single ``localStorage`` key as
one JSON blob. That had three consequences:

* **Saving one project rewrote every project.** Each save parsed the whole
  blob, replaced one entry and serialised the whole blob again, synchronously,
  on the thread that also handles your typing.
* **The quota is about 5 MB per site.** Version history keeps up to fifty
  full snapshots of each plan. A measured 550-task plan is 21.5 KB, so one
  fully versioned project is roughly 1 MB, and at about five projects the
  quota is gone.
* **Failures were silent.** The write error was caught, logged to the console
  and returned as ``false`` to callers that did not look at it. Every save
  from that point on was lost without a word.

The last of these was fixed first, on its own: a save that cannot be written
now shows a persistent message in the status bar and an error toast, older
history is evicted before plan text is ever lost, and history is capped by
bytes as well as by count. That fix stands whatever store is underneath.

The spike: which store?
-----------------------

Three candidates were measured against what the app actually does with its
data, not against what a database could do in principle.

The real access patterns
~~~~~~~~~~~~~~~~~~~~~~~~

Reading the callers of ``static/project-storage.js`` and
``static/multi-plan-loader.js`` gives exactly four operations:

1. **Load one project** by id when it is opened in the editor.
2. **Save one project** on autosave (every 30 s), on explicit save, and when
   a portfolio action (levelling, dependency sync) rewrites plan text.
3. **List projects** for the project selector, the portfolio table and the
   status bar: id, name and ``updatedAt``.
4. **Cross-project work for the portfolio views.** Every one of the eleven
   portfolio modules (status, resources, levelling, timeline, actions, risks,
   look-ahead, dependencies, benefits, lessons, report) calls
   ``parseAllProjects()``, which loads *every* project and posts each plan's
   Markdown to ``/api/parse``. The "query" is a full scan followed by parsing
   in the scheduling engine.

The fourth pattern is the one that looks like it wants SQL, so it deserves a
closer look. A plan is a Markdown document (see :doc:`/reference/plan-format`).
Its tasks, dates, resources and RAID items exist only as text until the
scheduling engine parses them. For SQL to answer "which tasks across all
projects finish next fortnight?" the browser would first have to maintain a
parsed ``tasks`` table alongside the text, kept in step with every keystroke,
which means either duplicating the Python parser in JavaScript or writing
back the result of every ``/api/parse`` call. That table would be a derived
index of the Markdown, not the data. Markdown is canonical (issue #771) and
the portfolio views already receive the parsed form of every plan from the
engine, so a second, queryable copy buys nothing the views do not already
hold in memory.

**Is SQL actually needed here? No.** Nothing in the current or planned
portfolio views (#731-#743) performs a selective query; they all want every
project, parsed. A key-value store that returns all records in one call
serves that pattern exactly.

The candidates
~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 18 12 70

   * - Option
     - Download
     - Assessment against the access patterns
   * - **IndexedDB**, no library
     - 0 KB
     - Asynchronous, transactional, one record per object, ``getAll()`` for
       the full scan the portfolio needs, indexes if a selective query ever
       appears. Quota is a share of free disk (hundreds of MB at minimum in
       every current browser), not 5 MB. Available in every browser the app
       supports and in private windows. No headers, no worker, no build step.
   * - **sql.js** (SQLite compiled to WebAssembly, in memory)
     - 339 KB gzipped
     - Real SQL, but the database lives in memory and persistence is manual:
       export the whole database as bytes and write them *somewhere*, which
       in practice means IndexedDB. Every save would again rewrite every
       project, now as a binary blob, so it reproduces the exact fault being
       fixed while adding 85 % to the app's 407 KB gzipped JavaScript payload.
   * - **@sqlite.org/sqlite-wasm** over OPFS
     - about 500 KB gzipped
     - Real SQL with real persistence. Its default OPFS VFS needs
       ``SharedArrayBuffer``, which needs ``Cross-Origin-Opener-Policy`` and
       ``Cross-Origin-Embedder-Policy: require-corp`` on the document. The
       alternative ``opfs-sahpool`` VFS avoids those headers but takes an
       exclusive lock on the database directory, so a second tab cannot open
       the store. Either way the engine runs in a Web Worker and every call
       becomes a message round-trip.

COOP/COEP impact, assessed
~~~~~~~~~~~~~~~~~~~~~~~~~~

Had sqlite-wasm been chosen with its default VFS, ``require-corp`` would
apply to every cross-origin resource the page loads. The app loads four from
``cdn.jsdelivr.net`` (Bootstrap 5.3.0 CSS, Bootstrap Icons 1.11.3 CSS,
html2canvas 1.4.1, dagre 0.8.5) plus Google Fonts. jsDelivr and Google Fonts
send CORS headers, so each tag could be given ``crossorigin="anonymous"`` and
would still load, but the requirement then extends to every future CDN
resource, to the vendored libraries under ``static/vendor/``, to the PWA
service worker's cache and to anything the Cloudflare tunnel serves in
front of the app. A deployment-wide constraint on how the whole app is served
is a high price for a store the access patterns do not need.

Recommendation
~~~~~~~~~~~~~~

**IndexedDB.** It is the only candidate that fixes all three faults of the
old store (whole-blob rewrites, a 5 MB quota, synchronous writes) at zero
download and with no change to how the app is served. SQL earns its download
only when something needs to query across parsed plans without loading them
all, and nothing does: the portfolio views load every plan and hand it to
the scheduling engine, and Markdown, not a table, is the canonical form of a
plan. If a future view needs a selective cross-project query, the right move
is an IndexedDB index on a small derived record per project (name, dates,
RAG), not a second copy of every plan in a relational engine.

Issue #769, which framed SQLite as a working model for the editor, is
superseded by this page: the argument for a store was storage, and the
storage question is settled without SQL.
