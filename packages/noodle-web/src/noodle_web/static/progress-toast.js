/**
 * Progress toast: a persistent toast notification with a status line and a
 * progress bar, for long-running operations (e.g. the portfolio PowerPoint
 * export) that should keep the user informed without blocking anything.
 *
 * Usage:
 *   const toast = showProgressToast('Preparing export...');
 *   toast.update('Capturing timelines (2/5)...', 40);
 *   toast.done('Exported Portfolio-Report.pptx');   // or toast.fail('...')
 */
function showProgressToast(initialText) {
    const toast = document.createElement('div');
    toast.className = 'progress-toast';
    toast.innerHTML =
        '<div class="progress-toast-text"></div>' +
        '<div class="progress-toast-bar-track"><div class="progress-toast-bar-fill"></div></div>';
    document.body.appendChild(toast);

    const textEl = toast.querySelector('.progress-toast-text');
    const fillEl = toast.querySelector('.progress-toast-bar-fill');
    textEl.textContent = initialText || '';

    requestAnimationFrame(() => { toast.classList.add('show'); });

    function hideAfter(delayMs) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, delayMs);
    }

    return {
        /** Update the status text and/or progress percentage (0-100). */
        update(text, percent) {
            if (text !== undefined && text !== null) textEl.textContent = text;
            if (percent !== undefined && percent !== null) {
                fillEl.style.width = Math.max(0, Math.min(100, percent)) + '%';
            }
        },
        /** Mark the operation complete and fade the toast out. */
        done(text) {
            if (text !== undefined && text !== null) textEl.textContent = text;
            fillEl.style.width = '100%';
            toast.classList.add('progress-toast-success');
            hideAfter(2000);
        },
        /** Mark the operation failed and fade the toast out. */
        fail(text) {
            if (text !== undefined && text !== null) textEl.textContent = text;
            toast.classList.add('progress-toast-error');
            hideAfter(3500);
        },
        /** Dismiss immediately, without a success/error state. */
        remove() {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }
    };
}
