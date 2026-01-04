# Changelog

All notable changes to Director Enhanced (Redis) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - Director Enhanced Redis Fork

This fork extends Director Enhanced with Redis caching for horizontal scaling.

### Added (Redis-specific)

- **Redis Cache Layer** (`apps/gateway/src/cache/redis-cache.ts`)

  - Pub/sub invalidation for cross-instance cache sync
  - Configurable TTL (default 5 minutes)
  - W3C trace context propagation
  - Graceful fallback when Redis unavailable

- **BullMQ Job Queue** (`apps/gateway/src/queue/job-queue.ts`)

  - OAuth token refresh (scheduled before expiry)
  - Periodic cleanup (stale connections, hourly cron)
  - Cache warmup on login
  - Retry with exponential backoff
  - Graceful shutdown handling

- **Database Read Replicas** (`apps/gateway/src/db/database-router.ts`)

  - Read/write splitting (SELECT to replicas, writes to primary)
  - Automatic failover with health checks
  - Pool statistics for monitoring
  - Graceful connection pool shutdown

- **Environment Variables**

  - `REDIS_URL` - Optional Redis connection URL
  - `REDIS_CACHE_TTL_SECONDS` - Cache TTL (default: 300)
  - `DATABASE_READ_REPLICA_URL` - Optional read replica connection
  - `DATABASE_READ_REPLICA_ENABLED` - Enable replica routing

- **Dependencies**
  - `ioredis` v5.4.1 for Redis client
  - `bullmq` v5.34.0 for job queue

### Inherited from Director Enhanced

- Security headers middleware
- Production guards for dangerous flags
- N+1 query optimization (batch methods)
- Request tracing middleware
- ARCHITECTURE.md, DEPLOYMENT.md documentation
- Dependabot configuration
- E2E test scaffolding

## Configuration

### Without Redis (single instance)

```bash
# Works exactly like Director Enhanced - no configuration needed
bun run serve
```

### With Redis (horizontal scaling)

```bash
# Add Redis URL to enable caching
export REDIS_URL="redis://localhost:6379"
export REDIS_CACHE_TTL_SECONDS=300  # 5 minutes

# Run multiple instances
bun run serve  # Instance 1
bun run serve  # Instance 2 (on different port)
```

### Docker Compose with Redis

```yaml
version: "3.8"
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  director:
    image: director-enhanced-redis
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis
```
