# Supabase on Raspberry Pi 4-Node Cluster: Implementation Plan

## Architecture Overview

```
                        ┌─────────────────────────────┐
                        │      Load Balancer (VIP)     │
                        │   keepalived / HAProxy on    │
                        │     each node (VRRP)         │
                        └──────────┬──────────────────┘
                                   │
         ┌─────────────┬───────────┼───────────┬─────────────┐
         │             │           │           │             │
    ┌────▼────┐   ┌────▼────┐ ┌───▼─────┐ ┌──▼──────┐
    │  Pi #1  │   │  Pi #2  │ │  Pi #3  │ │  Pi #4  │
    │         │   │         │ │         │ │         │
    │ Swarm   │   │ Swarm   │ │ Swarm   │ │ Swarm   │
    │ Manager │   │ Manager │ │ Manager │ │ Worker  │
    │         │   │         │ │         │ │         │
    │ Patroni │   │ Patroni │ │ Patroni │ │ Patroni │
    │ (PG     │   │ (PG     │ │ (PG     │ │ (PG     │
    │ primary │   │ replica)│ │ replica)│ │ replica)│
    │ or      │   │         │ │         │ │         │
    │ replica)│   │         │ │         │ │         │
    │         │   │         │ │         │ │         │
    │ etcd    │   │ etcd    │ │ etcd    │ │         │
    │         │   │         │ │         │ │         │
    │ Supa-   │   │ Supa-   │ │ Supa-   │ │ Supa-   │
    │ base    │   │ base    │ │ base    │ │ base    │
    │ services│   │ services│ │ services│ │ services│
    │         │   │         │ │         │ │         │
    │ Noodle  │   │ Noodle  │ │ Noodle  │ │ Noodle  │
    │ Planner │   │ Planner │ │ Planner │ │ Planner │
    └─────────┘   └─────────┘ └─────────┘ └─────────┘
```

**Key decisions:**
- **Docker Swarm** (not Kubernetes/K3s) for minimal setup complexity
- **Patroni + etcd** for PostgreSQL automatic failover (industry standard for PG HA)
- **3 Swarm managers + 1 worker** for Swarm quorum tolerance
- **3 etcd nodes** (Pi 1-3) for distributed consensus (tolerates 1 etcd failure)
- **1 PG primary + 3 streaming replicas** with automatic promotion via Patroni
- **HAProxy + keepalived** for a floating Virtual IP so any node can serve traffic

---

## Prerequisites

- 4x Raspberry Pi 4 (4GB+ RAM recommended, 8GB preferred)
- Each Pi running a 64-bit OS (Raspberry Pi OS Lite 64-bit or Ubuntu Server 22.04+ arm64)
- Each Pi has a static IP on the same subnet (e.g. `192.168.2.10-13`)
- SSH access between all nodes (key-based)
- Shared network storage is NOT required (PostgreSQL replication handles data redundancy)
- External storage recommended: USB SSD on each Pi for PostgreSQL data (SD cards are unreliable for databases)

---

## Step-by-Step Implementation

### Phase 1: Hardware and OS Preparation

#### Step 1.1 - Flash and configure each Pi

On each of the 4 Pis:

1. Flash 64-bit OS (Raspberry Pi OS Lite arm64 or Ubuntu Server arm64)
2. Set hostname: `noodle-pi-1`, `noodle-pi-2`, `noodle-pi-3`, `noodle-pi-4`
3. Assign static IPs:
   - Pi 1: `192.168.2.10`
   - Pi 2: `192.168.2.11`
   - Pi 3: `192.168.2.12`
   - Pi 4: `192.168.2.13`
   - Virtual IP (VIP): `192.168.2.20` (floating, managed by keepalived)
4. Mount USB SSD to `/mnt/data` for PostgreSQL storage
5. Set up SSH key-based access between all nodes

#### Step 1.2 - Install Docker on all nodes

```bash
# Run on ALL 4 Pis
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo systemctl enable docker
sudo systemctl start docker
```

#### Step 1.3 - Verify ARM64 compatibility

