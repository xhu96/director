import { getLogger } from "@director.run/utilities/logger";
import { type Job, Queue, Worker } from "bullmq";

const logger = getLogger("JobQueue");

/**
 * Background job queue manager for Director.
 *
 * Uses BullMQ (built on Redis) to handle async operations like:
 * - OAuth token refresh (before expiration)
 * - Stale playbook cleanup
 * - Cache warmup on startup
 *
 * Why a job queue instead of simple setInterval?
 * - Survives process restarts (jobs persisted in Redis)
 * - Works across multiple instances (only one processes each job)
 * - Built-in retry with exponential backoff
 * - Visibility into job status via BullMQ dashboard
 *
 * Architecture:
 * ```
 * ┌─────────────┐     ┌─────────────┐
 * │  Gateway 1  │     │  Gateway 2  │
 * │  (producer) │     │  (producer) │
 * └──────┬──────┘     └──────┬──────┘
 *        │                   │
 *        └─────────┬─────────┘
 *                  │
 *         ┌────────▼────────┐
 *         │  Redis Queue    │
 *         │  - oauth-refresh│
 *         │  - cleanup      │
 *         │  - cache-warmup │
 *         └────────┬────────┘
 *                  │
 *        ┌─────────┴─────────┐
 *        │                   │
 * ┌──────▼──────┐     ┌──────▼──────┐
 * │  Worker 1   │     │  Worker 2   │
 * │  (consumer) │     │  (consumer) │
 * └─────────────┘     └─────────────┘
 * ```
 */
export class JobQueueManager {
  private readonly connection: { host: string; port: number };
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    this.connection = {
      host: url.hostname,
      port: parseInt(url.port || "6379", 10),
    };
  }

  /**
   * Initialize all job queues.
   * Call this during gateway startup.
   */
  initialize(): void {
    // Create queues
    this.queues.set(
      "oauth-refresh",
      new Queue("oauth-refresh", { connection: this.connection }),
    );
    this.queues.set(
      "cleanup",
      new Queue("cleanup", { connection: this.connection }),
    );
    this.queues.set(
      "cache-warmup",
      new Queue("cache-warmup", { connection: this.connection }),
    );

    logger.info("Job queues initialized");
  }

  /**
   * Register job handlers and start processing.
   * Each gateway instance runs workers, but BullMQ ensures
   * each job is processed by exactly one worker.
   */
  registerHandlers(handlers: JobHandlers): void {
    // OAuth token refresh worker
    const oauthWorker = new Worker(
      "oauth-refresh",
      async (job: Job<OAuthRefreshJobData>) => {
        logger.debug({ msg: "Processing OAuth refresh", jobId: job.id });
        await handlers.onOAuthRefresh(job.data);
      },
      {
        connection: this.connection,
        concurrency: 5,
      },
    );
    this.workers.set("oauth-refresh", oauthWorker);

    // Cleanup worker
    const cleanupWorker = new Worker(
      "cleanup",
      async (job: Job<CleanupJobData>) => {
        logger.debug({ msg: "Processing cleanup", jobId: job.id });
        await handlers.onCleanup(job.data);
      },
      {
        connection: this.connection,
        concurrency: 1, // Cleanup should be sequential
      },
    );
    this.workers.set("cleanup", cleanupWorker);

    // Cache warmup worker
    const warmupWorker = new Worker(
      "cache-warmup",
      async (job: Job<CacheWarmupJobData>) => {
        logger.debug({ msg: "Processing cache warmup", jobId: job.id });
        await handlers.onCacheWarmup(job.data);
      },
      {
        connection: this.connection,
        concurrency: 1,
      },
    );
    this.workers.set("cache-warmup", warmupWorker);

    // Log worker events
    for (const [name, worker] of this.workers) {
      worker.on("completed", (job) => {
        logger.debug({ msg: "Job completed", queue: name, jobId: job.id });
      });

      worker.on("failed", (job, err) => {
        logger.error({
          msg: "Job failed",
          queue: name,
          jobId: job?.id,
          error: err.message,
        });
      });
    }

    logger.info("Job workers registered");
  }

  /**
   * Schedule an OAuth token refresh.
   * Call this when a token is obtained to schedule refresh before expiry.
   */
  async scheduleOAuthRefresh(data: OAuthRefreshJobData): Promise<void> {
    const queue = this.queues.get("oauth-refresh");
    if (!queue) {
      return;
    }

    // Schedule 5 minutes before expiry
    const delay = Math.max(0, data.expiresAt - Date.now() - 5 * 60 * 1000);

    await queue.add("refresh", data, {
      delay,
      removeOnComplete: true,
      removeOnFail: 100, // Keep last 100 failed jobs for debugging
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 10000, // 10s, 20s, 40s
      },
    });

    logger.debug({
      msg: "Scheduled OAuth refresh",
      playbookId: data.playbookId,
      serverName: data.serverName,
      delayMs: delay,
    });
  }

  /**
   * Schedule periodic cleanup of stale playbook connections.
   * Uses a repeatable job that runs every hour.
   */
  async schedulePeriodicCleanup(): Promise<void> {
    const queue = this.queues.get("cleanup");
    if (!queue) {
      return;
    }

    // Remove any existing repeatable job first
    await queue.removeRepeatable("periodic-cleanup", {
      pattern: "0 * * * *", // Every hour
    });

    // Add new repeatable job
    await queue.add(
      "periodic-cleanup",
      { type: "stale-connections" },
      {
        repeat: {
          pattern: "0 * * * *", // Every hour at :00
        },
        removeOnComplete: true,
      },
    );

    logger.info("Scheduled periodic cleanup (hourly)");
  }

  /**
   * Trigger cache warmup for a user's playbooks.
   * Call this after login to pre-populate cache.
   */
  async triggerCacheWarmup(userId: string): Promise<void> {
    const queue = this.queues.get("cache-warmup");
    if (!queue) {
      return;
    }

    await queue.add(
      "warmup",
      { userId },
      {
        removeOnComplete: true,
        priority: 1, // High priority
      },
    );

    logger.debug({ msg: "Triggered cache warmup", userId });
  }

  /**
   * Gracefully shutdown all workers and close queues.
   * Call this during gateway shutdown.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down job queue...");

    // Close workers first (stop processing new jobs)
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.debug({ msg: "Worker closed", name });
    }

    // Then close queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.debug({ msg: "Queue closed", name });
    }

    logger.info("Job queue shutdown complete");
  }

  /**
   * Check if job queue is connected and healthy.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const queue = this.queues.get("cleanup");
      if (!queue) {
        return false;
      }
      await queue.getJobCounts();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Handler functions for processing jobs.
 * Implement these in your gateway to handle actual business logic.
 */
export interface JobHandlers {
  onOAuthRefresh: (data: OAuthRefreshJobData) => Promise<void>;
  onCleanup: (data: CleanupJobData) => Promise<void>;
  onCacheWarmup: (data: CacheWarmupJobData) => Promise<void>;
}

/**
 * Data for OAuth token refresh job.
 */
export interface OAuthRefreshJobData {
  playbookId: string;
  serverName: string;
  userId: string;
  expiresAt: number; // Unix timestamp
}

/**
 * Data for cleanup job.
 */
export interface CleanupJobData {
  type: "stale-connections" | "expired-sessions" | "orphaned-tokens";
}

/**
 * Data for cache warmup job.
 */
export interface CacheWarmupJobData {
  userId: string;
}
