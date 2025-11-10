# Noodle Planner - Deployment Guide

## Prerequisites

1. PostgreSQL database running on 192.168.2.1:5433
2. Database named `noodleplanner` must exist
3. Docker and Docker Compose installed
4. `.env` file configured with database credentials

## Initial Setup

### 1. Create .env File

Copy the example and update with your credentials:

```bash
cp .env.example .env
# Edit .env with your actual database credentials
```

### 2. Ensure Database Exists

Connect to your PostgreSQL server and create the database if it doesn't exist:

```bash
psql -h 192.168.2.1 -p 5433 -U postgres
CREATE DATABASE noodleplanner;
\q
```

### 3. Build Docker Image

```bash
docker-compose build
```

### 4. Run Database Migrations

Apply the initial migration to create the activity_logs table:

```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic upgrade head
```

### 5. Start the Application

```bash
docker-compose up -d
```

### 6. Verify Deployment

Check logs:
```bash
docker-compose logs -f noodleplanner
```

You should see:
- "Database connection successful"
- "Note: Database schema is managed via Alembic migrations"

Access the application at: http://localhost:8007

## Updating the Application

### Standard Update (No Database Changes)

```bash
git pull
docker-compose up -d --build
```

### Update with Database Migrations

1. Pull latest changes:
```bash
git pull
```

2. Check for new migrations:
```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic current
```

3. Apply migrations:
```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic upgrade head
```

4. Restart application:
```bash
docker-compose up -d --build
```

## Database Migrations

### View Migration History

```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic history
```

### Rollback Last Migration

```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic downgrade -1
```

### Creating New Migrations

1. Create SQL file in `design/migrations/`:
```bash
vim design/migrations/002_add_users_table.sql
```

2. Create Alembic migration:
```bash
vim alembic/versions/002_add_users_table.py
```

3. Update schema documentation:
```bash
vim design/database.dbml
```

4. Test migration:
```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic upgrade head
```

## Monitoring

### View Activity Logs

Connect to database:
```bash
psql -h 192.168.2.1 -p 5433 -U noodleuser -d noodleplanner
```

Query recent activity:
```sql
SELECT timestamp, ip_address, activity_type, endpoint, status_code, response_time_ms
FROM activity_logs
ORDER BY timestamp DESC
LIMIT 20;
```

### Application Logs

```bash
docker-compose logs -f noodleplanner
```

## Troubleshooting

### Database Connection Failed

1. Check database is accessible:
```bash
psql -h 192.168.2.1 -p 5433 -U noodleuser -d noodleplanner
```

2. Verify `.env` file has correct credentials

3. Check Docker can reach database:
```bash
docker run --rm --network host postgres:15-alpine \
  psql -h 192.168.2.1 -p 5433 -U noodleuser -d noodleplanner
```

### Migration Failed

1. Check current migration state:
```bash
docker run --rm --env-file .env -v $(pwd):/app -w /app \
  noodleplanner-noodleplanner alembic current
```

2. View migration history:
```bash
docker run --rm --env-file .env -v $(pwd):/app -w /app \
  noodleplanner-noodleplanner alembic history
```

3. If stuck, manually mark migration as complete (use with caution):
```bash
docker run --rm --env-file .env -v $(pwd):/app -w /app \
  noodleplanner-noodleplanner alembic stamp head
```

### Application Won't Start

1. Check Docker logs:
```bash
docker-compose logs noodleplanner
```

2. Verify all dependencies are installed:
```bash
docker-compose build --no-cache
```

3. Check .env file exists and is valid

## Backup and Restore

### Backup Database

```bash
pg_dump -h 192.168.2.1 -p 5433 -U noodleuser noodleplanner > noodleplanner_backup.sql
```

### Restore Database

```bash
psql -h 192.168.2.1 -p 5433 -U noodleuser noodleplanner < noodleplanner_backup.sql
```

## Security Considerations

1. **Credentials**: Never commit `.env` file to git
2. **Database Access**: Restrict PostgreSQL access to trusted IPs
3. **Network**: Consider using VPN for database connections
4. **Logging**: Activity logs contain IP addresses - comply with privacy regulations
5. **Updates**: Regularly update Docker base images and Python dependencies

## Performance Tuning

1. **Database Indexes**: Already created for common queries (timestamp, activity_type, endpoint, ip_address)
2. **Connection Pooling**: Configured in database.py
3. **Log Rotation**: Consider archiving old activity logs periodically:

```sql
-- Archive logs older than 90 days
CREATE TABLE activity_logs_archive AS
SELECT * FROM activity_logs WHERE timestamp < NOW() - INTERVAL '90 days';

DELETE FROM activity_logs WHERE timestamp < NOW() - INTERVAL '90 days';
```

## Support

For issues or questions:
- Check logs: `docker-compose logs`
- Review DATABASE_README.md for activity logging details
- Check design/migrations/README.md for migration help
