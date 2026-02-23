-- Create actions table for tracking action items in projects
-- Part of the RAID log tracking system

CREATE TABLE IF NOT EXISTS actions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    owner VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    target_date DATE,
    resource VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Create indexes for better query performance
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_priority ON actions(priority);
CREATE INDEX idx_actions_owner ON actions(owner);
CREATE INDEX idx_actions_resource ON actions(resource);
CREATE INDEX idx_actions_target_date ON actions(target_date);
CREATE INDEX idx_actions_created_at ON actions(created_at);

-- Add comment describing the table
COMMENT ON TABLE actions IS 'Tracks action items for resources in the RAID log';
COMMENT ON COLUMN actions.id IS 'Unique identifier for each action';
COMMENT ON COLUMN actions.title IS 'Brief title of the action';
COMMENT ON COLUMN actions.description IS 'Detailed description of the action';
COMMENT ON COLUMN actions.owner IS 'Person responsible for the action';
COMMENT ON COLUMN actions.status IS 'Current status: open or closed';
COMMENT ON COLUMN actions.priority IS 'Priority level: low, medium, or high';
COMMENT ON COLUMN actions.target_date IS 'Target completion date';
COMMENT ON COLUMN actions.resource IS 'Associated resource or project area';
COMMENT ON COLUMN actions.created_at IS 'Timestamp when the action was created';
COMMENT ON COLUMN actions.updated_at IS 'Timestamp when the action was last updated';
