import sqlite3
import os
from typing import Optional
from contextlib import contextmanager
import bcrypt

# Use absolute path so app restarts from different working directories still use the same DB file.
# Allow override via NOODLEPLANNER_DB for testing persistence behaviors.
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_DB = os.path.join(_BASE_DIR, "test.db")
DATABASE_URL = os.environ.get("NOODLEPLANNER_DB", _DEFAULT_DB)

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE_URL)
    try:
        yield conn
    finally:
        conn.close()

def create_tables():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            full_name TEXT,
            hashed_password TEXT NOT NULL,
            disabled BOOLEAN DEFAULT 0
        )''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner INTEGER NOT NULL,
            tenant_id INTEGER
        )''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            plan_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            description TEXT,
            dependencies TEXT,
            resources TEXT,
            skills TEXT,
            derived_from TEXT,
            composed_of TEXT,
            acceptance_criteria TEXT,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS dependencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_product_id INTEGER NOT NULL,
            to_product_id INTEGER NOT NULL,
            -- Optionally: type TEXT, notes TEXT
            FOREIGN KEY(from_product_id) REFERENCES products(id),
            FOREIGN KEY(to_product_id) REFERENCES products(id)
        )''')
        conn.commit()
# Dependency CRUD
def add_dependency(from_product_id: int, to_product_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''INSERT INTO dependencies (from_product_id, to_product_id) VALUES (?, ?)''', (from_product_id, to_product_id))
        conn.commit()

def remove_dependency(dep_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM dependencies WHERE id = ?', (dep_id,))
        conn.commit()

def get_dependencies_for_project(project_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT d.id, d.from_product_id, d.to_product_id
            FROM dependencies d
            JOIN products p1 ON d.from_product_id = p1.id
            JOIN products p2 ON d.to_product_id = p2.id
            WHERE p1.project_id = ? AND p2.project_id = ?
        ''', (project_id, project_id))
        return [
            {"id": row[0], "from_product_id": row[1], "to_product_id": row[2]} for row in cursor.fetchall()
        ]

def get_all_dependencies():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, from_product_id, to_product_id FROM dependencies')
        return [
            {"id": row[0], "from_product_id": row[1], "to_product_id": row[2]} for row in cursor.fetchall()
        ]

# Get project details and all products for a project
def get_project_with_products(project_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name FROM projects WHERE id = ?', (project_id,))
        project_row = cursor.fetchone()
        if not project_row:
            return None
        cursor.execute('''SELECT id, name, plan_id, sort_order, description, dependencies, resources, skills, derived_from, composed_of, acceptance_criteria
                          FROM products WHERE project_id = ? ORDER BY sort_order ASC, id ASC''', (project_id,))
        products = [
            {
                "id": row[0],
                "name": row[1],
                "plan_id": row[2],
                "sort_order": row[3],
                "description": row[4] or "",
                "dependencies": row[5] or "",
                "resources": row[6] or "",
                "skills": row[7] or "",
                "derived_from": row[8] or "",
                "composed_of": row[9] or "",
                "acceptance_criteria": row[10] or ""
            } for row in cursor.fetchall()
        ]
        return {"id": project_row[0], "name": project_row[1], "products": products}

# Add a new product to a project
def add_product_to_project(project_id: int, product_name: str, plan_id: Optional[int] = None):
    with get_db() as conn:
        cursor = conn.cursor()
        # Find max sort_order for this project
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) FROM products WHERE project_id = ?', (project_id,))
        max_order = cursor.fetchone()[0] or 0
        cursor.execute('''INSERT INTO products (name, project_id, plan_id, sort_order, description, dependencies, resources, skills, derived_from, composed_of, acceptance_criteria)
                          VALUES (?, ?, ?, ?, '', '', '', '', '', '', '')''',
                       (product_name, project_id, plan_id, max_order + 1))
        conn.commit()
def get_projects_by_username(username: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT p.id, p.name
            FROM projects p
            JOIN users u ON p.owner = u.id
            WHERE u.username = ?
        ''', (username,))
        rows = cursor.fetchall()
        return [{"id": row[0], "name": row[1]} for row in rows]

def add_test_user():
    """Add test user 'alice' with password 'secret' for testing purposes."""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            # Hash the test password using bcrypt
            password = "secret"
            password_bytes = password.encode('utf-8')
            salt = bcrypt.gensalt()
            hashed = bcrypt.hashpw(password_bytes, salt)
            hashed_password = hashed.decode('utf-8')

            cursor.execute('''INSERT INTO users (username, full_name, hashed_password, disabled) VALUES (?, ?, ?, ?)''',
                ("alice", "Alice Wonderland", hashed_password, 0))
            conn.commit()
        except sqlite3.IntegrityError:
            pass  # User already exists

def get_user_by_username(username: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT username, full_name, hashed_password, disabled FROM users WHERE username = ?', (username,))
        row = cursor.fetchone()
        if row:
            return {
                "username": row[0],
                "full_name": row[1],
                "hashed_password": row[2],
                "disabled": bool(row[3])
            }
        return None