```bash
# Should show aarch64
uname -m

# Docker should show linux/arm64
docker info --format '{{.Architecture}}'
```

---

### Phase 2: Docker Swarm Cluster Setup

#### Step 2.1 - Initialize Swarm on Pi 1

```bash
# On Pi 1 (192.168.2.10)
docker swarm init --advertise-addr 192.168.2.10
```

This outputs a join token. Save both the manager and worker tokens:

```bash
# Get manager join token
docker swarm join-token manager

# Get worker join token
docker swarm join-token worker
```

#### Step 2.2 - Join remaining nodes

```bash
# On Pi 2 and Pi 3 - join as MANAGERS
docker swarm join --token <MANAGER_TOKEN> 192.168.2.10:2377

# On Pi 4 - join as WORKER
docker swarm join --token <WORKER_TOKEN> 192.168.2.10:2377
```

#### Step 2.3 - Verify the Swarm

```bash
# On any manager node
docker node ls
# Should show 4 nodes: 3 managers (one Leader) + 1 worker
```

#### Step 2.4 - Create overlay network

```bash
docker network create \
  --driver overlay \
  --attachable \
  --subnet 10.0.10.0/24 \
  noodle-net
```

---

### Phase 3: etcd Cluster for Patroni Consensus

Patroni needs a distributed key-value store for leader election. etcd is the standard choice.

#### Step 3.1 - Deploy etcd on Pi 1, 2, and 3

Create `/mnt/data/etcd/` on each of the 3 Pis, then deploy as a Docker Swarm service
with placement constraints.

Create `etcd-stack.yml`:

```yaml
# etcd-stack.yml - deploy on Pi 1, 2, 3
version: "3.8"

services:
  etcd1:
    image: gcr.io/etcd-development/etcd:v3.5.12
    hostname: etcd1
    environment:
      ETCD_NAME: etcd1
      ETCD_INITIAL_ADVERTISE_PEER_URLS: http://etcd1:2380
      ETCD_LISTEN_PEER_URLS: http://0.0.0.0:2380
      ETCD_LISTEN_CLIENT_URLS: http://0.0.0.0:2379
      ETCD_ADVERTISE_CLIENT_URLS: http://etcd1:2379
      ETCD_INITIAL_CLUSTER: etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      ETCD_INITIAL_CLUSTER_STATE: new
      ETCD_INITIAL_CLUSTER_TOKEN: noodle-etcd-cluster
    volumes:
      - /mnt/data/etcd:/etcd-data
    networks:
      - noodle-net
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-1

  etcd2:
    image: gcr.io/etcd-development/etcd:v3.5.12
    hostname: etcd2
    environment:
      ETCD_NAME: etcd2
      ETCD_INITIAL_ADVERTISE_PEER_URLS: http://etcd2:2380
      ETCD_LISTEN_PEER_URLS: http://0.0.0.0:2380
      ETCD_LISTEN_CLIENT_URLS: http://0.0.0.0:2379
      ETCD_ADVERTISE_CLIENT_URLS: http://etcd2:2379
      ETCD_INITIAL_CLUSTER: etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      ETCD_INITIAL_CLUSTER_STATE: new
      ETCD_INITIAL_CLUSTER_TOKEN: noodle-etcd-cluster
    volumes:
      - /mnt/data/etcd:/etcd-data
    networks:
      - noodle-net
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-2

  etcd3:
    image: gcr.io/etcd-development/etcd:v3.5.12
    hostname: etcd3
    environment:
      ETCD_NAME: etcd3
      ETCD_INITIAL_ADVERTISE_PEER_URLS: http://etcd3:2380
      ETCD_LISTEN_PEER_URLS: http://0.0.0.0:2380
      ETCD_LISTEN_CLIENT_URLS: http://0.0.0.0:2379
      ETCD_ADVERTISE_CLIENT_URLS: http://etcd3:2379
      ETCD_INITIAL_CLUSTER: etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
      ETCD_INITIAL_CLUSTER_STATE: new
      ETCD_INITIAL_CLUSTER_TOKEN: noodle-etcd-cluster
    volumes:
      - /mnt/data/etcd:/etcd-data
    networks:
      - noodle-net
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-3

networks:
  noodle-net:
    external: true
```

