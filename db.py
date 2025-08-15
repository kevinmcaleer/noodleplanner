import sqlite3
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
        conn.commit()

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
