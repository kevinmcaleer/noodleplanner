"""Create activity_logs table

Revision ID: 001
Revises:
Create Date: 2025-11-10

"""
from alembic import op
import sqlalchemy as sa
from pathlib import Path

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Upgrade database schema by creating activity_logs table.
    SQL is stored in design/migrations/001_create_activity_logs.sql
    """
    # Read SQL from file as per claude.md standards
    sql_file = Path(__file__).parent.parent.parent / "design" / "migrations" / "001_create_activity_logs.sql"

    if sql_file.exists():
        with open(sql_file, 'r') as f:
            sql = f.read()
            # Execute the SQL
            op.execute(sql)
    else:
        # Fallback to inline creation if SQL file not found
        op.create_table(
            'activity_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('timestamp', sa.DateTime(), nullable=False, server_default=sa.text('(NOW() AT TIME ZONE \'UTC\')')),
            sa.Column('ip_address', sa.String(length=45), nullable=True),
            sa.Column('user_agent', sa.String(length=500), nullable=True),
            sa.Column('activity_type', sa.String(length=100), nullable=False),
            sa.Column('endpoint', sa.String(length=200), nullable=False),
            sa.Column('method', sa.String(length=10), nullable=False),
            sa.Column('status_code', sa.Integer(), nullable=True),
            sa.Column('response_time_ms', sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )

        # Create indexes
        op.create_index('idx_activity_logs_timestamp', 'activity_logs', ['timestamp'])
        op.create_index('idx_activity_logs_activity_type', 'activity_logs', ['activity_type'])
        op.create_index('idx_activity_logs_endpoint', 'activity_logs', ['endpoint'])
        op.create_index('idx_activity_logs_ip_address', 'activity_logs', ['ip_address'])


def downgrade() -> None:
    """
    Downgrade database schema by dropping activity_logs table and its indexes.
    """
    op.drop_index('idx_activity_logs_ip_address', table_name='activity_logs')
    op.drop_index('idx_activity_logs_endpoint', table_name='activity_logs')
    op.drop_index('idx_activity_logs_activity_type', table_name='activity_logs')
    op.drop_index('idx_activity_logs_timestamp', table_name='activity_logs')
    op.drop_table('activity_logs')
