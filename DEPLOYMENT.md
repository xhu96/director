# Deployment Guide

This guide covers deploying Director in production. It assumes familiarity with Docker, PostgreSQL, and reverse proxies.

## Prerequisites

- **PostgreSQL 14+**: Director requires a PostgreSQL database
- **Node.js 22+**: For building the application
- **Docker** (recommended): Simplifies deployment and isolation

## Environment Variables

Director is configured entirely through environment variables. Here's the complete reference:

### Required

| Variable             | Description                               | Example                                   |
| -------------------- | ----------------------------------------- | ----------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string              | `postgres://user:pass@host:5432/director` |
| `BETTER_AUTH_SECRET` | Secret for session signing (min 32 chars) | `your-secure-random-string`               |
| `BASE_URL`           | Public URL where Director is accessible   | `https://director.example.com`            |

### Optional

| Variable            | Default                         | Description                      |
| ------------------- | ------------------------------- | -------------------------------- |
| `PORT`              | `3673`                          | HTTP port for the gateway        |
| `ALLOWED_ORIGINS`   | `""`                            | Comma-separated CORS origins     |
| `TELEMETRY_ENABLED` | `false`                         | Enable anonymous usage telemetry |
| `REGISTRY_URL`      | `https://registry.director.run` | MCP server registry endpoint     |

### Rate Limiting

| Variable                            | Default | Description             |
| ----------------------------------- | ------- | ----------------------- |
| `API_KEY_RATE_LIMIT_WINDOW_SECONDS` | `60`    | Rate limit window       |
| `API_KEY_RATE_LIMIT_MAX_REQUESTS`   | `1000`  | Max requests per window |

### Security Notes

**Never set these in production:**

| Variable                                    | Risk                               |
| ------------------------------------------- | ---------------------------------- |
| `DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS` | Allows arbitrary command execution |
| `DANGEROUSLY_ALLOW_INSECURE_HTTP_SERVERS`   | Exposes credentials over HTTP      |
| `DANGEROUSLY_ENABLE_SEEDING`                | Enables database seeding endpoints |

Director now enforces this at startup—setting these with `NODE_ENV=production` causes an immediate crash.

## Deployment Options

### Option 1: Docker (Recommended)

The simplest deployment uses the official Docker image:

```bash
docker run -d \
  --name director \
  -p 3673:3673 \
  -e DATABASE_URL="postgres://..." \
  -e BETTER_AUTH_SECRET="your-secret-here" \
  -e BASE_URL="https://director.example.com" \
  -e NODE_ENV="production" \
  barnaby/director:latest
```

### Option 2: Docker Compose

For production with PostgreSQL included:

```yaml
version: "3.8"

services:
  director:
    image: barnaby/director:latest
    ports:
      - "3673:3673"
    environment:
      DATABASE_URL: postgres://director:director@db:5432/director
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BASE_URL: ${BASE_URL}
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: director
      POSTGRES_PASSWORD: director
      POSTGRES_DB: director
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U director"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

### Option 3: Manual Deployment

For non-Docker environments:

```bash
# Clone and build
git clone https://github.com/director-run/director
cd director
bun install
bun run build

# Set environment
export DATABASE_URL="postgres://..."
export BETTER_AUTH_SECRET="..."
export BASE_URL="https://..."
export NODE_ENV="production"

# Initialize database
cd apps/gateway && bun run db:push

# Start
bun run apps/gateway/dist/server.js
```

## Database Setup

### Connection Pooling

For production, use connection pooling (PgBouncer or similar). Director uses the `pg` driver which opens multiple connections during concurrent operations.

Recommended PgBouncer settings:

```ini
pool_mode = transaction
max_client_conn = 100
default_pool_size = 20
```

Update your `DATABASE_URL` to point to PgBouncer instead of PostgreSQL directly.

### Backups

Director stores:

- User accounts and sessions
- Playbook configurations
- OAuth tokens (encrypted with `BETTER_AUTH_SECRET`)

Use standard PostgreSQL backup strategies:

```bash
# Daily logical backup
pg_dump -Fc director > director_$(date +%Y%m%d).dump

