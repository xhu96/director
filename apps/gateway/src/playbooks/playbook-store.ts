import { HTTPClient } from "@director.run/mcp/client/http-client";
import { OAuthProviderFactory } from "@director.run/mcp/oauth/oauth-provider-factory";
import { AppError, ErrorCode } from "@director.run/utilities/error";
import { getLogger } from "@director.run/utilities/logger";
import { Telemetry } from "@director.run/utilities/telemetry";
import type { Database } from "../db/database";
import { DatabaseOAuthStorage } from "../db/oauth-storage";
import { Playbook, type PlaybookParams, type PlaybookTarget } from "./playbook";

const logger = getLogger("PlaybookStore");

export class PlaybookStore {
  private playbooks: Map<string, Playbook> = new Map();
  private database: Database;
  private telemetry: Telemetry;
  private baseCallbackUrl: string;

  private constructor(params: {
    database: Database;
    telemetry?: Telemetry;
    baseCallbackUrl: string;
  }) {
    this.database = params.database;
    this.telemetry = params.telemetry || Telemetry.noTelemetry();
    this.baseCallbackUrl = params.baseCallbackUrl;
  }

  public static async create({
    database,
    telemetry,
    baseCallbackUrl,
  }: {
    database: Database;
    telemetry?: Telemetry;
    baseCallbackUrl: string;
  }): Promise<PlaybookStore> {
    logger.debug("initializing PlaybookStore");
    const store = new PlaybookStore({
      database,
      telemetry,
      baseCallbackUrl,
    });
    await store.initialize();
    logger.debug("initialization complete");
    return store;
  }

