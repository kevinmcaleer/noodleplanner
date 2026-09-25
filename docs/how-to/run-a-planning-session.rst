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
the same zoom controls and **Structure** panel. The session chat is a panel
on the right of the board, which they can hide and bring back with **Chat**
at the top of the page; a count on that button shows messages that arrived
while it was hidden.

**Leave session** takes a joiner back to the join form. You see them leave
from your participant list, and they can rejoin with the same code.

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

Using Session Chat
--------------------

While you are hosting, a chat icon appears in the status bar immediately
to the left of the notification bell. Select it for a compact popup, or
use **Expand chat** to make it a full-height panel on the right. Joiners
have the same chat in a panel to the right of the board.

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

.. seealso::

   :doc:`../explanation/browser-first-architecture`
       Why the relay stores nothing, and what the server is still used for.
