// JS for product tree disclosure triangles and collapse/expand


function productTreeInit() {
    document.querySelectorAll('#product-tree .disclosure').forEach(function(triangle) {
        // Remove previous listeners by cloning
        const newTriangle = triangle.cloneNode(true);
        triangle.parentNode.replaceChild(newTriangle, triangle);
        newTriangle.addEventListener('click', function(e) {
            const li = newTriangle.closest('li');
            const childUl = li.querySelector('ul');
            if (!childUl) return;
            if (childUl.style.display === 'none' || childUl.style.display === '') {
                childUl.style.display = 'block';
                newTriangle.innerHTML = '&#9660;'; // ▼
            } else {
                childUl.style.display = 'none';
                newTriangle.innerHTML = '&#9654;'; // ▶
            }
        });
        // Start collapsed by default
        newTriangle.innerHTML = '&#9654;';
        const li = newTriangle.closest('li');
        const childUl = li.querySelector('ul');
        if (childUl) childUl.style.display = 'none';
    });
}

// Run on initial load
document.addEventListener('DOMContentLoaded', productTreeInit);
// Expose for re-init after AJAX updates
window.productTreeInit = productTreeInit;