```bash
docker stack deploy -c etcd-stack.yml etcd
```

---

### Phase 4: PostgreSQL HA with Patroni

Patroni manages PostgreSQL replication and automatic failover. When the primary
node fails, Patroni automatically promotes one of the replicas.

#### Step 4.1 - Build a Patroni + PostgreSQL ARM64 image

Create `patroni/Dockerfile`:

```dockerfile
FROM postgres:16-bookworm

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-psycopg2 \
    --no-install-recommends \
    && pip3 install --break-system-packages patroni[etcd3] \
    && rm -rf /var/lib/apt/lists/*

# Patroni config will be mounted at runtime
ENTRYPOINT ["patroni"]
CMD ["/etc/patroni/patroni.yml"]
```

Build on one of the Pis (or cross-build for arm64):

```bash
docker build -t noodle-patroni:latest ./patroni/
```

#### Step 4.2 - Create Patroni configuration template

Create `patroni/patroni.yml.template` (each node gets a copy with its name substituted):

```yaml
scope: noodle-cluster
name: NODE_NAME

restapi:
  listen: 0.0.0.0:8008
  connect_address: NODE_NAME:8008

etcd3:
  hosts:
    - etcd1:2379
    - etcd2:2379
    - etcd3:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        wal_level: replica
        hot_standby: "on"
        max_wal_senders: 5
        max_replication_slots: 5
        wal_keep_size: 128MB

  initdb:
    - encoding: UTF8
    - data-checksums

  pg_hba:
    - host replication replicator 0.0.0.0/0 md5
    - host all all 0.0.0.0/0 md5

  users:
    noodleuser:
      password: "CHANGE_ME_NOODLE_PASSWORD"
      options:
        - createrole
        - createdb
    replicator:
      password: "CHANGE_ME_REPLICATOR_PASSWORD"
      options:
        - replication

postgresql:
  listen: 0.0.0.0:5432
  connect_address: NODE_NAME:5432
  data_dir: /var/lib/postgresql/data
  pgpass: /tmp/pgpass0
  authentication:
    superuser:
      username: postgres
      password: "CHANGE_ME_POSTGRES_PASSWORD"
    replication:
      username: replicator
      password: "CHANGE_ME_REPLICATOR_PASSWORD"
  parameters:
    shared_buffers: 256MB
    work_mem: 8MB
    maintenance_work_mem: 64MB
    effective_cache_size: 512MB
    max_connections: 100

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
```

#### Step 4.3 - Deploy Patroni as a Swarm stack

```yaml
# patroni-stack.yml
version: "3.8"

services:
  patroni1:
    image: noodle-patroni:latest
    hostname: patroni1
    environment:
      PATRONI_NAME: patroni1
    volumes:
      - /mnt/data/postgres:/var/lib/postgresql/data
      - ./patroni/patroni1.yml:/etc/patroni/patroni.yml:ro
    networks:
      - noodle-net
    ports:
      - target: 5432
        published: 5432
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-1

  patroni2:
    image: noodle-patroni:latest
    hostname: patroni2
    environment:
      PATRONI_NAME: patroni2
    volumes:
      - /mnt/data/postgres:/var/lib/postgresql/data
      - ./patroni/patroni2.yml:/etc/patroni/patroni.yml:ro
    networks:
      - noodle-net
    ports:
      - target: 5432
        published: 5432
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-2

  patroni3:
    image: noodle-patroni:latest
    hostname: patroni3
    environment:
      PATRONI_NAME: patroni3
    volumes:
      - /mnt/data/postgres:/var/lib/postgresql/data
      - ./patroni/patroni3.yml:/etc/patroni/patroni.yml:ro
    networks:
      - noodle-net
    ports:
      - target: 5432
        published: 5432
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-3

  patroni4:
    image: noodle-patroni:latest
    hostname: patroni4
    environment:
      PATRONI_NAME: patroni4
    volumes:
      - /mnt/data/postgres:/var/lib/postgresql/data
      - ./patroni/patroni4.yml:/etc/patroni/patroni.yml:ro
    networks:
      - noodle-net
    ports:
      - target: 5432
        published: 5432
    deploy:
      placement:
        constraints:
          - node.hostname == noodle-pi-4

networks:
  noodle-net:
    external: true
```

