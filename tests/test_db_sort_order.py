
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

def test_products_have_valid_sort_order():
    conn = sqlite3.connect(DATABASE_URL)
    cursor = conn.cursor()
    # Check for NULL sort_order
    cursor.execute("SELECT id FROM products WHERE sort_order IS NULL")
    null_rows = cursor.fetchall()
    assert not null_rows, f"Products with NULL sort_order: {[row[0] for row in null_rows]}"
    # Check for duplicate sort_order within each project
    cursor.execute("SELECT project_id, sort_order, COUNT(*) FROM products GROUP BY project_id, sort_order HAVING COUNT(*) > 1")
    dup_rows = cursor.fetchall()
    assert not dup_rows, f"Duplicate sort_order values found: {dup_rows}"
    # Check for missing sort_order (should be sequential, but not strictly required)
    cursor.execute("SELECT id, sort_order FROM products WHERE sort_order < 1")
    bad_rows = cursor.fetchall()
    assert not bad_rows, f"Products with invalid sort_order (<1): {[row[0] for row in bad_rows]}"
    conn.close()
