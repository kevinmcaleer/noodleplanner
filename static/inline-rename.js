// JS for inline renaming of products and projects

document.addEventListener('DOMContentLoaded', function() {
    // Inline rename for projects
    document.querySelectorAll('.editable-project').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (el.querySelector('input')) return;
            const current = el.textContent;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = current;
            input.className = 'rename-input';
            el.textContent = '';
            el.appendChild(input);
            input.focus();
            input.select();
            input.addEventListener('blur', function() {
                submitRename(el, input.value, el.dataset.projectId, 'project');
            });
            input.addEventListener('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    input.blur();
                } else if (ev.key === 'Escape') {
                    el.textContent = current;
                }
            });
        });
    });
    // Inline rename for products
    document.querySelectorAll('.editable-product').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (el.querySelector('input')) return;
            const current = el.textContent;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = current;
            input.className = 'rename-input';
            el.textContent = '';
            el.appendChild(input);
            input.focus();
            input.select();
            input.addEventListener('blur', function() {
                submitRename(el, input.value, el.dataset.productId, 'product');
            });
            input.addEventListener('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    input.blur();
                } else if (ev.key === 'Escape') {
                    el.textContent = current;
                }
            });
        });
    });
});

function submitRename(el, newName, id, type) {
    if (!newName.trim()) {
        el.textContent = el.dataset.originalName;
        return;
    }
    fetch(`/rename-${type}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
    })
    .then(resp => resp.json())
    .then(data => {
        if (data.success) {
            el.textContent = newName;
            el.dataset.originalName = newName;
        } else {
            el.textContent = el.dataset.originalName;
            alert('Rename failed: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(() => {
        el.textContent = el.dataset.originalName;
        alert('Rename failed');
    });
}
