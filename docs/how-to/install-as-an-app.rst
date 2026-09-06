How to Install NoodlePlanner as an App
=======================================

NoodlePlanner is a Progressive Web App: you can install it from the browser
and run it in its own window, with its own icon in the Dock, taskbar or home
screen, and no browser tabs or address bar around it. Nothing changes about
where your plans live; they stay in the browser's storage on your machine,
exactly as when you use the site in a tab.

Install it
-----------

**Chrome or Edge on a desktop**

1. Open NoodlePlanner.
2. Click the **install** icon at the right-hand end of the address bar (a
   monitor with a down arrow), or open the browser menu and choose
   **Install Noodle Planner**.
3. Confirm. The app opens in its own window and appears among your
   applications; launch it from there in future.

**Safari on a Mac** (macOS Sonoma or later)

1. Open NoodlePlanner.
2. Choose **File** → **Add to Dock**.

**iPhone or iPad**

1. Open NoodlePlanner in Safari.
2. Tap **Share**, then **Add to Home Screen**.

**Android**

1. Open NoodlePlanner in Chrome.
2. Tap the menu, then **Install app** (or **Add to Home screen**).

Uninstall it the way you would any other app on that platform; your plans
are kept, because they belong to the browser profile, not to the installed
window.

Working offline
----------------

Once installed, the app opens even without a network connection. The last
copy of the app page and its scripts are kept by the browser, and your plans
are already on your machine, so the editor, the views and the exports that
run in the browser (the native ``.mpp`` export among them) work as usual.
Anything that needs the server, such as rendering a changed plan or the
Excel, PDF and PowerPoint exports, waits until you are back online.

After a new version is deployed, an open app checks for it when it returns to
the foreground, reconnects to the network, and periodically while in use.
When the new version is ready, NoodlePlanner saves the current project and
reloads the page automatically. The first installation does not cause an
extra reload.

For administrators
-------------------

Installation needs a secure origin: ``https://`` in production, or
``http://localhost`` during development. The pieces the browser looks for
are:

- ``/manifest.webmanifest`` — the app's name, colours, start URL and icons
  (source: ``packages/noodle-web/src/noodle_web/static/manifest.webmanifest``);
- ``/sw.js`` — the service worker, served from the site root so its scope
  covers the whole app and stamped with the deploy's static version, so each
  deployment clears the previous cache and reloads pages controlled by the
  previous worker;
- ``/static/icons/`` — 192 px and 512 px icons, in plain and maskable forms,
  plus an Apple touch icon.

The service worker caches only the app's own static files (their URLs carry
a per-deploy hash) and the app page itself as an offline fallback. It never
caches API responses or anything but GET requests, so a plan is never
scheduled from stale data.

Related
--------

- :doc:`create-a-project` — your first plan
- :doc:`export-your-plan` — the exports, including which run in the browser
