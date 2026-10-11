How to Keep Your Plans in Sync With an Account
===============================================

By default NoodlePlanner keeps your plans in your browser only. If the server
you use has accounts switched on, you can sign in and have your plans copied to
your account, so the same plans open on your other computers and phones.

The browser stays your working copy: plans keep working offline and signed
out, and the server holds a synced copy.

Create an account and sign in
-----------------------------

1. Click the cloud button at the right of the title bar, beside your profile
   circle, then **Create an account** (or **Sign in** if you have one).
2. Fill in the form. Passwords need at least 10 characters.
3. You land back in the planner, signed in.

The same account pages, at ``/account``, let you change your password, sign
out and delete your account. **Forgot your password?** on the sign-in page
sends a reset link by email, or writes it to the server log when the server
has no email set up (ask whoever runs it).

Turn on sync
------------

1. Click the cloud button and choose **Turn on sync**. Nothing is uploaded
   until you do.
2. The plans in this browser are uploaded, and any plans already on your
   account are downloaded.

After that, a sync runs every 30 seconds, when you return to the tab, and when
you click **Sync now**. The cloud button's ring shows the state: green when
in sync, red when something needs attention, dashed while syncing.

What is synced
--------------

Each plan's text and name. Version history, links to files on disk, and your
profile and settings stay in the browser they were made in.

Plans you delete on one device are deleted on the others. A plan that
disappears from the server is removed here only if you have not edited it and
do not have it open.

If two devices edit the same plan
---------------------------------

The copy that reached the server first is kept as the plan, and the text from
the other device is saved next to it as a new plan named
``<name> (conflict <date>)``. Nothing is lost: open both and copy across
whatever you need. The ``last_saved`` line in front matter is ignored when
deciding whether a plan changed, so having the same plan open in two tabs does
not create conflicts.

Turn sync off
-------------

Choose **Turn off sync** in the same dialog. Your plans stay in this browser
and on the server; they simply stop being connected. Signing in as a different
account on the same browser never uploads this browser's plans to it until you
turn sync on there too.
