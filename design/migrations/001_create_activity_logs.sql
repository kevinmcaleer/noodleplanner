-- Migration: Create activity_logs table
-- Date: 2025-11-10
-- Description: Initial table for logging user activity including timestamp, IP, user agent, and request details

CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    activity_type VARCHAR(100) NOT NULL,
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_type ON activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_endpoint ON activity_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_activity_logs_ip_address ON activity_logs(ip_address);

-- Add comment to table
COMMENT ON TABLE activity_logs IS 'Stores user activity logs for audit and analytics purposes';
COMMENT ON COLUMN activity_logs.timestamp IS 'UTC timestamp when the request occurred';
COMMENT ON COLUMN activity_logs.ip_address IS 'Client IP address, respecting X-Forwarded-For headers';
COMMENT ON COLUMN activity_logs.user_agent IS 'Browser or client user agent string';
COMMENT ON COLUMN activity_logs.activity_type IS 'Type of activity (render_plan, export_excel, etc.)';
COMMENT ON COLUMN activity_logs.endpoint IS 'URL path accessed';
COMMENT ON COLUMN activity_logs.method IS 'HTTP method (GET, POST, etc.)';
COMMENT ON COLUMN activity_logs.status_code IS 'HTTP response status code';
COMMENT ON COLUMN activity_logs.response_time_ms IS 'Response time in milliseconds';
