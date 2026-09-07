#!/usr/bin/env python3
"""Capture screenshots of NoodlePlanner for Sphinx documentation.

Connects to a running NoodlePlanner instance (default: http://localhost:8007),
loads a sample plan, and captures screenshots of key views.

Requirements:
    - selenium (pip install selenium)
    - Chrome browser + chromedriver (or webdriver-manager)
    - A running NoodlePlanner instance

Usage:
    python docs/capture_screenshots.py
    python docs/capture_screenshots.py --base-url http://localhost:9000
"""

import argparse
import os
import time
from pathlib import Path

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import (
        TimeoutException,
        NoSuchElementException,
        WebDriverException,
    )
except ImportError:
    raise SystemExit(
        "selenium is required: pip install selenium"
    )

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "http://localhost:8007"

IMG_ROOT = Path(__file__).resolve().parent / "_static" / "img"

SAMPLE_PLAN = """\
---
title: Website Redesign 2026
project manager: Alex Chen
sponsor: Marketing Director
budget: £125,000
status: Amber
Resources:
- @alex: Alex Chen, Project Manager
- @jamie: Jamie Smith, Developer
- @sam: Sam Lee, Designer
---

Discovery & Planning
  Stakeholder interviews @alex 3d start:2026-04-14 100%
  *Requirements gathering @alex @jamie 2d 75%
  Sign-off on requirements @alex 0d [depends Requirements gathering]

Design
  Wireframes @sam 5d [depends Sign-off on requirements]
  *Design review @alex @sam 1d
  *Final designs @sam 3d "Includes mobile breakpoints"

Development
  Frontend build @jamie 10d [depends Final designs]
  *Backend integration @jamie 5d
  *Code review @alex @jamie 2d

Testing & Launch
  UAT @alex @sam 3d [depends Code review]
  *Bug fixes @jamie 2d
  Go Live 0d [depends Bug fixes]
"""

# ---------------------------------------------------------------------------
# Driver setup
# ---------------------------------------------------------------------------


def create_driver():
    """Create a headless Chrome WebDriver with high-DPI settings."""
    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1440,900")
    options.add_argument("--force-device-scale-factor=2")

    # Try system chromium/chromedriver first (e.g. Raspberry Pi / Debian)
    chromium_paths = ["/usr/bin/chromium", "/usr/bin/chromium-browser"]
    for path in chromium_paths:
        if os.path.exists(path):
            options.binary_location = path
            break

    # Try system chromedriver first
    chromedriver_paths = ["/usr/bin/chromedriver", "/usr/local/bin/chromedriver"]
    for drv_path in chromedriver_paths:
        if os.path.exists(drv_path):
            try:
                service = ChromeService(executable_path=drv_path)
                return webdriver.Chrome(service=service, options=options)
            except WebDriverException:
                continue

    # Try webdriver-manager for automatic chromedriver management
    try:
        from webdriver_manager.chrome import ChromeDriverManager

        service = ChromeService(ChromeDriverManager().install())
        return webdriver.Chrome(service=service, options=options)
    except (ImportError, Exception):
        pass

    # Fall back to default
    try:
        return webdriver.Chrome(options=options)
    except WebDriverException as exc:
        raise SystemExit(
            f"Chrome/chromedriver not available: {exc}"
        )


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def load_plan(driver, plan_text):
    """Clear the editor, paste *plan_text*, and trigger a render."""
    dismiss_tour(driver)
    # Make sure we are on the project tab with the editor visible
    driver.execute_script(
        "if (typeof switchTab === 'function') switchTab('project');"
    )
    time.sleep(0.5)

    editor = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    # Clear and set value via JS to avoid send_keys issues with large text
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        plan_text,
    )
    time.sleep(0.3)

    # Trigger render
    driver.execute_script(
        "if (typeof renderPlan === 'function') renderPlan();"
    )


def wait_for_render(driver, timeout=10):
    """Wait for the plan output area to populate after rendering."""
    # Wait for the output area / dashboard to have meaningful content
    WebDriverWait(driver, timeout).until(
        lambda d: len(
            d.find_element(By.TAG_NAME, "body").text
        ) > 200
    )
    # Extra pause for animations and chart rendering
    time.sleep(2)


def switch_to_view(driver, view_id):
    """Switch to a plan sub-navigation view by its data-view identifier.

    Uses the JavaScript switchToView() function for reliability, with
    special handling for dashboard and kanban which have their own functions.
    """
    special = {
        "project-report": "switchPlanSubnavToDashboard()",
        "kanban": "switchPlanSubnavToBoard()",
    }
    js = special.get(view_id, f"switchToView('{view_id}')")
    driver.execute_script(js)
    time.sleep(2)  # let view render and animations settle


def capture_element(driver, selector, output_path):
    """Screenshot a specific DOM element and save to *output_path*."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        element = WebDriverWait(driver, 8).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, selector))
        )
        element.screenshot(str(output_path))
        print(f"  [element] {output_path}")
    except (TimeoutException, NoSuchElementException) as exc:
        print(f"  [SKIP]    {output_path} — element not found: {selector} ({exc})")


def dismiss_tour(driver):
    """Dismiss the onboarding tour popup by setting the cookie and hiding overlays."""
    driver.execute_script(
        "document.cookie = 'tourCompleted=true; path=/; max-age=31536000';"
        "var overlay = document.getElementById('tourOverlay');"
        "if (overlay) overlay.style.display = 'none';"
        "var popup = document.getElementById('tourPopup');"
        "if (popup) popup.style.display = 'none';"
        "var spotlight = document.getElementById('tourSpotlight');"
        "if (spotlight) spotlight.style.display = 'none';"
    )
    time.sleep(0.3)


def capture_full(driver, output_path):
    """Take a full-viewport screenshot and save to *output_path*."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    driver.save_screenshot(str(output_path))
    print(f"  [full]    {output_path}")


