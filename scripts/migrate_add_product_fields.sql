-- Add new fields to products table for richer product details
ALTER TABLE products ADD COLUMN description TEXT;
ALTER TABLE products ADD COLUMN dependencies TEXT;
ALTER TABLE products ADD COLUMN resources TEXT;
ALTER TABLE products ADD COLUMN skills TEXT;
ALTER TABLE products ADD COLUMN derived_from TEXT;
ALTER TABLE products ADD COLUMN composed_of TEXT;
ALTER TABLE products ADD COLUMN acceptance_criteria TEXT;
