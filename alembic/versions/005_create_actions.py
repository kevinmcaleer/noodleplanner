"""Create actions table

Revision ID: 005
Revises: 001
Create Date: 2026-02-23

"""
from alembic import op
import sqlalchemy as sa
from pathlib import Path

# revision identifiers, used by Alembic.
revision = '005'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Upgrade database schema by creating actions table.
    SQL is stored in design/migrations/005_create_actions.sql
    """
    # Read SQL from file as per claude.md standards
    sql_file = Path(__file__).parent.parent.parent / "design" / "migrations" / "005_create_actions.sql"

    if sql_file.exists():
        with open(sql_file, 'r') as f:
            sql = f.read()
            # Execute the SQL
            op.execute(sql)
    else:
        # Fallback to inline creation if SQL file not found
        op.create_table(
            'actions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=500), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('owner', sa.String(length=200), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='open'),
            sa.Column('priority', sa.String(length=20), nullable=False, server_default='medium'),
            sa.Column('target_date', sa.Date(), nullable=True),
            sa.Column('resource', sa.String(length=200), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('(NOW() AT TIME ZONE \'UTC\')')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('(NOW() AT TIME ZONE \'UTC\')')),
            sa.PrimaryKeyConstraint('id'),
            sa.CheckConstraint("status IN ('open', 'closed')", name='actions_status_check'),
            sa.CheckConstraint("priority IN ('low', 'medium', 'high')", name='actions_priority_check')
        )

        # Create indexes
        op.create_index('idx_actions_status', 'actions', ['status'])
        op.create_index('idx_actions_priority', 'actions', ['priority'])
        op.create_index('idx_actions_owner', 'actions', ['owner'])
        op.create_index('idx_actions_resource', 'actions', ['resource'])
        op.create_index('idx_actions_target_date', 'actions', ['target_date'])
        op.create_index('idx_actions_created_at', 'actions', ['created_at'])


def downgrade() -> None:
    """
    Downgrade database schema by dropping actions table and its indexes.
    """
    op.drop_index('idx_actions_created_at', table_name='actions')
    op.drop_index('idx_actions_target_date', table_name='actions')
    op.drop_index('idx_actions_resource', table_name='actions')
    op.drop_index('idx_actions_owner', table_name='actions')
    op.drop_index('idx_actions_priority', table_name='actions')
    op.drop_index('idx_actions_status', table_name='actions')
    op.drop_table('actions')
