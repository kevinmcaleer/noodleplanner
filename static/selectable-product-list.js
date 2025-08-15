// JS for selectable product list and indent/outdent with arrow keys

(function() {
    let selected = null;

    function selectProduct(el) {
        if (selected) {
            selected.classList.remove('selected-product');
            // Hide delete icon for previously selected
            const prevIcon = selected.parentElement.querySelector('.delete-product-icon');
            if (prevIcon) {
                prevIcon.style.display = 'none';
                console.log('Hiding delete icon for previously selected', prevIcon, selected.dataset.productId);
            }
        }
        selected = el;
        if (selected) {
            selected.classList.add('selected-product');
            // Show delete icon for currently selected (robust selector)
            let icon = selected.parentElement.querySelector('.delete-product-icon');
            if (!icon) {
                // Try to find by data-product-id
                icon = document.querySelector(`.delete-product-icon[data-product-id='${selected.dataset.productId}']`);
            }
            if (icon) {
                icon.style.display = 'inline';
                console.log('Showing delete icon for selected', icon, selected.dataset.productId);
            } else {
                console.warn('Delete icon not found for selected product', selected.dataset.productId);
            }
        }
    }

    function handleArrow(e) {
        if (!selected) return;
        const productId = selected.dataset.productId;
        if (!productId) return;
        if (e.key === 'ArrowLeft') {
            // Outdent: call backend endpoint
                window.selectedProductId = window.selectedProductId || null;
            fetch(`/projects/outdent-product/${productId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }).then(() => {
                const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                if (projectId) {
                    fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                        .then(resp => resp.text())
                        .then(html => {
                            const temp = document.createElement('div');
                            temp.innerHTML = html;
                            const newList = temp.querySelector('#product-list');
                    window.selectedProductId = selected ? selected.dataset.productId : null;
                            const newJson = temp.querySelector('#all-products-json');
                            if (newList) {
                                document.getElementById('product-list').innerHTML = newList.innerHTML;
                                if (window.selectableProductListInit) window.selectableProductListInit();
                            }
                            if (newJson) {
                                document.getElementById('all-products-json').textContent = newJson.textContent;
                            }
                            if (window.productTreeInit) window.productTreeInit();
                            if (window.inlineRenameInit) window.inlineRenameInit();
                            if (window.selectableProductListInit) window.selectableProductListInit();
                            setTimeout(() => {
                                const moved = document.querySelector(`.editable-product[data-product-id='${productId}']`);
                                if (moved) selectProduct(moved);
                            }, 50);
                            if (window.renderNodes) window.renderNodes();
                            else if (typeof renderNodes === 'function') renderNodes();
                        });
                } else {
                    window.location.reload();
                }
            });
        } else if (e.key === 'ArrowRight') {
            // Indent: call backend endpoint
            fetch(`/projects/indent-product/${productId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }).then(() => {
                const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                if (projectId) {
                    fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                        .then(resp => resp.text())
                        .then(html => {
                            const temp = document.createElement('div');
                            temp.innerHTML = html;
                            const newList = temp.querySelector('#product-list');
                            const newJson = temp.querySelector('#all-products-json');
                            if (newList) {
                                document.getElementById('product-list').innerHTML = newList.innerHTML;
                                if (window.selectableProductListInit) window.selectableProductListInit();
                            }
                            if (newJson) {
                                document.getElementById('all-products-json').textContent = newJson.textContent;
                            }
                            if (window.productTreeInit) window.productTreeInit();
                            if (window.inlineRenameInit) window.inlineRenameInit();
                            if (window.renderNodes) window.renderNodes();
                        });
                } else {
                    window.location.reload();
                }
            });
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        } else if (e.key === 'ArrowUp') {
            // Move up: call backend endpoint
            fetch(`/projects/move-product-up/${productId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }).then(() => {
                const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                if (projectId) {
                    fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                        .then(resp => resp.text())
                        .then(html => {
                            const temp = document.createElement('div');
                            temp.innerHTML = html;
                            const newList = temp.querySelector('#product-list');
                            const newJson = temp.querySelector('#all-products-json');
                            if (newList) {
                                document.getElementById('product-list').innerHTML = newList.innerHTML;
                                if (window.selectableProductListInit) window.selectableProductListInit();
                            }
                            if (newJson) {
                                document.getElementById('all-products-json').textContent = newJson.textContent;
                            }
                            if (window.productTreeInit) window.productTreeInit();
                            if (window.inlineRenameInit) window.inlineRenameInit();
                            if (window.selectableProductListInit) window.selectableProductListInit();
                            setTimeout(() => {
                                const moved = document.querySelector(`.editable-product[data-product-id='${productId}']`);
                                if (moved) selectProduct(moved);
                            }, 50);
                            if (window.renderNodes) window.renderNodes();
                        });
                } else {
                    window.location.reload();
                }
            });
        } else if (e.key === 'ArrowDown') {
            // Move down: call backend endpoint
            fetch(`/projects/move-product-down/${productId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }).then(() => {
                const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                if (projectId) {
                    fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                        .then(resp => resp.text())
                        .then(html => {
                            const temp = document.createElement('div');
                            temp.innerHTML = html;
                            const newList = temp.querySelector('#product-list');
                            const newJson = temp.querySelector('#all-products-json');
                            if (newList) {
                                document.getElementById('product-list').innerHTML = newList.innerHTML;
                            }
                            if (newJson) {
                                document.getElementById('all-products-json').textContent = newJson.textContent;
                            }
                            if (window.productTreeInit) window.productTreeInit();
                            if (window.inlineRenameInit) window.inlineRenameInit();
                            if (window.selectableProductListInit) window.selectableProductListInit();
                            setTimeout(() => {
                                const moved = document.querySelector(`.editable-product[data-product-id='${productId}']`);
                                if (moved) selectProduct(moved);
                            }, 50);
                            if (window.renderNodes) window.renderNodes();
                        });
                } else {
                    window.location.reload();
                }
            });
        }
    }

    function initSelectableProductList() {
    // No-op: removed diagnostic MutationObserver
    // Defensive: always re-init after AJAX update
    // This is called after DOM is updated, so listeners are restored
    if (!document.getElementById('product-list')) return;
        // Track selected product id before DOM replacement
        let selectedId = selected ? selected.dataset.productId : null;

    // No node cloning! Just re-attach event listeners to new DOM

        // Attach event listeners to new DOM
        document.querySelectorAll('.editable-product').forEach(el => {
            el.addEventListener('click', function(e) {
                selectProduct(el);
            });
        });
        document.querySelectorAll('.delete-product-icon').forEach(icon => {
            icon.addEventListener('click', function(e) {
                e.stopPropagation();
                const productId = icon.dataset.productId;
                if (!productId) return;
                // Outdent all children first
                const children = Array.from(document.querySelectorAll(`.editable-product[data-plan-id='${productId}']`));
                const outdentChildren = children.map(child => {
                    return fetch(`/projects/update-product-parent/${child.dataset.productId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ plan_id: null })
                    });
                });
                Promise.all(outdentChildren).then(() => {
                    // Delete the product itself
                    fetch(`/projects/delete-product/${productId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }).then(() => {
                        // Refresh product list and canvas via AJAX, update JSON blob
                        const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                        if (projectId) {
                            fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                                .then(resp => resp.text())
                                .then(html => {
                                    const temp = document.createElement('div');
                                    temp.innerHTML = html;
                                    const newList = temp.querySelector('#product-list');
                                    const newJson = temp.querySelector('#all-products-json');
                                    if (newList) {
                                        document.getElementById('product-list').innerHTML = newList.innerHTML;
                                        if (window.selectableProductListInit) window.selectableProductListInit();
                                    }
                                    if (newJson) {
                                        document.getElementById('all-products-json').textContent = newJson.textContent;
                                    }
                                    if (window.renderNodes) window.renderNodes(); // Always update canvas after JSON changes
                                    if (window.productTreeInit) window.productTreeInit();
                                    if (window.inlineRenameInit) window.inlineRenameInit();
                                });
                        } else {
                            window.location.reload();
                        }
                    });
                });
            });
        });

        // Restore selection and delete icon after DOM update
        if (selectedId) {
            const newSelected = document.querySelector(`.editable-product[data-product-id='${selectedId}']`);
            if (newSelected) selectProduct(newSelected);
        }

        // Remove previous keydown event listeners and re-attach
        document.removeEventListener('keydown', handleArrow);
        document.addEventListener('keydown', handleArrow);
    // Add a style for selected
    const style = document.createElement('style');
    style.innerHTML = `.selected-product { background: #dbeafe; border-radius: 6px; }`;
    document.head.appendChild(style);

    window.selectableProductListInit = initSelectableProductList;
    window.renderNodes = window.renderNodes || undefined;
    document.addEventListener('DOMContentLoaded', initSelectableProductList);
}
})();
