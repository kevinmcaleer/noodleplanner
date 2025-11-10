# Database Migrations

This directory contains SQL files for database schema changes. All migrations are managed using Alembic.

## Migration Process

### 1. Create Migration SQL File

When making database changes, first create a SQL file in this directory:

```bash
design/migrations/XXX_description.sql
```

Where:
- `XXX` is the migration number (e.g., 001, 002, 003)
- `description` is a brief description of the change

### 2. Create Alembic Migration

Create corresponding Alembic migration file:

```python
# alembic/versions/XXX_description.py
"""Description

Revision ID: XXX
Revises: <previous_revision>
Create Date: YYYY-MM-DD

"""
from alembic import op
from pathlib import Path

revision = 'XXX'
down_revision = '<previous_revision>'

def upgrade() -> None:
    sql_file = Path(__file__).parent.parent.parent / "design" / "migrations" / "XXX_description.sql"
    with open(sql_file, 'r') as f:
        sql = f.read()
        op.execute(sql)

def downgrade() -> None:
    # Implement rollback logic
    pass
```

### 3. Update database.dbml

After creating migration, update `design/database.dbml` to reflect the schema changes.

### 4. Run Migration

```bash
# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# View migration history
alembic history

# Check current version
alembic current
```

## Existing Migrations

### 001_create_activity_logs.sql
- **Date**: 2025-11-10
- **Description**: Creates activity_logs table for user activity tracking
- **Tables Created**:
  - `activity_logs` - Stores timestamp, IP, user agent, endpoint, method, status code, response time
- **Indexes Created**:
  - `idx_activity_logs_timestamp` - For time-based queries
  - `idx_activity_logs_activity_type` - For filtering by activity type
  - `idx_activity_logs_endpoint` - For endpoint analysis
  - `idx_activity_logs_ip_address` - For IP-based queries

## Migration Best Practices

1. **SQL Files First**: Always create SQL file before Alembic migration
2. **Descriptive Names**: Use clear, descriptive names for migrations
3. **Sequential Numbering**: Use 001, 002, 003... for easy ordering
4. **Test Rollbacks**: Always implement and test downgrade() functions
5. **Update DBML**: Keep database.dbml in sync with schema
6. **Comments**: Add comments to SQL explaining the changes
7. **Transactions**: Migrations should be atomic (all or nothing)
8. **Backward Compatibility**: Consider existing data when altering tables

## Troubleshooting

### Migration Failed
```bash
# Check current state
alembic current

# View pending migrations
alembic heads

# Manually mark migration as complete (use with caution)
alembic stamp head
```

### Multiple Heads
If you have multiple migration branches:
```bash
# View all heads
alembic heads

# Merge branches
alembic merge -m "merge description" head1 head2
```

## Database Connection

Migrations connect to the database specified in the `DATABASE_URL` environment variable:

```
DATABASE_URL=postgresql://user:password@192.168.2.1:5433/noodleplanner
```

This is configured in `alembic/env.py` which reads from `.env` file.
