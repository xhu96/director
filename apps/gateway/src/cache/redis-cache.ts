import { getLogger } from "@director.run/utilities/logger";
import Redis from "ioredis";
import type { Playbook } from "../playbooks/playbook";

const logger = getLogger("RedisCache");

/**
 * Redis-backed cache for playbooks enabling horizontal scaling.
 *
 * This cache sits between PlaybookStore and the in-memory Map, providing:
 * - Cross-instance cache sharing via Redis
 * - Pub/sub invalidation when playbooks change
 * - Automatic fallback to database on cache miss
 *
 * Architecture:
 * ```
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │  Gateway 1  │     │  Gateway 2  │     │  Gateway 3  │
 * │  (local)    │     │  (local)    │     │  (local)    │
 * └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
 *        │                   │                   │
 *        └───────────────────┼───────────────────┘
 *                            │
 *               ┌────────────▼────────────┐
 *               │         Redis          │
 *               │  - Playbook metadata   │
 *               │  - Invalidation pub/sub│
 *               └────────────────────────┘
 * ```
 *
 * Usage:
 * ```typescript
 * const cache = new RedisPlaybookCache({
 *   redisUrl: "redis://localhost:6379",
 *   ttlSeconds: 300,
 * });
 *
 * await cache.connect();
 * await cache.set("playbook-id", playbookMetadata);
 * const cached = await cache.get("playbook-id");
 * ```
 */
export class RedisPlaybookCache {
  private client: Redis;
  private subscriber: Redis;
  private readonly keyPrefix = "director:playbook:";
  private readonly channelName = "director:playbook:invalidate";
  private readonly ttlSeconds: number;
  private onInvalidate?: (playbookId: string) => void;

  constructor(config: { redisUrl: string; ttlSeconds?: number }) {
    this.ttlSeconds = config.ttlSeconds ?? 300; // 5 minutes default
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
    });
    this.subscriber = new Redis(config.redisUrl);

    // Handle connection errors gracefully
    this.client.on("error", (err) => {
      logger.error({ msg: "Redis client error", error: err.message });
    });

    this.subscriber.on("error", (err) => {
      logger.error({ msg: "Redis subscriber error", error: err.message });
    });
  }

  /**
   * Connect to Redis and set up pub/sub for invalidation.
   */
  async connect(): Promise<void> {
    await this.subscriber.subscribe(this.channelName);

    this.subscriber.on("message", (channel, message) => {
      if (channel === this.channelName && this.onInvalidate) {
        logger.debug({ msg: "Received invalidation", playbookId: message });
        this.onInvalidate(message);
      }
    });

    logger.info("Redis cache connected");
  }

  /**
   * Register a callback for invalidation events.
   * Call this to sync local in-memory cache with Redis invalidations.
   */
  setInvalidationHandler(handler: (playbookId: string) => void): void {
    this.onInvalidate = handler;
  }

  /**
   * Get cached playbook metadata by ID.
   * Returns null on cache miss.
   */
  async get(playbookId: string): Promise<PlaybookCacheEntry | null> {
    const key = this.keyPrefix + playbookId;
    const data = await this.client.get(key);

    if (!data) {
      logger.debug({ msg: "Cache miss", playbookId });
      return null;
    }

    logger.debug({ msg: "Cache hit", playbookId });
    return JSON.parse(data) as PlaybookCacheEntry;
  }

  /**
   * Store playbook metadata in cache with TTL.
   */
  async set(playbookId: string, entry: PlaybookCacheEntry): Promise<void> {
    const key = this.keyPrefix + playbookId;
    await this.client.setex(key, this.ttlSeconds, JSON.stringify(entry));
    logger.debug({ msg: "Cache set", playbookId, ttl: this.ttlSeconds });
  }

  /**
   * Invalidate a playbook across all instances.
   * Publishes to Redis pub/sub so other gateways can clear their local caches.
   */
  async invalidate(playbookId: string): Promise<void> {
    const key = this.keyPrefix + playbookId;

    // Delete from Redis cache
    await this.client.del(key);

    // Notify all subscribers to invalidate their local caches
    await this.client.publish(this.channelName, playbookId);

    logger.debug({ msg: "Cache invalidated", playbookId });
  }

  /**
   * Invalidate all cached playbooks for a user.
   * Used when bulk operations affect multiple playbooks.
   */
  async invalidateByPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(this.keyPrefix + pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
      logger.debug({ msg: "Bulk cache invalidation", count: keys.length });
    }
  }

  /**
   * Check if Redis is connected and responsive.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gracefully close Redis connections.
   */
  async close(): Promise<void> {
    await this.subscriber.unsubscribe(this.channelName);
    await this.subscriber.quit();
    await this.client.quit();
    logger.info("Redis cache disconnected");
  }
}

/**
 * Serializable playbook metadata stored in Redis.
 * We don't store the full Playbook object (has live connections);
 * just enough to reconstruct it.
 */
export interface PlaybookCacheEntry {
  id: string;
  name: string;
  description?: string;
  userId: string;
  servers: SerializedServer[];
  prompts: SerializedPrompt[];
  cachedAt: number;
}

interface SerializedServer {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tools?: string[];
  prompts?: string[];
  disabled?: boolean;
}

interface SerializedPrompt {
  name: string;
  title: string;
  description?: string;
  body: string;
}

/**
 * Create a cache entry from a Playbook instance.
 */
export function toPlaybookCacheEntry(playbook: Playbook): PlaybookCacheEntry {
  return {
    id: playbook.id,
    name: playbook.name,
    description: playbook.description,
    userId: playbook.userId,
    servers: [], // Populated by caller from database result
    prompts: [], // Populated by caller from database result
    cachedAt: Date.now(),
  };
}