#### Step 4.4 - Verify Patroni cluster

```bash
# Check cluster status from any node
docker exec <patroni1_container> patronictl -c /etc/patroni/patroni.yml list

# Expected output:
# +----------+----------+---------+---------+----+-----------+
# | Member   | Host     | Role    | State   | TL | Lag in MB |
# +----------+----------+---------+---------+----+-----------+
# | patroni1 | patroni1 | Leader  | running |  1 |           |
# | patroni2 | patroni2 | Replica | running |  1 |         0 |
# | patroni3 | patroni3 | Replica | running |  1 |         0 |
# | patroni4 | patroni4 | Replica | running |  1 |         0 |
# +----------+----------+---------+---------+----+-----------+
```

---

### Phase 5: HAProxy + keepalived for Connection Routing

You need a way for the app to always connect to the current PostgreSQL primary,
regardless of which node it's on. HAProxy handles this, and keepalived provides
a floating VIP.

#### Step 5.1 - HAProxy configuration

Create `haproxy/haproxy.cfg`:

```
global
    maxconn 1000

defaults
    mode tcp
    timeout connect 5s
    timeout client 30s
    timeout server 30s

# PostgreSQL primary (read-write) - routes to current Patroni leader
listen postgres_primary
    bind *:5433
    option httpchk GET /primary
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server patroni1 192.168.2.10:5432 check port 8008
    server patroni2 192.168.2.11:5432 check port 8008
    server patroni3 192.168.2.12:5432 check port 8008
    server patroni4 192.168.2.13:5432 check port 8008

# PostgreSQL replicas (read-only) - load balances across replicas
listen postgres_replicas
    bind *:5434
    option httpchk GET /replica
    http-check expect status 200
    balance roundrobin
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server patroni1 192.168.2.10:5432 check port 8008
    server patroni2 192.168.2.11:5432 check port 8008
    server patroni3 192.168.2.12:5432 check port 8008
    server patroni4 192.168.2.13:5432 check port 8008

# Supabase services load balancing
listen supabase_api
    bind *:8000
    mode http
    balance roundrobin
    server pi1 192.168.2.10:3000 check
    server pi2 192.168.2.11:3000 check
    server pi3 192.168.2.12:3000 check
    server pi4 192.168.2.13:3000 check

# Noodle Planner load balancing
listen noodleplanner
    bind *:8007
    mode http
    balance roundrobin
    option httpchk GET /health
    server pi1 192.168.2.10:8007 check
    server pi2 192.168.2.11:8007 check
    server pi3 192.168.2.12:8007 check
    server pi4 192.168.2.13:8007 check

# HAProxy stats UI
listen stats
    bind *:8404
    mode http
    stats enable
    stats uri /
    stats refresh 5s
```

#### Step 5.2 - keepalived for floating VIP

Install keepalived on all 4 Pis (outside Docker, as a system service):

```bash
sudo apt-get install -y keepalived haproxy
```

Create `/etc/keepalived/keepalived.conf` on each Pi (adjust `priority` per node):

```
# On Pi 1: priority 101
# On Pi 2: priority 100
# On Pi 3: priority 99
# On Pi 4: priority 98

vrrp_script check_haproxy {
    script "/usr/bin/pgrep haproxy"
    interval 2
    weight 2
}

vrrp_instance NOODLE_VIP {
    interface eth0
    state BACKUP
    virtual_router_id 51
    priority 101          # <-- different on each node
    advert_int 1

    virtual_ipaddress {
        192.168.2.20/24
    }

    track_script {
        check_haproxy
    }
}
```

