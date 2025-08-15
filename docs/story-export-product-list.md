# User Story: Export Product List Hierarchy to Excel/CSV

## Story
As a user, I want to export the current product list hierarchy for my project to Excel or CSV, so I can analyze, share, or process the structure outside the app.

## Acceptance Criteria
- There is a hamburger menu above the product list.
- The menu provides options to export the product list hierarchy to CSV or Excel.
- The exported file includes the current hierarchy as shown in the UI.
- The exported order matches the UI (depth-first, left-to-right, top-to-bottom).
- Indentation in the exported file (CSV and Excel) reflects the hierarchy depth for each product.
- (Future) The export can include additional data columns as the feature evolves.

## Notes
- Export should reflect the current order and nesting of products.
- Indentation (spaces) is used in the exported name column to show hierarchy depth, matching the UI.
- Both CSV and Excel exports are supported and tested.
- See also: `feature-planning-room.md` for technical details and implementation notes.
- See `test-export-product-list.md` for manual test steps.