  private async initialize(): Promise<void> {
    // Load from database
    const database = this.database;
    const dbPlaybooks = await database.getAllPlaybooks("");
    const playbooks = await Promise.all(
      dbPlaybooks.map(async (dbPlaybook) => {
        const servers = await database.getServers(dbPlaybook.id);
        const prompts = await database.getPrompts(dbPlaybook.id);
        return {
          id: dbPlaybook.id,
          name: dbPlaybook.name,
          description: dbPlaybook.description ?? undefined,
          userId: dbPlaybook.userId,
          servers: servers.map((s) => database.serverRowToTarget(s)),
          prompts: prompts.map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description ?? undefined,
            body: p.body,
          })),
        };
      }),
    );

    for (const playbookConfig of playbooks) {
      const playbookId = playbookConfig.id;
      logger.debug({ message: `initializing ${playbookId}`, playbookId });

      await this.initializeAndAddPlaybook({
        id: playbookId,
        name: playbookConfig.name,
        description: playbookConfig.description ?? undefined,
        userId: playbookConfig.userId,
        servers: playbookConfig.servers,
        prompts: playbookConfig.prompts,
      });
    }
  }

  /**
   * Retrieves a playbook by ID with ownership verification.
   *
   * This is the primary method for accessing playbooks. It:
   * 1. Checks the in-memory cache first
   * 2. Falls back to database if not cached
   * 3. Verifies the requesting user owns the playbook
   *
   * @param playbookId - Unique identifier for the playbook
   * @param userId - ID of the user making the request
   * @returns The requested playbook if found and authorized
   * @throws {AppError} NOT_FOUND if playbook doesn't exist
   * @throws {AppError} FORBIDDEN if user doesn't own the playbook
   */
  public get(playbookId: string, userId: string): Promise<Playbook> {
    return this.fetchWithAuth(playbookId, userId);
  }

  /**
   * Alias for `get()` - retrieves a playbook with user authorization.
   *
   * Exists for semantic clarity in contexts where user context is explicit.
   * Delegates to `get()` internally.
   *
   * @deprecated Prefer `get()` for new code - this method may be removed.
   */
  public getForUser(playbookId: string, userId: string): Promise<Playbook> {
    return this.fetchWithAuth(playbookId, userId);
  }

  /**
   * Internal method that handles playbook retrieval with ownership verification.
   *
   * Centralizes the cache-or-fetch logic and authorization check to avoid
   * code duplication between public methods. Any changes to how playbooks
   * are loaded or authorized should happen here.
   */
  private async fetchWithAuth(
    playbookId: string,
    userId: string,
  ): Promise<Playbook> {
    // Check in-memory cache first for performance
    let playbook = this.playbooks.get(playbookId);

    // Cache miss: load from database
    if (!playbook) {
      const dbPlaybook = await this.database.getPlaybookWithDetails(
        playbookId,
        userId,
      );

      playbook = await this.initializeAndAddPlaybook({
        id: dbPlaybook.id,
        name: dbPlaybook.name,
        description: dbPlaybook.description ?? undefined,
        userId: dbPlaybook.userId,
        servers: dbPlaybook.servers,
        prompts: dbPlaybook.prompts,
      });
    }

    // Authorization: verify the requesting user owns this playbook
    if (playbook.userId !== userId) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `You do not have permission to access this playbook.`,
      );
    }

    return playbook;
  }

  async delete(playbookId: string, userId: string) {
    this.telemetry.trackEvent("playbook_deleted");
    const playbook = await this.get(playbookId, userId);
    for (const server of playbook.targets) {
      if (server instanceof HTTPClient && (await server.isAuthenticated())) {
        await server.logout();
      }
    }
    await playbook.close();
    await this.database.deletePlaybook(playbookId, userId);
    this.playbooks.delete(playbookId);

    logger.info(`successfully deleted playbook configuration: ${playbookId}`);
  }

  async closeAll() {
    logger.info("cleaning up all playbooks...");
    await Promise.all(
      Array.from(this.playbooks.values()).map((playbook) => playbook.close()),
    );
    logger.info("finished cleaning up all playbooks.");
  }

  /**
   * Clears the in-memory cache. For use in test environments only.
   */
  clearCache() {
    this.playbooks.clear();
  }

  /**
   * Retrieves all playbooks for a user.
   *
   * Uses batch queries to avoid N+1 performance issues - fetches all servers
   * and prompts for uncached playbooks in just 2 additional queries regardless
   * of how many playbooks exist.
   *
   * @param userId - ID of the user to fetch playbooks for
   * @returns Array of all playbooks owned by the user
   */
  public async getAll(userId: string): Promise<Playbook[]> {
    // Load user's playbooks from database
    const dbPlaybooks = await this.database.getAllPlaybooks(userId);

    // Find playbooks not yet in memory cache
    const uncachedPlaybooks = dbPlaybooks.filter(
      (p) => !this.playbooks.has(p.id),
    );

    if (uncachedPlaybooks.length > 0) {
      // Batch fetch servers and prompts for all uncached playbooks
      // This is 2 queries total instead of 2N queries
      const playbookIds = uncachedPlaybooks.map((p) => p.id);
      const [serversMap, promptsMap] = await Promise.all([
        this.database.getServersByPlaybookIds(playbookIds),
        this.database.getPromptsByPlaybookIds(playbookIds),
      ]);

      // Initialize each uncached playbook with its pre-fetched data
      for (const dbPlaybook of uncachedPlaybooks) {
        const servers = serversMap.get(dbPlaybook.id) || [];
        const prompts = promptsMap.get(dbPlaybook.id) || [];

        await this.initializeAndAddPlaybook({
          id: dbPlaybook.id,
          name: dbPlaybook.name,
          description: dbPlaybook.description ?? undefined,
          userId: dbPlaybook.userId,
          servers: servers.map((s) => this.database.serverRowToTarget(s)),
          prompts: prompts.map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description ?? undefined,
            body: p.body,
          })),
        });
      }
    }

    return Array.from(this.playbooks.values()).filter(
      (playbook) => playbook.userId === userId,
    );
  }

  public async onAuthorizationSuccess(
    factoryId: string,
    providerId: string,
    code: string,
    userId: string,
  ) {
    const playbook = await this.get(factoryId, userId);
    const target = await playbook.getTarget(providerId);

    if (target instanceof HTTPClient) {
      await target.completeAuthFlow(code);
    } else {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        `target ${providerId} is not an HTTP client`,
      );
    }
  }

  public async create({
    id,
    name,
    description,
    servers,
    userId,
  }: {
    id?: string;
    name: string;
    description?: string;
    servers?: PlaybookTarget[];
    userId: string;
  }): Promise<Playbook> {
    this.telemetry.trackEvent("playbook_created");

    const dbPlaybook = await this.database.createPlaybook({
      id,
      name,
      description,
      userId,
    });
    const playbookId = dbPlaybook.id;

    // Create servers
    for (const server of servers ?? []) {
      await this.database.addServer(
        this.database.targetToServerInsertParams(playbookId, server),
      );
    }

    const playbook = await this.initializeAndAddPlaybook({
      name,
      description,
      userId,
      servers: servers ?? [],
      id: playbookId,
    });
    logger.info({
      message: `Created new playbook`,
      playbookId,
      userId,
    });
    return playbook;
  }

  private createOAuthProviderFactory(
    playbookId: string,
    userId: string,
  ): OAuthProviderFactory {
    const storage = new DatabaseOAuthStorage({
      database: this.database,
      userId,
    });
    return new OAuthProviderFactory({
      storage: "custom",
      storageInstance: storage,
      baseCallbackUrl: this.baseCallbackUrl,
      id: playbookId,
    });
  }

  private async initializeAndAddPlaybook(playbookParams: PlaybookParams) {
    const playbook = await Playbook.fromConfig(playbookParams, {
      oAuthHandler: this.createOAuthProviderFactory(
        playbookParams.id,
        playbookParams.userId,
      ),
      database: this.database,
    });

    this.playbooks.set(playbook.id, playbook);

    return playbook;
  }
}
