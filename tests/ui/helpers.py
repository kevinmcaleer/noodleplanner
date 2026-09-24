"""Shared page helpers for the Playwright UI suite.

The Selenium files each carried their own near-identical copy of these; there
is one copy here because there is one suite.
"""


def open_app(page, app_server):
    """Load the app and wait until its scripts have wired themselves up.

    The Selenium equivalent was `browser.get(url)` followed by `time.sleep(0.3)`
    and a hope. Waiting on a real signal -- the ribbon being present -- is both
    faster (it returns as soon as the app is ready) and stabler (it cannot
    return before it).
    """
    page.goto(app_server, wait_until="domcontentloaded")
    page.wait_for_selector(".ribbon-scope-btn", state="attached")
    return page


# The tab-content pane each ribbon scope lands on.
SCOPE_PANE = {"portfolio": "#portfolio-tab", "project": "#editor-tab"}


def click_scope(page, scope):
    """Switch the ribbon between the `project` and `portfolio` scopes, and
    wait until the switch has actually landed.

    Returning the instant the click was dispatched made every caller racy in a
    way that reads as a pass. Crossing between portfolio and project contexts
    plays a 150ms fade, and the fade swaps the panes at its *end* -- so for
    those 150ms the *previous* scope's pane is still the active one. A test
    that clicked again inside that window, or asserted on a pane, was reading
    the state it was trying to leave. `#editor-tab.active` is true on boot,
    which is what let that stale read look like success.

    Waiting on `isTransitioning()` as well as the pane is what makes it
    honest: the pane alone cannot distinguish "arrived" from "has not left
    yet" when the destination is where you started.
    """
    page.click(f'.ribbon-scope-btn[data-scope="{scope}"]')
    page.wait_for_function("() => !NavigationController.isTransitioning()")
    page.wait_for_selector(f"{SCOPE_PANE[scope]}.active")


def open_project_view(page, app_server):
    open_app(page, app_server)
    click_scope(page, "project")
    return page


def open_portfolio_view(page, app_server):
    open_app(page, app_server)
    click_scope(page, "portfolio")
    return page


def set_editor_value(page, text):
    """Put `text` in the plan editor and fire the events the app listens for."""
    page.eval_on_selector(
        "#planEditor",
        """(editor, value) => {
            editor.focus();
            editor.value = value;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        text,
    )
    return page.locator("#planEditor")


def css_token(page, name):
    """Read a custom property off :root."""
    return page.evaluate(
        "name => getComputedStyle(document.documentElement)"
        "  .getPropertyValue(name).trim()",
        name,
    )


# ── Whiteboard ───────────────────────────────────────────────────────────
#
# The whiteboard is a pan/zoom canvas in a pane roughly 780px wide, and with
# most test plans' note coordinates the notes sit outside the window. Neither
# Playwright nor Selenium will mouse-click what it cannot see, so board content
# is clicked with `dispatch_event("click")` -- the same event and the same
# listener, just without the hit-test. The Selenium files did this too, via
# `execute_script("arguments[0].click()")`.


def plan_text(page):
    return page.evaluate("() => document.getElementById('planEditor').value")


def load_plan(page, text, with_project=None):
    """Put a plan in the editor and wait for the app to finish parsing it.

    `with_project` names a project to create and select first, which is what
    makes a later `wbCommitMarkdown()` actually persist:
    `getCurrentProjectId()` has to be non-null before `saveProject()` does
    anything. Only the tests that reload the page need it.

    The Selenium version waited for the editor text to stop changing for 1.5
    seconds. The real signal is the app writing the computed `rag:` key back
    into the front matter, which is both quicker and an actual guarantee that
    the parse finished rather than a guess that it probably has.
    """
    if with_project:
        page.evaluate(
            "name => { const p = createProject(name); setCurrentProjectId(p.id); }",
            with_project,
        )
    page.eval_on_selector(
        "#planEditor",
        """(editor, value) => {
            editor.value = value;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        text,
    )
    page.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('rag:')"
    )
    # An explicit undo checkpoint for the fully settled loaded state, so a
    # test's own "before" snapshot corresponds to a real undo-stack entry
    # rather than to whatever the 600ms debounce happened to capture.
    page.evaluate(
        "() => EditorUndoManager.captureImmediate("
        "  document.getElementById('planEditor').value)"
    )
    page.wait_for_function("() => EditorUndoManager.canUndo()")


def switch_to_whiteboard(page, expected_notes=1):
    page.evaluate("() => switchToView('whiteboard')")
    page.wait_for_selector("#whiteboardContainer", state="visible")
    page.wait_for_function(
        "n => document.querySelectorAll('#whiteboardContainer .wb-note').length >= n",
        arg=expected_notes,
    )


def note(page, task):
    """The whiteboard note card for `task`."""
    return page.locator(f'#whiteboardContainer .wb-note[data-wb-task="{task}"]')


def open_note_menu(page, task):
    """Open `task`'s note menu the way a user does: select the note, then
    press More on the object toolbar that floats above it. (The menu used to
    hang off a `...` button in every note's header.)"""
    page.evaluate("t => wbSetSelectedNote(t)", task)
    page.locator(".wb-object-toolbar .wb-object-toolbar-more").dispatch_event("click")


def note_task_names(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#whiteboardContainer .wb-note')]"
        "        .map(n => n.dataset.wbTask)"
    )


# ── Console ──────────────────────────────────────────────────────────────

# Requests this suite deliberately aborts (see conftest's EXTERNAL_ORIGINS).
# The browser logs a failed load for each, which is our doing rather than the
# app's, so it is filtered out the same way the Selenium suite filtered the
# ERR_NAME_NOT_RESOLVED it got for the same URLs.
_BLOCKED = ("cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com")


def actionable_console_errors(page):
    """Console errors the app is actually responsible for."""
    out = []
    for message in page.console_errors:
        if any(host in message for host in _BLOCKED):
            continue
        if "favicon" in message.lower():
            continue
        # A blocked request surfaces as a bare net:: failure with no origin.
        if "net::ERR_FAILED" in message or "net::ERR_ABORTED" in message:
            continue
        out.append(message)
    return out