Now `192.168.2.20` is your single entrypoint. If the node holding the VIP goes
down, keepalived promotes the next highest-priority node within seconds.

---

### Phase 6: Supabase Services Deployment

Self-hosted Supabase consists of several services. The stateless ones can be replicated
across all nodes via Swarm. PostgreSQL is already handled by Patroni above.

#### Step 6.1 - Generate Supabase secrets

```bash
# Generate JWT secret (shared across all nodes)
openssl rand -base64 32 > /mnt/data/supabase/jwt_secret.txt

# Generate anon and service_role keys using the JWT secret
# Use https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
# or the supabase CLI
```

#### Step 6.2 - Supabase stack definition

```yaml
# supabase-stack.yml
version: "3.8"

services:
  # Kong API Gateway (routes to PostgREST, GoTrue, etc.)
  kong:
    image: kong:3.5
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /var/lib/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl
    volumes:
      - ./supabase/kong.yml:/var/lib/kong/kong.yml:ro
    networks:
      - noodle-net
    ports:
      - "3000:8000"
    deploy:
      replicas: 4   # one per node

  # GoTrue - Authentication
  gotrue:
    image: supabase/gotrue:v2.151.0
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: http://192.168.2.20:3000
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgresql://noodleuser:CHANGE_ME@patroni-vip:5433/noodleplanner?sslmode=disable
      GOTRUE_SITE_URL: http://192.168.2.20:8007
      GOTRUE_JWT_SECRET: <YOUR_JWT_SECRET>
      GOTRUE_JWT_EXP: 3600
      GOTRUE_DISABLE_SIGNUP: "false"
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
    networks:
      - noodle-net
    deploy:
      replicas: 4

  # PostgREST - Auto-generated REST API from PostgreSQL schema
  postgrest:
    image: postgrest/postgrest:v12.0.2
    environment:
      PGRST_DB_URI: postgresql://noodleuser:CHANGE_ME@patroni-vip:5433/noodleplanner
      PGRST_DB_SCHEMAS: public,storage
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: <YOUR_JWT_SECRET>
      PGRST_DB_USE_LEGACY_GUCS: "false"
    networks:
      - noodle-net
    deploy:
      replicas: 4

  # Realtime - WebSocket subscriptions for live updates
  realtime:
    image: supabase/realtime:v2.28.32
    environment:
      DB_HOST: patroni-vip
      DB_PORT: 5433
      DB_USER: noodleuser
      DB_PASSWORD: CHANGE_ME
      DB_NAME: noodleplanner
      PORT: 4000
      JWT_SECRET: <YOUR_JWT_SECRET>
      REPLICATION_MODE: RLS
      SECURE_CHANNELS: "true"
      SECRET_KEY_BASE: <GENERATE_64_BYTE_SECRET>
    networks:
      - noodle-net
    deploy:
      replicas: 2   # lighter footprint; 2 is sufficient

  # Storage - File/object storage
  storage:
    image: supabase/storage-api:v0.46.4
    environment:
      ANON_KEY: <YOUR_ANON_KEY>
      SERVICE_KEY: <YOUR_SERVICE_KEY>
      POSTGREST_URL: http://postgrest:3000
      PGRST_JWT_SECRET: <YOUR_JWT_SECRET>
      DATABASE_URL: postgresql://noodleuser:CHANGE_ME@patroni-vip:5433/noodleplanner
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: local
      GLOBAL_S3_BUCKET: stub
    volumes:
      - storage-data:/var/lib/storage
    networks:
      - noodle-net
    deploy:
      replicas: 1   # file storage needs shared volume; keep at 1 or use S3

  # Supabase Studio (Dashboard) - optional, run on one node
  studio:
    image: supabase/studio:20240101-ce42139
    environment:
      STUDIO_PG_META_URL: http://pg-meta:8080
      SUPABASE_URL: http://kong:8000
      SUPABASE_REST_URL: http://192.168.2.20:3000/rest/v1/
      SUPABASE_ANON_KEY: <YOUR_ANON_KEY>
      SUPABASE_SERVICE_KEY: <YOUR_SERVICE_KEY>
    networks:
      - noodle-net
    ports:
      - "3001:3000"
    deploy:
      replicas: 1   # dashboard only needs one instance

  # pg-meta - PostgreSQL metadata API (used by Studio)
  pg-meta:
    image: supabase/postgres-meta:v0.80.0
    environment:
      PG_META_PORT: 8080
      PG_META_DB_HOST: patroni-vip
      PG_META_DB_PORT: 5433
      PG_META_DB_NAME: noodleplanner
      PG_META_DB_USER: noodleuser
      PG_META_DB_PASSWORD: CHANGE_ME
    networks:
      - noodle-net
    deploy:
      replicas: 1

volumes:
  storage-data:

networks:
  noodle-net:
    external: true
```

