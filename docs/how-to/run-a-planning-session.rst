How to Run a Live Planning Session
====================================

A planning session opens your plan to your team for a live working
session — a planning workshop, a stand-up, a risk review — so everyone can
edit it at once from their own browser.

Nothing is stored on the server. The relay routes messages between you and
the people who join, and forgets the session the moment you end it or
disconnect. Your browser holds the only copy of the plan.

Starting a Session
--------------------

1. Open the project you want to work on.
2. Choose **Planning session** from the ribbon.
3. NoodlePlanner shows a **six-digit code** and the **join page**
   (``https://<your NoodlePlanner>/join``).
4. Tell your team — out loud on a call, in chat, however you normally
   would: "go to …/join and enter 482913".

The session is live from that moment. You stay in your normal editor; the
plan on screen is the one everybody is editing.

Showing Your Name
-------------------

Without a profile, the people who join see your messages from "Host". To
show your own name, select the profile circle at the far right of the
title bar and fill in **Your profile**. It asks for the same details as a
resource: full name, shortname, role, email, work allocation and
non-working days. It saves as you type, and your initials then fill the
circle. Hover over the circle to see your name, role and email.

The profile is kept in this browser only, and NoodlePlanner never writes it
into a plan. The one part other people see is your name: on the messages
you send while you host, and as the name you join a session with. A
message you promote with **Add to task** keeps its sender's name in the
task's comment, as it always has. The other details are stored with the
profile, but nothing else in NoodlePlanner uses them yet.
**Clear profile** removes it, and your messages say "Host" again.

Working While the Session Runs
--------------------------------

The session panel covers the plan, so tuck it away while you work: select
the **minimise** button (–) in its header, or its close button. The panel
shrinks into the chat icon in the status bar, and the session carries on
as before — nobody is disconnected.

To read the code out again for someone joining late, or to end the session,
choose **Planning session** from the ribbon again. While a session is live
that button reopens the same panel, code unchanged, rather than starting a
new session; its tooltip reads **Show planning session** to say so.

Joining a Session
-------------------

People who join open the join page, enter the six-digit code and their
name, and land on your whiteboard — the same board you see, filling their
window. Notes have the same colours and layout as on yours, and they get
the same zoom controls, **Structure** panel and the ribbon's **Whiteboard**
tab, including **Key**, which explains the solid and dashed lines. The session chat is a panel
on the right of the board, which they can hide and bring back with **Chat**
at the top of the page; a count on that button shows messages that arrived
while it was hidden.

**Leave session** takes a joiner back to the join form. You see them leave
from your participant list, and they can rejoin with the same code.

Joiners have a profile circle too, at the right of the bar across the top
of the join page. It opens the same **Your profile** form, starting from
the name they joined as. Once they have saved a profile in that browser,
the join page fills in their name for them next time.

What Everyone Can Edit
------------------------

A joiner can do on the board what you can: add a note, rename it, change
its colour, move and resize it, add, tick and remove checklist items, draw
noodles between notes, and group notes. Each change is shown straight away
on their screen and sent to your browser, which applies it to the real
plan and sends the result back out to everyone. The plan only ever changes
in one place — your browser — so everyone always ends up looking at the
same plan.

Your own changes go out to everyone too, whether you make them on the
board or type them into the plan's text.

Anyone can rename a task, a note or a group from the board's **Plan
structure** panel by double-clicking its name (or selecting it and pressing
:kbd:`F2`). :kbd:`Enter` or clicking away keeps the new name and
:kbd:`Escape` cancels. Tasks that depend on the renamed one are updated to
the new name too.

Right-clicking a row in that panel opens a menu for the task — rename,
edit, assign resources, indent, outdent and delete — for joiners as well
as for you. The full task details form is only in your app, so a joiner's
**Edit task…** opens a small editor for the task's duration, % complete
and comment instead, and a joiner's changes reach the plan like any other
board edit.

Undoing a Change
~~~~~~~~~~~~~~~~

Joiners have **Undo** and **Redo** at the top of the page, next to
**Chat**, or they can press :kbd:`Ctrl+Z` to undo and :kbd:`Ctrl+Shift+Z`
or :kbd:`Ctrl+Y` to redo (:kbd:`Cmd` on a Mac). While the cursor is in a
text box, such as the chat or a note's name, those keys undo the typing in
that box instead.

Undo only takes back the joiner's *own* changes, one at a time. Anything
you or anyone else changed on the board in the meantime stays as it is: if
a joiner adds a note and you then rename a task, their Undo removes the
note and keeps your rename. The undo reaches everyone's board like any
other edit.

If someone has since changed the same part of the board — recoloured the
very note the joiner is trying to undo, say — that change can't be undone
without overwriting theirs, so nothing changes and the joiner sees a notice
saying why. Leaving the session clears the joiner's undo history.

Keeping Part of the Plan Private
--------------------------------

While you host a session, every row in the whiteboard's **Plan structure**
panel has an eye button that only you can see. Select it to hide that task,
and everything under it, from the people who have joined. Hidden tasks are
not sent to them at all, so they can neither see nor change them. Joiners
also don't see a hidden task's name in other tasks' dependencies or on the
board. Select the eye again to share the task again.

The eye in the panel's header works on the whole plan: select it to hide
everything, then use the eyes on individual rows to share only what the
team should see. Sharing a task that sits inside a hidden one also shares
the tasks above it, so it has somewhere to sit in the outline, but not
the other tasks beside it.

If a joiner makes an edit that would move or remove a hidden task (for
example, deleting the task it sits under), the edit is refused, and they
see a notice explaining why.

These settings last only as long as the session. They are not saved in the
plan, and ending the session (or reloading the page) forgets them.

Using Session Chat
--------------------

While you are hosting, a chat icon appears in the status bar immediately
to the left of the notification bell. Select it for a compact popup, or
use **Dock chat beside the plan** to make it a full-height column on the
right: the plan moves over to make room, so the chat never covers the
board or its panels. Joiners have the same chat in a panel to the right of
the board.

Messages appear as chat bubbles, each with the sender's initials beside
it and their name and the time above it; your own sit on the right.

Chat messages and the activity feed use the same end-to-end encrypted
channel as plan edits. The feed records useful session actions such as a
participant adding or updating a task. It is ephemeral: closing the
session discards it from every browser, and the relay never stores it.

Use **Download chat** if you deliberately want a text transcript. On the
host, **Add to task** promotes one message into the chosen task's comment;
this explicit action is the only way a chat message becomes part of the
saved plan.

When Two People Edit the Same Thing
-------------------------------------

Changes to *different* parts of the plan never lose either one: if a
joiner moves one note while you rename another, both land, even when they
happen at the same moment.

If two people change the *same* line at the same moment — both recolour
the same note, say — the one your browser received first wins, and it is
never silent: the other person sees a notice that someone changed the same
part of the board, and their board shows the version that won.

Seeing and Removing Participants
----------------------------------

While anyone is in the session, their initials appear in the title bar,
next to the **Planning session** button. Hover over one to see who it is
and whether they are active, or select it to open the session chat.

The session panel lists everyone who has joined and whether they are
currently active. **Remove** disconnects one person without affecting the
session or anyone else — they see an explanation and can rejoin if you
share the code again.

Ending a Session
------------------

**End session** closes every connection. Joiners are told the session
ended and their copy is discarded — nothing persists on their machine.

The same happens if you simply close your laptop, with a message saying the
host disconnected. Sessions also expire on their own after a period of
inactivity.

If Your Browser Crashes Mid-Session
-------------------------------------

While a session is running, your browser saves contributions locally as
they arrive. If it dies — a crash, a closed laptop, a lost tab — you are
offered the session back the next time you open NoodlePlanner:

.. code-block:: text

   A planning session ended unexpectedly. Contributions from it
   were saved locally.  [Restore]  [Discard]

It is an offer rather than an automatic restore, because you may have moved
on since, and quietly overwriting your current plan would be worse than the
crash. Ending a session normally clears it, so you are not asked about work
that was never at risk.

Security
----------

* The six-digit code gets someone **into** the session. It is never used
  as an encryption key — a million combinations is far too few. The
  encryption keys come from an exchange between the two browsers, and the
  code is what authenticates that exchange.
* The relay stores nothing and only ever handles ciphertext. Because it
  sees the code (it has to, to let people in), a deliberately modified
  relay could in principle intercept the key exchange; the protection is
  that nothing about the session, plan or chat is ever kept on the server.
* Session chat and activity entries are ciphertext too, and are kept only
  in the participants' browser memory unless the host explicitly downloads
  a transcript or promotes a message to a task comment.
* Repeated **wrong** code attempts from one place are rate limited, and a
  code dies with its session. Correct ones are not, so a
  whole team behind one office connection can join.
* Only you can end the session or remove someone. A joiner cannot do
  either, even by crafting their own messages.

Limitations
-------------

* Joiners hold no saved copy. Only the host's browser saves, by design.
* Sessions do not survive a server restart — deliberately, since the server
  stores nothing.
* Hiding works on the task outline. Free text elsewhere in the plan, such as
  a RAID log description that mentions a hidden task by name, is still
  shared. Two tasks with the same name share one hide setting.

.. seealso::

   :doc:`../explanation/browser-first-architecture`
       Why the relay stores nothing, and what the server is still used for.
