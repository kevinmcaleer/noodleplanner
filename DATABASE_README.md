# Activity Logging Database Setup

Noodle Planner automatically logs user activity to a PostgreSQL database, capturing:
- Timestamp of each request
- IP address (respecting X-Forwarded-For headers)
- User agent (browser information)
- Activity type (render_plan, export_excel, etc.)
- Endpoint accessed
- HTTP method
- Response status code
- Response time in milliseconds

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and customize the values:

```bash
cp .env.example .env
```

Key variables:
- `DATABASE_URL`: PostgreSQL connection string
- `POSTGRES_USER`: Database username
- `POSTGRES_PASSWORD`: Database password
- `POSTGRES_DB`: Database name
- `ENABLE_ACTIVITY_LOGGING`: Enable/disable logging (true/false)

### Docker Compose Setup

The docker-compose.yml includes:
1. **postgres**: PostgreSQL 15 database with persistent storage
2. **noodleplanner**: The application with automatic database initialization

Start everything with:
```bash
docker-compose up -d
```

The application will:
1. Wait for PostgreSQL to be healthy
2. Test database connection on startup
3. Automatically create the `activity_logs` table
4. Begin logging all requests

## Database Schema

### activity_logs Table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | DATETIME | When the request occurred (UTC) |
| ip_address | VARCHAR(45) | Client IP address |
| user_agent | VARCHAR(500) | Browser/client user agent |
| activity_type | VARCHAR(100) | Type of activity (indexed) |
| endpoint | VARCHAR(200) | URL path accessed |
| method | VARCHAR(10) | HTTP method (GET, POST, etc.) |
| status_code | INTEGER | HTTP response status |
| response_time_ms | INTEGER | Response time in milliseconds |

## Activity Types

The system automatically categorizes activities:
- `health_check`: Health endpoint checks
- `render_plan`: Plan rendering requests
- `analyze_plan`: Plan analysis requests
- `export_excel`: Excel export
- `export_powerpoint`: PowerPoint export
- `convert_format`: Format conversion
- `file_upload`: File uploads (POST)
- `page_view`: Page views (GET)

## Querying Activity Logs

### Connect to database:
```bash
docker exec -it noodleplanner-db psql -U noodleuser -d noodledb
```

### Useful queries:

**Most active endpoints:**
```sql
SELECT endpoint, COUNT(*) as requests,
       AVG(response_time_ms) as avg_response_time
FROM activity_logs
GROUP BY endpoint
ORDER BY requests DESC
LIMIT 10;
```

**Activity by type:**
```sql
SELECT activity_type, COUNT(*) as count
FROM activity_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY activity_type
ORDER BY count DESC;
```

**Slowest requests:**
```sql
SELECT timestamp, endpoint, method, response_time_ms, ip_address
FROM activity_logs
WHERE response_time_ms > 1000
ORDER BY response_time_ms DESC
LIMIT 20;
```

**Unique visitors today:**
```sql
SELECT COUNT(DISTINCT ip_address) as unique_visitors
FROM activity_logs
WHERE timestamp::date = CURRENT_DATE;
```

**Requests per hour:**
```sql
SELECT DATE_TRUNC('hour', timestamp) as hour,
       COUNT(*) as requests
FROM activity_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

## Disabling Activity Logging

Set in your `.env` file:
```
ENABLE_ACTIVITY_LOGGING=false
```

Then restart the container:
```bash
docker-compose restart noodleplanner
```

## Data Persistence

Activity logs are stored in a Docker volume `postgres_data` which persists across container restarts.

To backup the database:
```bash
docker exec noodleplanner-db pg_dump -U noodleuser noodledb > backup.sql
```

To restore:
```bash
cat backup.sql | docker exec -i noodleplanner-db psql -U noodleuser -d noodledb
```

## Production Considerations

For production deployments:
1. Use strong passwords in `.env`
2. Restrict database port (5432) access
3. Consider adding database indexes for common queries
4. Set up regular backups
5. Monitor database size and implement log rotation
6. Use SSL/TLS for database connections
7. Consider using a managed PostgreSQL service
