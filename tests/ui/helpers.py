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


def click_scope(page, scope):
    """Switch the ribbon between the `project` and `portfolio` scopes."""
    page.click(f'.ribbon-scope-btn[data-scope="{scope}"]')


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


def note_task_names(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#whiteboardContainer .wb-note')]"
        "        .map(n => n.dataset.wbTask)"
    )
