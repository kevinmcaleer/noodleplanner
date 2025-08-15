
import os
import sys
import pytest
import sqlite3
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db import create_tables, DATABASE_URL

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()
    yield
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)

import sqlite3

def test_products_table_valid():
    conn = sqlite3.connect(DATABASE_URL)
    cursor = conn.cursor()
    # Check for NULL or empty name
    cursor.execute("SELECT id FROM products WHERE name IS NULL OR TRIM(name) = ''")
    bad_names = cursor.fetchall()
    assert not bad_names, f"Products with NULL or empty name: {[row[0] for row in bad_names]}"
    # Check for NULL project_id
    cursor.execute("SELECT id FROM products WHERE project_id IS NULL")
    bad_proj = cursor.fetchall()
    assert not bad_proj, f"Products with NULL project_id: {[row[0] for row in bad_proj]}"
    # Check for orphaned plan_id (parent does not exist)
    cursor.execute("SELECT p1.id FROM products p1 LEFT JOIN products p2 ON p1.plan_id = p2.id WHERE p1.plan_id IS NOT NULL AND p2.id IS NULL")
    orphans = cursor.fetchall()
    assert not orphans, f"Products with orphaned plan_id: {[row[0] for row in orphans]}"
    # Check for NULL sort_order
    cursor.execute("SELECT id FROM products WHERE sort_order IS NULL")
    null_sort = cursor.fetchall()
    assert not null_sort, f"Products with NULL sort_order: {[row[0] for row in null_sort]}"
    # Check for duplicate sort_order within each project
    cursor.execute("SELECT project_id, sort_order, COUNT(*) FROM products GROUP BY project_id, sort_order HAVING COUNT(*) > 1")
    dup_sort = cursor.fetchall()
    assert not dup_sort, f"Duplicate sort_order values found: {dup_sort}"
    # Check for invalid sort_order (<1)
    cursor.execute("SELECT id, sort_order FROM products WHERE sort_order < 1")
    bad_sort = cursor.fetchall()
    assert not bad_sort, f"Products with invalid sort_order (<1): {[row[0] for row in bad_sort]}"
    conn.close()