> **Note on ARM64**: Most Supabase Docker images now publish `linux/arm64`
> variants. If any image lacks ARM support, you can build from source
> (all Supabase components are open source). Check each image's Docker Hub
> page for multi-arch manifests.

#### Step 6.3 - Initialize the Supabase database schema

After PostgreSQL is running via Patroni, apply the Supabase base schema:

```bash
# Clone supabase/postgres for the migration files
git clone --depth 1 https://github.com/supabase/postgres.git /tmp/supabase-postgres

# Apply migrations against the primary
psql postgresql://postgres:CHANGE_ME@192.168.2.20:5433/noodleplanner \
  -f /tmp/supabase-postgres/migrations/db/init-scripts/00-initial-schema.sql
```

Or use the Supabase CLI:

```bash
npx supabase db push --db-url postgresql://postgres:CHANGE_ME@192.168.2.20:5433/noodleplanner
```

---

### Phase 7: Noodle Planner Integration Changes

#### Step 7.1 - Update DATABASE_URL to point at HAProxy

In `.env` (or docker-compose environment):

```bash
# Before (direct connection to single PG)
DATABASE_URL=postgresql://noodleuser:noodlepass@192.168.2.1:5433/noodleplanner

# After (through HAProxy VIP - always routes to primary)
DATABASE_URL=postgresql://noodleuser:noodlepass@192.168.2.20:5433/noodleplanner
```

No code changes needed for existing SQLAlchemy database.py - it already uses
`DATABASE_URL` from the environment and has retry logic with exponential backoff.

#### Step 7.2 - Add Supabase Python client for new features

```bash
# In packages/noodle-web/pyproject.toml, add:
# supabase>=2.0.0
uv add supabase --package noodle-web
```

#### Step 7.3 - Create a Supabase client module

Create `packages/noodle-web/src/noodle_web/supabase_client.py`:

```python
import os
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "http://192.168.2.20:3000")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

def get_supabase_client() -> Client:
    """Get a Supabase client using the anon key (for user-facing operations)."""
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

def get_supabase_admin() -> Client:
    """Get a Supabase client using the service key (for server-side operations)."""
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
```

#### Step 7.4 - Add user authentication (optional but recommended)

With Supabase GoTrue running, you can add user auth to Noodle Planner:

- Sign up / login via Supabase Auth
- Store plans per-user in PostgreSQL via Supabase PostgREST or direct SQLAlchemy
- Row Level Security (RLS) policies to isolate user data

#### Step 7.5 - Persistent plan storage (optional)

Currently plans are processed in-memory. With Supabase you could:

1. Create a `plans` table in PostgreSQL
2. Save/load plans via the Supabase REST API or SQLAlchemy
3. Use Supabase Realtime for live collaboration on plans

#### Step 7.6 - Deploy Noodle Planner as a Swarm service

```yaml
# noodle-stack.yml
version: "3.8"

services:
  noodleplanner:
    image: noodle-planner:latest   # built from existing Dockerfile
    environment:
      HOST: 0.0.0.0
      PORT: 8007
      MAX_FILE_SIZE: 1048576
      RELOAD: "false"
      DATABASE_URL: postgresql://noodleuser:noodlepass@192.168.2.20:5433/noodleplanner
      ENABLE_ACTIVITY_LOGGING: "true"
      SUPABASE_URL: http://kong:8000
      SUPABASE_ANON_KEY: <YOUR_ANON_KEY>
      SUPABASE_SERVICE_KEY: <YOUR_SERVICE_KEY>
    networks:
      - noodle-net
    ports:
      - "8007:8007"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8007/health').read()"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      replicas: 4
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3

networks:
  noodle-net:
    external: true
```

