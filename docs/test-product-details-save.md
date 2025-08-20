# Test: Product Details Save

## Purpose
Ensure that editing and saving product details in the planning room updates the backend and persists after refresh.

## Steps
1. Open a project planning room as an authenticated user.
2. Select a product in the product tree.
3. Edit one or more fields in the product details panel (e.g., description, dependencies).
4. Click Save.
5. Refresh the page.
6. Verify that the changes persist and are visible in the details panel.

## Expected Result
- Product details are updated in the backend and persist after refresh.
- No errors are shown.

## Related Bugs
- BUG-0005 (fixed 2025-08-20)

## Related Tests
- `test_planning_room_access_and_product_add`
- `test_products_crud_and_order`
