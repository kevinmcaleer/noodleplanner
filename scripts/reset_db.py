import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db import create_tables, DATABASE_URL

def reset_database():
    if os.path.exists(DATABASE_URL):
        os.remove(DATABASE_URL)
    create_tables()

if __name__ == "__main__":
    reset_database()
    print("Database reset and tables recreated.")
