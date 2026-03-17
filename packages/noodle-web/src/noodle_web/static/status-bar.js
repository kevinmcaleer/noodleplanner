/**
 * status-bar.js — Status bar functionality for NoodlePlanner.
 * Provides status messages and project RAG indicator updates.
 */

let statusMessageTimer = null;

/**
 * Display a message in the status bar. Clears automatically after the given
 * duration (defaults to 5000ms). Pass 0 for a persistent message.
 */
function setStatusMessage(message, duration) {
    if (duration === undefined) duration = 5000;
    const el = document.getElementById('statusBarMessage');
    if (!el) return;

    if (statusMessageTimer) {
        clearTimeout(statusMessageTimer);
        statusMessageTimer = null;
    }

    el.textContent = message;

    if (duration > 0) {
        statusMessageTimer = setTimeout(function () {
            el.textContent = '';
            statusMessageTimer = null;
        }, duration);
    }
}

/**
 * Update the status bar RAG indicator based on the current project's tasks
 * and front matter. Called after each render / project switch.
 */
function updateStatusBarRAG(frontMatter, tasks) {
    const dot = document.getElementById('statusBarRAG');
    if (!dot) return;

    // Remove any existing rag class
    dot.className = 'status-bar-rag';

    if (!tasks || tasks.length === 0) {
        dot.title = 'No tasks';
        return;
    }

    // Use the same logic as the project report
    if (typeof extractRAGStatus === 'function' && typeof calculateProjectCompletionFromTasks === 'function') {
        const completion = calculateProjectCompletionFromTasks(tasks);
        const ragStatus = extractRAGStatus(frontMatter || {}, tasks, completion);
        if (ragStatus) {
            dot.classList.add('rag-' + ragStatus);
            const label = (typeof extractProjectStatusLabel === 'function')
                ? extractProjectStatusLabel(frontMatter || {}, completion, ragStatus)
                : ragStatus;
            dot.title = 'RAG: ' + label;
        }
    }
}