# Point-in-time recovery setup
# Configure WAL archiving in postgresql.conf
```

**Important**: OAuth tokens are encrypted with `BETTER_AUTH_SECRET`. If you lose this secret, users will need to re-authenticate all OAuth MCP servers.

## Reverse Proxy Configuration

Director should sit behind a reverse proxy for TLS termination and additional security.

### Nginx

```nginx
upstream director {
    server 127.0.0.1:3673;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name director.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # SSE requires special handling
    location /playbooks/ {
        proxy_pass http://director;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE-specific: disable buffering
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass http://director;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Cloudflare

If using Cloudflare, ensure:

- SSL mode is "Full (strict)"
- Disable "Rocket Loader" (breaks SSE)
- Set "Browser Integrity Check" to Off for `/playbooks/*` (MCP clients aren't browsers)

## Health Checks

Director exposes a health endpoint for load balancer checks:

```bash
curl http://localhost:3673/api/health
# Returns: {"status": "ok"}
```

For Kubernetes/ECS, use:

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3673
  initialDelaySeconds: 10
  periodSeconds: 15
```

## Monitoring

### Logs

Director logs are structured JSON (via Pino). Example log entry:

```json
{
  "level": 30,
  "time": 1704326400000,
  "name": "Gateway",
  "msg": "director gateway running on port 3673"
}
```

Ship logs to your preferred aggregator (Datadog, Loki, etc.):

```bash
docker run ... barnaby/director:latest 2>&1 | your-log-shipper
```

### Metrics (Future)

OpenTelemetry support is planned but not yet implemented. Current recommendation: derive metrics from structured logs.

## Scaling Considerations

### Current Limitations

Director uses an in-memory cache for playbooks. This means:

- **Single-instance deployment works fine**
- **Multi-instance deployments** will have stale cache issues

If you need horizontal scaling today, options:

1. Use sticky sessions to route users to the same instance
2. Accept eventual consistency (cache TTL-based refresh)
3. Contribute Redis-based cache invalidation (PRs welcome!)

### Recommended Sizing

| Users  | Playbooks | Recommended Spec                    |
| ------ | --------- | ----------------------------------- |
| 1-10   | < 50      | 1 CPU, 1GB RAM                      |
| 10-100 | < 500     | 2 CPU, 2GB RAM                      |
| 100+   | 500+      | 4 CPU, 4GB RAM + horizontal scaling |

## Troubleshooting

### "Connection refused" to PostgreSQL

1. Check `DATABASE_URL` format: `postgres://user:pass@host:port/db`
2. Ensure PostgreSQL is running and accessible from Director's network
3. Check firewall rules / security groups

### OAuth redirects fail

1. Verify `BASE_URL` matches the URL users access Director from
2. Check that the reverse proxy passes `X-Forwarded-Proto: https`
3. Ensure no caching layer is caching OAuth redirect responses

### MCP clients can't connect

1. Check that SSE endpoints aren't being buffered (nginx: `proxy_buffering off`)
2. Verify no timeout is killing long-lived SSE connections
3. Test with curl: `curl -N https://director.example.com/playbooks/{id}/sse`

### "FATAL: DANGEROUSLY_ALLOW..." error on startup

This is intentional. These flags are blocked in production for security. If you see this:

1. Remove the dangerous environment variable
2. If you _really_ need it (single-user local dev), set `NODE_ENV=development`

## Upgrade Procedure

1. **Backup database** before upgrading
2. Pull new image: `docker pull barnaby/director:latest`
3. Run database migrations: `docker exec director bun run db:push`
4. Restart container: `docker restart director`
5. Verify health: `curl http://localhost:3673/api/health`

For zero-downtime upgrades, use blue-green deployment with your orchestrator.
