/**
 * theme.js — Dark / light mode support for NoodlePlanner.
 *
 * Themes: "light" (default), "dark", or "system" (follows OS preference).
 * Preference is stored in localStorage under "np-theme-choice" and optionally
 * in the plan front-matter as "theme: dark|light|system".
 *
 * Must be loaded after state.js and before script.js.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {'light'|'dark'|'system'} */
let currentThemeChoice = 'light';

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective theme ("light" or "dark") from a choice string.
 */
function resolveTheme(choice) {
    if (choice === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return choice === 'dark' ? 'dark' : 'light';
}

/**
 * Apply the resolved theme to the document and update the toggle icon.
 */
function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    updateThemeIcon(theme);
    updateThemeMenuChecks();
}

/**
 * Update the toggle button icon to reflect the current theme.
 */
function updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (!icon) return;
    if (theme === 'dark') {
        icon.className = 'bi bi-moon-fill';
    } else {
        icon.className = 'bi bi-sun-fill';
    }
}

/**
 * Mark the active choice in the theme dropdown menu.
 */
function updateThemeMenuChecks() {
    const items = document.querySelectorAll('.theme-menu-item');
    items.forEach(function(item) {
        var choice = item.getAttribute('data-theme-choice');
        var check = item.querySelector('.theme-check');
        if (choice === currentThemeChoice) {
            item.classList.add('active');
            if (check) check.textContent = '\u2713';
        } else {
            item.classList.remove('active');
            if (check) check.textContent = '';
        }
    });
}

// ---------------------------------------------------------------------------
// Public API — called from HTML onclick handlers
// ---------------------------------------------------------------------------

/**
 * Toggle the theme dropdown menu open/closed.
 */
function toggleThemeMenu(event) {
    event.stopPropagation();
    var menu = document.getElementById('themeMenu');
    var btn = document.getElementById('themeToggleBtn');
    if (!menu) return;

    // Close any other open nav menus first
    if (typeof closeAllNavMenus === 'function') closeAllNavMenus();

    var isOpen = menu.classList.contains('show');
    menu.classList.toggle('show', !isOpen);
    if (btn) btn.setAttribute('aria-expanded', String(!isOpen));

    if (!isOpen) {
        // Focus the first menu item for keyboard accessibility
        var first = menu.querySelector('.theme-menu-item');
        if (first) first.focus();
    }
}

/**
 * Set the theme choice and persist it.
 * @param {'light'|'dark'|'system'} choice
 */
function setThemeChoice(choice) {
    currentThemeChoice = choice;
    localStorage.setItem('np-theme-choice', choice);
    applyTheme(resolveTheme(choice));
    closeThemeMenu();
    syncThemeToFrontMatter(choice);
}

/**
 * Close the theme dropdown menu.
 */
function closeThemeMenu() {
    var menu = document.getElementById('themeMenu');
    var btn = document.getElementById('themeToggleBtn');
    if (menu) menu.classList.remove('show');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------------------
// Front-matter sync
// ---------------------------------------------------------------------------

/**
 * Write the chosen theme into the editor's plan front-matter.
 */
function syncThemeToFrontMatter(choice) {
    var editor = document.getElementById('planEditor');
    if (!editor) return;

    var text = editor.value;
    if (!text) return;

    var lines = text.split('\n');
    var firstDash = -1;
    var secondDash = -1;
    var themeLine = -1;

    for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            if (firstDash === -1) {
                firstDash = i;
            } else {
                secondDash = i;
                break;
            }
        }
        if (firstDash !== -1 && secondDash === -1 && lines[i].match(/^\s*theme\s*:/i)) {
            themeLine = i;
        }
    }

    if (firstDash === -1) {
        // No front matter at all — insert one
        editor.value = '---\ntheme: ' + choice + '\n---\n' + text;
        triggerEditorRender();
        return;
    }

    if (themeLine !== -1) {
        // Update existing theme line
        lines[themeLine] = 'theme: ' + choice;
    } else if (secondDash !== -1) {
        // Insert theme line before the closing ---
        lines.splice(secondDash, 0, 'theme: ' + choice);
    }

    editor.value = lines.join('\n');
    triggerEditorRender();
}

/**
 * Read theme preference from the parsed front-matter and apply it.
 * Called from updateAllViews after a parse response.
 */
function applyThemeFromFrontMatter(frontMatter) {
    if (!frontMatter) return;

    var fmTheme = frontMatter.theme;
    if (!fmTheme) return;

    fmTheme = String(fmTheme).trim().toLowerCase();
    if (fmTheme !== 'light' && fmTheme !== 'dark' && fmTheme !== 'system') return;

    // Only apply if different from current, to avoid feedback loops
    if (fmTheme === currentThemeChoice) return;

    currentThemeChoice = fmTheme;
    localStorage.setItem('np-theme-choice', fmTheme);
    applyTheme(resolveTheme(fmTheme));
}

/**
 * Trigger a render from theme changes. Debounced to avoid rapid re-renders.
 */
var _themeRenderTimer = null;
function triggerEditorRender() {
    if (_themeRenderTimer) clearTimeout(_themeRenderTimer);
    _themeRenderTimer = setTimeout(function() {
        if (typeof renderText === 'function') {
            renderText();
        }
    }, 500);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the theme system on page load.
 */
function initTheme() {
    // Read saved preference (the FOUC-prevention script in <head> already set
    // the data-theme attribute, so here we just restore JS state).
    var saved = localStorage.getItem('np-theme-choice');
    if (saved === 'dark' || saved === 'system') {
        currentThemeChoice = saved;
    } else {
        currentThemeChoice = 'light';
    }

    applyTheme(resolveTheme(currentThemeChoice));

    // Listen for OS theme changes when in "system" mode
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', function() {
        if (currentThemeChoice === 'system') {
            applyTheme(resolveTheme('system'));
        }
    });

    // Close theme menu when clicking elsewhere
    document.addEventListener('click', function(e) {
        var wrapper = document.querySelector('.theme-toggle-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            closeThemeMenu();
        }
    });

    // Keyboard navigation within the theme menu
    var menu = document.getElementById('themeMenu');
    if (menu) {
        menu.addEventListener('keydown', function(e) {
            var items = Array.from(menu.querySelectorAll('.theme-menu-item'));
            var idx = items.indexOf(document.activeElement);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                var next = (idx + 1) % items.length;
                items[next].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                var prev = (idx - 1 + items.length) % items.length;
                items[prev].focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (idx >= 0) items[idx].click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeThemeMenu();
                var btn = document.getElementById('themeToggleBtn');
                if (btn) btn.focus();
            }
        });
    }
}

// Run on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}
