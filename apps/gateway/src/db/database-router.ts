import { getLogger } from "@director.run/utilities/logger";
import { Pool } from "pg";

const logger = getLogger("DatabaseRouter");

/**
 * Database connection router for read/write splitting.
 *
 * Routes read queries (SELECT) to read replicas for better performance
 * while ensuring all writes go to the primary database.
 *
 * Why read replicas?
 * - Offload read traffic from primary (most DB traffic is reads)
 * - Scale horizontally by adding more replicas
 * - Improve read latency via geographic distribution
 *
 * Architecture:
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │                 Gateway Instance                 │
 * │                                                  │
 * │  ┌──────────────────────────────────────────┐   │
 * │  │           DatabaseRouter                  │   │
 * │  │                                          │   │
 * │  │  write() ──────► Primary Pool            │   │
 * │  │                     │                    │   │
 * │  │                     ▼                    │   │
 * │  │              ┌────────────┐              │   │
 * │  │              │  Primary   │              │   │
 * │  │              │  (writes)  │              │   │
 * │  │              └────────────┘              │   │
 * │  │                                          │   │
 * │  │  read() ───────► Replica Pool            │   │
 * │  │                     │                    │   │
 * │  │          ┌──────────┼──────────┐         │   │
 * │  │          ▼          ▼          ▼         │   │
 * │  │     ┌────────┐ ┌────────┐ ┌────────┐    │   │
 * │  │     │Replica1│ │Replica2│ │Replica3│    │   │
 * │  │     └────────┘ └────────┘ └────────┘    │   │
 * │  └──────────────────────────────────────────┘   │
 * └──────────────────────────────────────────────────┘
 * ```
 *
 * Usage:
 * ```typescript
 * const router = new DatabaseRouter({
 *   primaryUrl: process.env.DATABASE_URL,
 *   replicaUrl: process.env.DATABASE_READ_REPLICA_URL,
 * });
 *
 * // Writes always go to primary
 * await router.write(async (pool) => {
 *   await pool.query('INSERT INTO ...');
 * });
 *
 * // Reads go to replica (with fallback to primary)
 * const result = await router.read(async (pool) => {
 *   return pool.query('SELECT * FROM ...');
 * });
 * ```
 */
export class DatabaseRouter {
  private primaryPool: Pool;
  private replicaPool: Pool | null = null;
  private replicaHealthy = true;
  private lastHealthCheck = 0;
  private readonly healthCheckIntervalMs = 30000; // 30 seconds

  constructor(config: DatabaseRouterConfig) {
    // Primary pool (required)
    this.primaryPool = new Pool({
      connectionString: config.primaryUrl,
      max: config.primaryPoolSize ?? 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Replica pool (optional)
    if (config.replicaUrl) {
      this.replicaPool = new Pool({
        connectionString: config.replicaUrl,
        max: config.replicaPoolSize ?? 20, // More connections for reads
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000, // Faster timeout for replicas
      });

      logger.info("Read replica configured");
    }

    // Log pool errors
    this.primaryPool.on("error", (err) => {
      logger.error({ msg: "Primary pool error", error: err.message });
    });

    this.replicaPool?.on("error", (err) => {
      logger.error({ msg: "Replica pool error", error: err.message });
      this.replicaHealthy = false;
    });
  }

  /**
   * Get a pool for write operations (INSERT, UPDATE, DELETE).
   * Always returns the primary database pool.
   */
  getWritePool(): Pool {
    return this.primaryPool;
  }

  /**
   * Get a pool for read operations (SELECT).
   * Returns replica if available and healthy, otherwise primary.
   */
  async getReadPool(): Promise<Pool> {
    // No replica configured - use primary
    if (!this.replicaPool) {
      return this.primaryPool;
    }

    // Check replica health periodically
    await this.checkReplicaHealth();

    // Replica unhealthy - fall back to primary
    if (!this.replicaHealthy) {
      logger.debug("Replica unhealthy, falling back to primary");
      return this.primaryPool;
    }

    return this.replicaPool;
  }

  /**
   * Execute a write operation on the primary database.
   */
  write<T>(operation: (pool: Pool) => Promise<T>): Promise<T> {
    return operation(this.primaryPool);
  }

  /**
   * Execute a read operation, preferring replica if available.
   */
  async read<T>(operation: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = await this.getReadPool();
    try {
      return await operation(pool);
    } catch (error) {
      // If replica failed, mark unhealthy and retry on primary
      if (pool === this.replicaPool) {
        logger.warn("Replica query failed, retrying on primary");
        this.replicaHealthy = false;
        return operation(this.primaryPool);
      }
      throw error;
    }
  }

  /**
   * Check replica health and update status.
   * Runs at most once per healthCheckIntervalMs.
   */
  private async checkReplicaHealth(): Promise<void> {
    if (!this.replicaPool) {
      return;
    }

    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckIntervalMs) {
      return;
    }
    this.lastHealthCheck = now;

    try {
      const client = await this.replicaPool.connect();
      await client.query("SELECT 1");
      client.release();

      if (!this.replicaHealthy) {
        logger.info("Replica recovered");
      }
      this.replicaHealthy = true;
    } catch (error) {
      if (this.replicaHealthy) {
        logger.warn({
          msg: "Replica health check failed",
          error: (error as Error).message,
        });
      }
      this.replicaHealthy = false;
    }
  }

  /**
   * Check if read replica is configured and healthy.
   */
  isReplicaAvailable(): boolean {
    return this.replicaPool !== null && this.replicaHealthy;
  }

  /**
   * Get connection pool statistics for monitoring.
   */
  getStats(): DatabaseRouterStats {
    return {
      primary: {
        total: this.primaryPool.totalCount,
        idle: this.primaryPool.idleCount,
        waiting: this.primaryPool.waitingCount,
      },
      replica: this.replicaPool
        ? {
            total: this.replicaPool.totalCount,
            idle: this.replicaPool.idleCount,
            waiting: this.replicaPool.waitingCount,
            healthy: this.replicaHealthy,
          }
        : null,
    };
  }

  /**
   * Gracefully close all connection pools.
   */
  async close(): Promise<void> {
    logger.info("Closing database pools...");
    await Promise.all([this.primaryPool.end(), this.replicaPool?.end()]);
    logger.info("Database pools closed");
  }
}

/**
 * Configuration for DatabaseRouter.
 */
export interface DatabaseRouterConfig {
  /** Primary database connection URL (required) */
  primaryUrl: string;
  /** Read replica connection URL (optional) */
  replicaUrl?: string;
  /** Max connections for primary pool (default: 10) */
  primaryPoolSize?: number;
  /** Max connections for replica pool (default: 20) */
  replicaPoolSize?: number;
}

/**
 * Connection pool statistics.
 */
export interface DatabaseRouterStats {
  primary: PoolStats;
  replica: (PoolStats & { healthy: boolean }) | null;
}

interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}
