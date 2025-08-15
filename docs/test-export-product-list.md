# Test Script: Export Product List Hierarchy

## Purpose
Verify that the product list export to CSV and Excel matches the UI hierarchy and order, and that indentation reflects the hierarchy depth.

## Prerequisites
- A project with a hierarchical product list (with at least 2 levels of nesting)
- User is logged in and on the planning room page

## Steps

### 1. Export to CSV
- Click the hamburger menu above the product list
- Select "Export to CSV"
- Open the downloaded CSV file
- **Verify:**
  - The order of products matches the UI
  - Indentation (spaces) in the name column reflects hierarchy depth
  - Parent/child relationships are clear from indentation

### 2. Export to Excel
- Click the hamburger menu above the product list
- Select "Export to Excel"
- Open the downloaded Excel file
- **Verify:**
  - The order of products matches the UI
  - Indentation (spaces) in the name column reflects hierarchy depth
  - Parent/child relationships are clear from indentation

### 3. Edge Cases
- Add, move, indent, or outdent products in the UI
- Repeat export steps above
- **Verify:**
  - Exported files always match the current UI order and hierarchy

## Expected Results
- Both CSV and Excel exports match the UI's product order and hierarchy, with indentation for each level.
- No missing or extra products.
- Indentation is visually clear in exported files.
