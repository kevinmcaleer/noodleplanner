#!/usr/bin/env python3
"""
Create the noodleplanner database if it doesn't exist.
This script connects to PostgreSQL using credentials from environment variables.
"""
import logging
import os
import sys
import time
from urllib.parse import urlparse, unquote
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

MAX_RETRIES = int(os.getenv("DB_MAX_RETRIES", "3"))
BASE_RETRY_DELAY = float(os.getenv("DB_RETRY_DELAY", "1.0"))

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

def connect_with_retry(db_config, database='postgres'):
    """Connect to PostgreSQL with exponential backoff retry logic."""
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            conn = psycopg2.connect(
                host=db_config['host'],
                port=db_config['port'],
                user=db_config['user'],
                password=db_config['password'],
                database=database,
            )
            return conn
        except psycopg2.OperationalError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = BASE_RETRY_DELAY * (2 ** (attempt - 1))
                logger.warning(
                    "Connection attempt %d/%d failed, retrying in %.1fs: %s",
                    attempt, MAX_RETRIES, delay, e,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "Connection failed after %d attempts: %s", MAX_RETRIES, e,
                )
                raise last_error


def create_database():
    """Create the noodleplanner database if it doesn't exist."""
    database_url = os.getenv('DATABASE_URL')

    if not database_url:
        logger.error("DATABASE_URL environment variable not set")
        sys.exit(1)

    # Parse the database URL
    db_config = parse_database_url(database_url)
    target_database = db_config['database']

    if not target_database:
        logger.error("No database name found in DATABASE_URL")
        sys.exit(1)

    logger.info("Connecting to PostgreSQL at %s:%s", db_config['host'], db_config['port'])
    logger.info("Target database: %s", target_database)

    # Connect to the 'postgres' database to create our target database
    conn = None
    try:
        # Connect to the default 'postgres' database with retry
        conn = connect_with_retry(db_config, database='postgres')

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
            logger.info("Database '%s' already exists", target_database)
        else:
            # Create the database
            logger.info("Creating database '%s'...", target_database)
            cursor.execute(f'CREATE DATABASE {target_database}')
            logger.info("Database '%s' created successfully", target_database)

        cursor.close()

        # Now connect to the new database to verify
        conn.close()
        conn = connect_with_retry(db_config, database=target_database)

        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        logger.info("Successfully connected to '%s'", target_database)
        logger.info("PostgreSQL version: %s", version.split(',')[0])
        cursor.close()

        return True

    except psycopg2.OperationalError as e:
        logger.error("Connection error: %s", e)
        logger.error(
            "Please check: 1) PostgreSQL server is running, "
            "2) Host %s:%s is accessible, "
            "3) User '%s' has permission to create databases, "
            "4) Credentials in .env file are correct",
            db_config['host'], db_config['port'], db_config['user'],
        )
        return False

    except psycopg2.Error as e:
        logger.error("Database error: %s", e)
        return False

    except (OSError, RuntimeError) as e:
        logger.error("Unexpected error: %s", e)
        return False

    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    logger.info("=" * 70)
    logger.info("Noodle Planner - Database Creation Script")
    logger.info("=" * 70)

    success = create_database()

    if success:
        logger.info("Database setup complete!")
        logger.info("Next steps:")
        logger.info("  1. Run migrations: alembic upgrade head")
        logger.info("  2. Start application: docker-compose up -d")
        sys.exit(0)
    else:
        logger.error("Database setup failed")
        sys.exit(1)
