// Planning Canvas JS: Drag, drop, connect nodes
// This is a minimal MVP for visual node movement and connection handles


document.addEventListener('DOMContentLoaded', function() {
    const canvas = document.getElementById('canvas');
    const svg = document.getElementById('connections');
    let nodeData = {};
    let dragging = null, offsetX = 0, offsetY = 0;
    let connecting = null;

    function getProducts() {
        // Use all products from hidden JSON blob for full tree
        const json = document.getElementById('all-products-json');
        if (!json) return [];
        try {
            return JSON.parse(json.textContent);
        } catch {
            return [];
        }
    }

    function clearNodes() {
        Object.values(nodeData).forEach(nd => {
            if (nd.node && nd.node.parentNode === canvas) canvas.removeChild(nd.node);
        });
        nodeData = {};
    }

    function renderNodes() {
        clearNodes();
        // Remove all child nodes from canvas to prevent duplicates, but keep the SVG for connections
        const svg = document.getElementById('connections');
        Array.from(canvas.childNodes).forEach(child => {
            if (child !== svg) {
                canvas.removeChild(child);
            }
        });
        const products = getProducts();
        // Debug: log products array
        console.log('[canvas.js] products from #all-products-json:', products);
    // --- Classic vertical tree layout: parent on its own row, children beneath ---
    const NODE_WIDTH = 140;
    const NODE_HEIGHT = 60;
    const X_SPACING = -60;
    const Y_SPACING = 5;
    let yStart = 40;
    // Track max X and Y to resize canvas if needed
    let maxX = 0;
    let maxY = 0;
        // Ensure productMap is available to all inner functions
        const productMap = {};

        // First pass: compute subtree height
        function computeSubtreeHeight(el) {
            const id = el.id || el.productId || el['productId'] || el['id'];
            if (!id) return 0;
            const children = products.filter(child => String(child.plan_id) === String(id));
            if (!children.length) return NODE_HEIGHT;
            let height = 0;
            children.forEach(child => {
                height += computeSubtreeHeight(child) + Y_SPACING;
            });
            height -= Y_SPACING; // Remove extra spacing after last child
            return Math.max(height, NODE_HEIGHT);
        }

        // Second pass: layout nodes
        function layoutTree(el, depth, x, y) {
            if (!el) return;
            const id = el.id || el.productId || el['productId'] || el['id'];
            if (!id) return;
            const type = 'product';
            const name = el.name;
            const planId = el.plan_id;
            const node = document.createElement('div');
            node.className = 'node' + (type === 'group' ? ' group' : '');
            node.style.left = x + 'px';
            node.style.top = y + 'px';
            node.dataset.productId = id;
            node.innerHTML = `
                <div class="handles" style="display:none; width:calc(100% + 32px); left:-16px; top:-24px; position:absolute; align-items:center; justify-content:space-between;">
                    <div class="handle" data-pos="top"></div>
                    <div class="handle" data-pos="middle"></div>
                    <div class="handle" data-pos="bottom"></div>
                </div>
                <div class="label">${name}</div>
            `;
            if (type === 'group') {
                node.style.borderRadius = '4px';
                node.style.boxShadow = '6px 6px 24px #e06c6c66, 0 2px 8px #e06c6c22';
                node.style.transform = 'skew(-18deg)';
                node.querySelector('.label').style.transform = 'skew(18deg)';
                node.style.background = '#ffe3e3';
                node.style.border = '2.5px solid #e06c6c';
            } else {
                node.style.borderRadius = '10px';
                node.style.boxShadow = '0 4px 18px #0003, 0 1.5px 6px #6c7ae055';
                node.style.transform = '';
                node.querySelector('.label').style.transform = '';
                node.style.background = '#fff';
                node.style.border = '2px solid #6c7ae0';
            }
            canvas.appendChild(node);
            nodeData[id] = nodeData[id] || {};
            nodeData[id].node = node;
            nodeData[id].x = x;
            nodeData[id].y = y;
            nodeData[id].type = type;
            nodeData[id].plan_id = planId;
            productMap[String(id)] = { node, plan_id: planId };
            // Track max X and Y for canvas resizing
            maxX = Math.max(maxX, x + NODE_WIDTH + 40);
            maxY = Math.max(maxY, y + NODE_HEIGHT + 40);
            // Drag logic
            node.addEventListener('mousedown', function(e) {
                if (e.target.classList.contains('handle')) return;
                dragging = node;
                offsetX = e.offsetX;
                offsetY = e.offsetY;
            });
            // Show handles on hover or when connecting, and keep visible when hovering handles
            node.addEventListener('mouseenter', function() {
                node.querySelector('.handles').style.display = 'flex';
            });
            node.addEventListener('mouseleave', function() {
                if (!node.querySelector('.handles').matches(':hover') && !connecting) {
                    node.querySelector('.handles').style.display = 'none';
                }
            });
            node.querySelector('.handles').addEventListener('mouseenter', function() {
                node.querySelector('.handles').style.display = 'flex';
            });
            node.querySelector('.handles').addEventListener('mouseleave', function() {
                if (!node.matches(':hover') && !connecting) {
                    node.querySelector('.handles').style.display = 'none';
                }
            });
            // Connection handle logic with fade transition
            node.querySelectorAll('.handle').forEach(handle => {
                handle.style.borderRadius = '4px';
                handle.style.width = '16px';
                handle.style.height = '16px';
                handle.style.background = '#222';
                handle.style.transition = 'opacity 0.18s cubic-bezier(.4,0,.2,1), box-shadow 0.18s cubic-bezier(.4,0,.2,1), transform 0.18s cubic-bezier(.4,0,.2,1)';
                handle.style.opacity = '0';
                setTimeout(() => { handle.style.opacity = '1'; }, 0);
                handle.addEventListener('mousedown', function(e) {
                    e.stopPropagation();
                    connecting = { from: node, pos: handle.dataset.pos, startEvent: e };
                    document.querySelectorAll('.node .handles').forEach(h => h.style.display = 'flex');
                    drawConnections();
                });
            });
            // Layout children: each on a new row beneath the parent, all in the same column (X)
            // Preserve the order as they appear in the products array
            const children = products.filter(child => String(child.plan_id) === String(id));
            // Sort children by their index in the products array to preserve order
            const childrenOrdered = products
                .map((prod, idx) => ({ prod, idx }))
                .filter(({ prod }) => String(prod.plan_id) === String(id))
                .sort((a, b) => a.idx - b.idx)
                .map(({ prod }) => prod);
            let nextY = y + NODE_HEIGHT + Y_SPACING;
            if (childrenOrdered.length) {
                let childX = x + NODE_WIDTH + X_SPACING;
                childrenOrdered.forEach((child, i) => {
                    nextY = layoutTree(child, depth + 1, childX, nextY);
                });
            }
            return nextY;
        }

        // Layout all roots (vertical stack)
        const treeRoots = products.filter(el => el.plan_id == null);
        let rootX = 40;
        let rootY = yStart;
        treeRoots.forEach((root, i) => {
            rootY = layoutTree(root, 0, rootX, rootY);
        });
    // Resize canvas to fit all nodes
    canvas.style.width = maxX + 'px';
    canvas.style.height = maxY + 'px';
    // Save productMap for drawing connections
    nodeData._productMap = productMap;
    // Debug: log productMap before drawing connections
    console.log('[canvas.js] productMap for drawConnections:', productMap);
    drawConnections();
    }

    document.addEventListener('mousemove', function(e) {
        if (dragging) {
            const rect = canvas.getBoundingClientRect();
            let x = e.clientX - rect.left - offsetX;
            let y = e.clientY - rect.top - offsetY;
            dragging.style.left = x + 'px';
            dragging.style.top = y + 'px';
            nodeData[dragging.dataset.productId].x = x;
            nodeData[dragging.dataset.productId].y = y;
            drawConnections();
        } else if (connecting) {
            // Draw temp line from handle to cursor
            drawConnections(e);
        }
    });
    document.addEventListener('mouseup', function(e) {
        if (dragging) dragging = null;
        if (connecting) {
            // Find node under mouse
            const target = Object.values(nodeData).find(nd => {
                const rect = nd.node.getBoundingClientRect();
                return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            });
            if (target && target.node !== connecting.from) {
                // Update dependency tree in backend (set plan_id of target to from)
                const parentId = connecting.from.dataset.productId;
                const childId = target.node.dataset.productId;
                fetch(`/projects/update-product-parent/${childId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plan_id: parentId })
                }).then(() => {
                    // Instead of full reload, re-render product list and canvas from /projects/{project_id}
                    const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                    if (projectId) {
                        fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                            .then(resp => resp.text())
                            .then(html => {
                                const temp = document.createElement('div');
                                temp.innerHTML = html;
                                const newList = temp.querySelector('#product-list');
                                if (newList) {
                                    document.getElementById('product-list').innerHTML = newList.innerHTML;
                                    if (window.productTreeInit) window.productTreeInit();
                                    if (window.inlineRenameInit) window.inlineRenameInit();
                                }
                                renderNodes();
                            });
                    } else {
                        location.reload();
                    }
                });
            }
            connecting = null;
            // Hide handles after connect
            document.querySelectorAll('.node .handles').forEach(h => h.style.display = 'none');
            drawConnections();
        }
    });

    let selectedConnection = null;
    function drawConnections(mouseEvent) {
    // Always match SVG size to canvas
    svg.setAttribute('width', canvas.offsetWidth);
    svg.setAttribute('height', canvas.offsetHeight);
    svg.innerHTML = '';
        selectedConnection = null;
        // Draw connections based on plan_id (parent) relationships
        const productMap = nodeData._productMap || {};
        // Draw elbow/orthogonal connections: from bottom middle of parent to left middle of child
        Object.entries(productMap).forEach(([id, info]) => {
            const plan_id = info.plan_id;
            if (plan_id != null && productMap[String(plan_id)]) {
                const parentNode = productMap[String(plan_id)].node;
                const childNode = info.node;
                const parentRect = parentNode.getBoundingClientRect();
                const childRect = childNode.getBoundingClientRect();
                const canvasRect = canvas.getBoundingClientRect();
                // Start at bottom middle of parent, elbow at center Y of child, then horizontal to left middle of child
                const x1 = parentRect.left + parentRect.width / 2 - canvasRect.left;
                const y1 = parentRect.top + parentRect.height - canvasRect.top;
                const x2 = childRect.left - canvasRect.left;
                const y2 = childRect.top + childRect.height / 2 - canvasRect.top;
                // Elbow: vertical down from parent to y2, then horizontal to child
                let d = `M${x1},${y1} L${x1},${y2} L${x2},${y2}`;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d);
                path.setAttribute('class', 'connection');
                path.setAttribute('data-parent-id', plan_id);
                path.setAttribute('data-child-id', id);
                path.style.cursor = 'pointer';
                path.setAttribute('stroke', '#222');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('fill', 'none');
                path.setAttribute('pointer-events', 'auto');
                path.style.display = '';
                path.addEventListener('click', function(e) {
                    svg.querySelectorAll('.connection.selected').forEach(p => p.classList.remove('selected'));
                    path.classList.add('selected');
                    selectedConnection = { parentId: plan_id, childId: id, path };
                    e.stopPropagation();
                });
                svg.appendChild(path);
            }
        });
        // Highlight selected connection in red and dotted
        svg.querySelectorAll('.connection').forEach(path => {
            if (path.classList.contains('selected')) {
                path.style.stroke = '#e06c6c';
                path.style.strokeDasharray = '6,4';
                path.style.strokeWidth = '4px';
            } else {
                path.style.stroke = '';
                path.style.strokeDasharray = '';
                path.style.strokeWidth = '';
            }
        });
        // Draw temp line if connecting
        if (connecting && mouseEvent) {
            const fromRect = connecting.from.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            const x1 = fromRect.left + fromRect.width/2 - canvasRect.left;
            const y1 = fromRect.bottom - canvasRect.top;
            const x2 = mouseEvent.clientX - canvasRect.left;
            const y2 = mouseEvent.clientY - canvasRect.top;
            // Use Bezier curve when dragging
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M${x1},${y1} C${x1},${y1+40} ${x2},${y2-40} ${x2},${y2}`);
            path.setAttribute('class', 'connection connecting');
            path.setAttribute('stroke-dasharray', '6,4');
            svg.appendChild(path);
        }
    }

    // Deselect connection on canvas click
    canvas.addEventListener('click', function(e) {
        if (e.target.tagName !== 'path') {
            svg.querySelectorAll('.connection.selected').forEach(p => p.classList.remove('selected'));
            selectedConnection = null;
        }
    });

    // Delete connection with Delete key
    document.addEventListener('keydown', function(e) {
        if (selectedConnection && (e.key === 'Delete' || e.key === 'Backspace')) {
            // Remove parent-child relationship in backend
            fetch(`/projects/update-product-parent/${selectedConnection.childId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_id: null })
            }).then(() => {
                // Refresh product list and canvas
                const projectId = document.body.innerHTML.match(/\/projects\/(\d+)/)?.[1];
                if (projectId) {
                    fetch(`/projects/${projectId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                        .then(resp => resp.text())
                        .then(html => {
                            const temp = document.createElement('div');
                            temp.innerHTML = html;
                            const newList = temp.querySelector('#product-list');
                            if (newList) {
                                document.getElementById('product-list').innerHTML = newList.innerHTML;
                                if (window.productTreeInit) window.productTreeInit();
                                if (window.inlineRenameInit) window.inlineRenameInit();
                                if (window.selectableProductListInit) window.selectableProductListInit();
                            }
                            renderNodes();
                        });
                } else {
                    location.reload();
                }
            });
        }
    });

    // Expose renderNodes globally so other scripts (e.g., planning_room) can trigger re-draw after data updates
    window.renderNodes = renderNodes;

    // Initial render
    renderNodes();

    // Re-render when the hidden JSON blob with all products changes (order / hierarchy updates)
    const allProductsEl = document.getElementById('all-products-json');
    if (allProductsEl) {
        const jsonObserver = new MutationObserver(() => {
            // Slight debounce to batch rapid changes
            clearTimeout(window.__npRenderDebounce);
            window.__npRenderDebounce = setTimeout(() => {
                renderNodes();
            }, 30);
        });
        jsonObserver.observe(allProductsEl, { characterData: true, childList: true, subtree: true });
    }

    // Listen for product add/rename via DOM changes
    const productList = document.getElementById('product-list');
    const observer = new MutationObserver(() => {
        renderNodes();
    });
    if (productList) {
        observer.observe(productList, { childList: true, subtree: true, characterData: true });
    }

    // Also re-render when window resizes (for connection lines)
    window.addEventListener('resize', drawConnections);
});
