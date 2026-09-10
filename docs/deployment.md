# Noodle Planner - Deployment Guide

## Prerequisites

1. PostgreSQL database running on 192.168.2.1:5433
2. Database named `noodleplanner` must exist
3. Docker and Docker Compose installed
4. `.env` file configured with database credentials
5. `cloudflared/credentials.json` present, if you are serving the site through
   the Cloudflare tunnel (see [Provide Cloudflare Tunnel Credentials](#2-provide-cloudflare-tunnel-credentials))

## Initial Setup

### 1. Create .env File

Copy the example and update with your credentials:

```bash
cp .env.example .env
# Edit .env with your actual database credentials
```

### 2. Provide Cloudflare Tunnel Credentials

The `tunnel` service in `docker-compose.yml` runs the site on public hostnames
(`noodleplanner.com` and `docs.noodleplanner.com`). Its routing rules live in
`cloudflared/config.yml`, which **is** committed to git — but the matching
secret, `cloudflared/credentials.json`, is deliberately gitignored and is
therefore **not** included in a fresh clone.

This is the single most common reason a new node comes up with the app running
but the public site unreachable: the `tunnel` container starts, fails to
authenticate, and restarts in a loop.

Copy the file from a node that already works:

```bash
scp <working-host>:~/noodleplanner/cloudflared/credentials.json cloudflared/
chmod 600 cloudflared/credentials.json
```

The directory should then contain both files:

```
cloudflared/
├── config.yml          # in git — tunnel ID and ingress rules
└── credentials.json    # gitignored — copy manually, never commit
```

> **Note on running more than one node.** `cloudflared` allows several replicas
> to share one tunnel ID, so a second node using this same `credentials.json`
> will **load-balance** live noodleplanner.com traffic rather than sit idle. Do
> this only for intentional high availability. For a standby, staging or
> development node, create a separate tunnel in the Cloudflare dashboard and
> give that node its own tunnel ID, hostname and credentials file.

To skip the tunnel entirely on a node that only needs local access, start just
the app:

```bash
docker-compose up -d noodleplanner docs
```

### 3. Ensure Database Exists

Connect to your PostgreSQL server and create the database if it doesn't exist:

```bash
psql -h 192.168.2.1 -p 5433 -U postgres
CREATE DATABASE noodleplanner;
\q
```

### 4. Build Docker Image

```bash
docker-compose build
```

### 5. Run Database Migrations

Apply the initial migration to create the activity_logs table:

```bash
docker run --rm \
  --env-file .env \
  -v $(pwd):/app \
  -w /app \
  noodleplanner-noodleplanner \
  alembic upgrade head
```

### 6. Start the Application

```bash
docker-compose up -d
```

### 7. Verify Deployment

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

### Tunnel Won't Connect / Site Unreachable

Symptom: `docker-compose ps` shows `noodleplanner` healthy and the app responds
on `http://localhost:8007`, but the public hostname does not resolve or returns
an error.

1. Check the tunnel logs:
```bash
docker-compose logs tunnel
```

An error mentioning credentials, authentication, or a missing
`/etc/cloudflared/credentials.json` means the secret was never copied to this
node — see
[Provide Cloudflare Tunnel Credentials](#2-provide-cloudflare-tunnel-credentials).

2. Confirm the file exists and is readable:
```bash
ls -l cloudflared/credentials.json
```

3. Confirm the container can see it — `config.yml` and `credentials.json` should
   both be listed:
```bash
docker-compose exec tunnel ls -l /etc/cloudflared
```

4. Check that the tunnel ID in `cloudflared/config.yml` matches the `TunnelID`
   in `cloudflared/credentials.json`. A mismatch authenticates against the wrong
   tunnel and routes no traffic.

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

1. **Credentials**: Never commit `.env` or `cloudflared/credentials.json` to git.
   Both are listed in `.gitignore`; `credentials.json` holds the tunnel secret and
   grants the ability to serve traffic on the production hostnames.
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
