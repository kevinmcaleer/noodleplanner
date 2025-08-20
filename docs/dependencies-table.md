# Dependencies Table Schema

The `dependencies` table is now included in `database.dbml` and should be used as the source of truth for all schema migrations and documentation.

## Table Structure
- `id` (integer, primary key, auto-increment)
- `from_product_id` (integer, foreign key to products.id)
- `to_product_id` (integer, foreign key to products.id)
- (Optionally: type, notes)

## Action
- The old `dependencies.dbml` file can be deleted as it is now redundant.