---

### Phase 8: Fault Tolerance Verification

#### Step 8.1 - Test PostgreSQL failover

```bash
# Check current leader
docker exec <patroni1> patronictl -c /etc/patroni/patroni.yml list

# Kill the primary node (e.g., shut down Pi 1)
sudo shutdown now   # on Pi 1

# Within 30 seconds, check from another node:
docker exec <patroni2> patronictl -c /etc/patroni/patroni.yml list
# A new leader should have been elected

# Verify the app still works via the VIP
curl http://192.168.2.20:8007/health
```

#### Step 8.2 - Test Swarm service recovery

```bash
# Kill a Noodle Planner container
docker service ps noodle_noodleplanner

# Docker Swarm will automatically reschedule to a healthy node
# Verify with:
docker service ps noodle_noodleplanner
```

#### Step 8.3 - Test VIP failover

```bash
# Check which node holds the VIP
ip addr show eth0 | grep 192.168.2.20

# Shut down that node
# VIP should move to the next highest-priority node within 3 seconds
# Verify:
ping 192.168.2.20
```

---

## Fault Tolerance Summary

| Component         | Failure Scenario     | Recovery                              | Downtime      |
|-------------------|----------------------|---------------------------------------|---------------|
| PostgreSQL        | Primary node dies    | Patroni auto-promotes a replica       | ~10-30 sec    |
| PostgreSQL        | Replica node dies    | Remaining replicas continue; no impact| 0             |
| etcd              | 1 of 3 nodes dies    | Quorum maintained (2/3)               | 0             |
| Swarm Manager     | 1 of 3 managers dies | Raft quorum maintained (2/3)          | 0             |
| Noodle Planner    | Any node dies        | Swarm reschedules; HAProxy routes away| ~5 sec        |
| Supabase services | Any node dies        | Replicated services keep running      | 0-5 sec       |
| VIP (keepalived)  | VIP holder dies      | VIP moves to next node                | ~3 sec        |

**Maximum tolerable simultaneous failures: 1 node** (for etcd and Swarm quorum).
If 2+ nodes fail simultaneously, you lose quorum and the cluster cannot elect
new leaders. This is a fundamental constraint of consensus algorithms with 3
voting members.

---

## Quick Reference: Service Ports

| Service              | Port  | Notes                             |
|----------------------|-------|-----------------------------------|
| Noodle Planner       | 8007  | Via HAProxy VIP                   |
| Supabase API (Kong)  | 3000  | Via HAProxy VIP                   |
| Supabase Studio      | 3001  | Dashboard, single instance        |
| PostgreSQL (primary)  | 5433  | Via HAProxy, routed to leader     |
| PostgreSQL (replicas) | 5434  | Via HAProxy, round-robin replicas |
| HAProxy stats        | 8404  | Monitoring dashboard              |
| Patroni REST API     | 8008  | Per-node health checks            |

---

## Files to Create in This Repository

After planning is approved, the following files would be created:

```
noodleplanner/
├── deploy/
│   ├── etcd-stack.yml
│   ├── patroni-stack.yml
│   ├── supabase-stack.yml
│   ├── noodle-stack.yml
│   ├── haproxy/
│   │   └── haproxy.cfg
│   ├── keepalived/
│   │   └── keepalived.conf.template
│   ├── patroni/
│   │   ├── Dockerfile
│   │   └── patroni.yml.template
│   ├── supabase/
│   │   └── kong.yml
│   └── .env.example
├── packages/noodle-web/src/noodle_web/
│   └── supabase_client.py          (new)
└── docs/
    └── supabase-raspberry-pi-cluster-plan.md  (this file)
```
