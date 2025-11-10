#!/usr/bin/env python3
"""
Create the noodleplanner database if it doesn't exist.
This script connects to PostgreSQL using credentials from environment variables.
"""
import os
import sys
from urllib.parse import urlparse, unquote
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def parse_database_url(url):
    """Parse DATABASE_URL into components, properly decoding percent-encoded values"""
    parsed = urlparse(url)
    return {
        'host': parsed.hostname,
        'port': parsed.port or 5432,
        'user': unquote(parsed.username) if parsed.username else None,
        'password': unquote(parsed.password) if parsed.password else None,
        'database': parsed.path[1:] if parsed.path else None  # Remove leading '/'
    }

def create_database():
    """Create the noodleplanner database if it doesn't exist"""
    database_url = os.getenv('DATABASE_URL')

    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    # Parse the database URL
    db_config = parse_database_url(database_url)
    target_database = db_config['database']

    if not target_database:
        print("ERROR: No database name found in DATABASE_URL")
        sys.exit(1)

    print(f"Connecting to PostgreSQL at {db_config['host']}:{db_config['port']}")
    print(f"Target database: {target_database}")

    # Connect to the 'postgres' database to create our target database
    conn = None
    try:
        # Connect to the default 'postgres' database
        conn = psycopg2.connect(
            host=db_config['host'],
            port=db_config['port'],
            user=db_config['user'],
            password=db_config['password'],
            database='postgres'  # Connect to default database
        )

        # Set isolation level to AUTOCOMMIT to allow CREATE DATABASE
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)

        cursor = conn.cursor()

        # Check if database exists
        cursor.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (target_database,)
        )

        exists = cursor.fetchone()

        if exists:
            print(f"✓ Database '{target_database}' already exists")
        else:
            # Create the database
            print(f"Creating database '{target_database}'...")
            cursor.execute(f'CREATE DATABASE {target_database}')
            print(f"✓ Database '{target_database}' created successfully")

        cursor.close()

        # Now connect to the new database to verify
        conn.close()
        conn = psycopg2.connect(
            host=db_config['host'],
            port=db_config['port'],
            user=db_config['user'],
            password=db_config['password'],
            database=target_database
        )

        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"✓ Successfully connected to '{target_database}'")
        print(f"  PostgreSQL version: {version.split(',')[0]}")
        cursor.close()

        return True

    except psycopg2.OperationalError as e:
        print(f"✗ Connection error: {e}")
        print("\nPlease check:")
        print("  1. PostgreSQL server is running")
        print(f"  2. Host {db_config['host']}:{db_config['port']} is accessible")
        print(f"  3. User '{db_config['user']}' has permission to create databases")
        print("  4. Credentials in .env file are correct")
        return False

    except psycopg2.Error as e:
        print(f"✗ Database error: {e}")
        return False

    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        return False

    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 70)
    print("Noodle Planner - Database Creation Script")
    print("=" * 70)

    success = create_database()

    if success:
        print("\n" + "=" * 70)
        print("✓ Database setup complete!")
        print("=" * 70)
        print("\nNext steps:")
        print("  1. Run migrations: docker run --rm --env-file .env -v $(pwd):/app -w /app \\")
        print("                     noodleplanner-noodleplanner alembic upgrade head")
        print("  2. Start application: docker-compose up -d")
        sys.exit(0)
    else:
        print("\n" + "=" * 70)
        print("✗ Database setup failed")
        print("=" * 70)
        sys.exit(1)
