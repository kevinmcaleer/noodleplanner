import sqlite3

from typing import Optional
from contextlib import contextmanager

DATABASE_URL = "test.db"

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
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )''')
        conn.commit()

# Get project details and all products for a project
def get_project_with_products(project_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name FROM projects WHERE id = ?', (project_id,))
        project_row = cursor.fetchone()
        if not project_row:
            return None
        cursor.execute('SELECT id, name, plan_id FROM products WHERE project_id = ?', (project_id,))
        products = [
            {"id": row[0], "name": row[1], "plan_id": row[2]} for row in cursor.fetchall()
        ]
        return {"id": project_row[0], "name": project_row[1], "products": products}

# Add a new product to a project
def add_product_to_project(project_id: int, product_name: str, plan_id: Optional[int] = None):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, project_id, plan_id) VALUES (?, ?, ?)', (product_name, project_id, plan_id))
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
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''INSERT INTO users (username, full_name, hashed_password, disabled) VALUES (?, ?, ?, ?)''',
                ("alice", "Alice Wonderland", "fakehashedsecret", 0))
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