# ---------------------------------------------------------------------------
# Screenshot routines
# ---------------------------------------------------------------------------


def capture_tutorials(driver, base_url):
    """Capture screenshots for the tutorials section."""
    section = IMG_ROOT / "tutorials"
    print("\n--- Tutorials ---")

    # gs-01: Welcome screen (fresh page, no plan loaded)
    driver.get(base_url)
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    dismiss_tour(driver)
    time.sleep(1)
    capture_full(driver, section / "gs-01-welcome-screen.png")

    # gs-02: Editor with plan text (before render)
    driver.execute_script(
        "if (typeof switchTab === 'function') switchTab('project');"
    )
    time.sleep(0.5)
    editor = driver.find_element(By.ID, "planEditor")
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        SAMPLE_PLAN,
    )
    time.sleep(0.5)
    capture_full(driver, section / "gs-02-editor-with-plan.png")

    # gs-03: Rendered dashboard
    driver.execute_script(
        "if (typeof renderPlan === 'function') renderPlan();"
    )
    wait_for_render(driver)
    switch_to_view(driver, "project-report")
    capture_full(driver, section / "gs-03-rendered-dashboard.png")


def capture_how_to(driver, base_url):
    """Capture screenshots for the how-to section."""
    section = IMG_ROOT / "how-to"
    print("\n--- How-to ---")

    # Ensure plan is loaded and rendered
    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # gv-01: Gantt chart
    switch_to_view(driver, "gantt")
    capture_full(driver, section / "gv-01-gantt-full.png")

    # kb-01: Kanban board (grouped by phase — the default)
    switch_to_view(driver, "kanban")
    capture_full(driver, section / "kb-01-kanban-phase.png")

    # tl-01: Timeline view
    switch_to_view(driver, "timeline")
    capture_full(driver, section / "tl-01-timeline.png")

    # cp-01: Editor showing front matter
    driver.execute_script(
        "if (typeof switchTab === 'function') switchTab('project');"
    )
    time.sleep(0.5)
    # Scroll editor to top to show front matter
    editor = driver.find_element(By.ID, "planEditor")
    driver.execute_script("arguments[0].scrollTop = 0;", editor)
    time.sleep(0.3)
    capture_full(driver, section / "cp-01-editor-frontmatter.png")

    # mr-01: Resource table view
    switch_to_view(driver, "resources")
    capture_full(driver, section / "mr-01-resource-table.png")

    # wb-01: Whiteboard (empty canvas — issue #845 ships pan/zoom only,
    # no notes yet, so this just shows the dot-grid surface and toolbar)
    switch_to_view(driver, "whiteboard")
    capture_full(driver, section / "wb-01-whiteboard-empty.png")


def capture_reference(driver, base_url):
    """Capture screenshots for the reference section."""
    section = IMG_ROOT / "reference"
    print("\n--- Reference ---")

    # Ensure plan is loaded and rendered
    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # ks-01: Keyboard shortcuts modal
    # Open via JS since the ? key needs a non-input context
    driver.execute_script(
        "if (typeof openShortcutsModal === 'function') openShortcutsModal();"
        "else if (typeof showKeyboardShortcuts === 'function') showKeyboardShortcuts();"
    )
    time.sleep(1)
    capture_full(driver, section / "ks-01-keyboard-shortcuts.png")
    # Close it
    driver.execute_script(
        "if (typeof closeShortcutsModal === 'function') closeShortcutsModal();"
        "else if (typeof closeKeyboardShortcuts === 'function') closeKeyboardShortcuts();"
    )
    time.sleep(0.5)

    # vw-01: Sub-navigation bar
    switch_to_view(driver, "project-report")
    time.sleep(0.5)
    capture_element(
        driver,
        "#planSubnav",
        section / "vw-01-subnav.png",
    )


def capture_explanation(driver, base_url):
    """Capture screenshots for the explanation section."""
    section = IMG_ROOT / "explanation"
    print("\n--- Explanation ---")

    # Ensure plan is loaded and rendered (plan has status: Amber)
    driver.get(base_url)
    load_plan(driver, SAMPLE_PLAN)
    wait_for_render(driver)

    # rs-01: Dashboard showing RAG status
    switch_to_view(driver, "project-report")
    capture_full(driver, section / "rs-01-rag-dashboard.png")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Capture NoodlePlanner screenshots for documentation."
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"URL of the running NoodlePlanner instance (default: {DEFAULT_BASE_URL})",
    )
    args = parser.parse_args()

    print(f"Capturing screenshots from {args.base_url}")
    print(f"Saving to {IMG_ROOT}")

    driver = create_driver()
    try:
        capture_tutorials(driver, args.base_url)
        capture_how_to(driver, args.base_url)
        capture_reference(driver, args.base_url)
        capture_explanation(driver, args.base_url)
        print("\nDone. All screenshots saved.")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
