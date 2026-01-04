# Architecture

This document explains Director's internal architecture, design decisions, and how the pieces fit together. It's written for contributors who need to understand the system before making changes.

## System Overview

Director is an MCP gateway that aggregates multiple MCP servers into "playbooks" that can be distributed to AI agents. Think of it as a reverse proxy for MCP: instead of AI agents connecting to individual MCP servers, they connect to Director, which fans out requests to the appropriate backends.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │     │     Cursor      │     │     VSCode      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    Director Gateway     │
                    │  ┌──────────────────┐   │
                    │  │  Playbook Store  │   │
                    │  │  ┌────────────┐  │   │
                    │  │  │ Playbook A │  │   │
                    │  │  │ Playbook B │  │   │
                    │  │  └────────────┘  │   │
                    │  └──────────────────┘   │
                    │  ┌──────────────────┐   │
                    │  │   OAuth Manager  │   │
                    │  └──────────────────┘   │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
│   Notion MCP    │     │   GitHub MCP    │     │   Custom MCP    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Core Concepts

### Playbooks

A playbook is Director's central abstraction. It bundles:

- **MCP Servers** (targets) - the actual tool providers
- **Prompts** - predefined prompt templates
- **Configuration** - tool filtering, descriptions

Each playbook gets a unique MCP endpoint. When an agent connects to that endpoint, it sees a unified view of all the playbook's tools and prompts—as if they came from a single MCP server.

Why playbooks instead of just exposing raw MCP servers?

1. **Portability**: You can share a playbook URL and someone else gets the same toolset
2. **Context management**: Only expose relevant tools for a specific task
3. **Centralized auth**: OAuth tokens stored once, shared across agents

### The Gateway

The gateway (`apps/gateway`) is an Express.js server with several responsibilities:

| Layer         | Purpose                                  | Key Files                                     |
| ------------- | ---------------------------------------- | --------------------------------------------- |
| MCP Transport | SSE/Streamable endpoints for MCP clients | `routers/mcp/`                                |
| tRPC API      | Management operations (CRUD playbooks)   | `routers/trpc/`                               |
| OAuth         | Token exchange and storage               | `auth.ts`, `routers/oauth-client-callback.ts` |
| Studio        | Serve the web UI in production           | `routers/studio.ts`                           |

**Why Express instead of Fastify/Hono?**

Express was chosen for ecosystem compatibility—specifically because `better-auth` has first-class Express support and MCP SDK examples use Express. We're not CPU-bound, so the raw performance difference doesn't matter at current scale.

### Multi-Tenancy

Director recently migrated from single-tenant (one user, local files) to multi-tenant (many users, shared database). Key implications:

- Users are isolated by `userId` on all queries
- OAuth tokens are stored per-user in the database
- The in-memory `PlaybookStore` cache must be invalidated correctly (current limitation: no cross-instance invalidation)

## Data Flow

### Request Lifecycle

Here's what happens when an MCP client calls a tool through Director:

```
1. MCP client sends tools/call request to:
   GET /playbooks/{playbookId}/mcp (SSE) or
   POST /playbooks/{playbookId}/mcp (Streamable)

2. Gateway authenticates the request (session cookie or API key)

3. PlaybookStore.get(playbookId, userId) retrieves the playbook
   - Checks in-memory Map first
   - Falls back to database if not cached
   - Verifies userId matches playbook owner

4. Playbook.callTool(toolName, args) locates the target server
   - Parses prefixed tool name (e.g., "notion__search")
   - Routes to the correct HTTPClient or StdioClient

5. Target MCP server processes the request

6. Response flows back through the same path
```

### Authorization Model

Two levels of auth exist:

1. **User auth** (better-auth): Session cookies or API keys identify the user
2. **MCP server auth** (OAuth PKCE): Per-server tokens stored in database

The flow for OAuth MCP servers:

```
User clicks "Connect" in Studio
    → Director redirects to MCP server's OAuth authorize URL
    → User authenticates with the MCP server
    → MCP server redirects back to Director with auth code
    → Director exchanges code for tokens via PKCE
    → Tokens stored in database, associated with (userId, playbookId, serverName)
```

## Database Schema

Director uses PostgreSQL via Drizzle ORM. Core tables:

| Table          | Purpose                                |
| -------------- | -------------------------------------- |
| `users`        | User accounts (managed by better-auth) |
| `sessions`     | Auth sessions                          |
| `playbooks`    | Playbook metadata (name, description)  |
| `servers`      | MCP servers within playbooks           |
| `prompts`      | Prompt templates within playbooks      |
| `oauth_tokens` | OAuth credentials for MCP servers      |

The schema lives in `apps/gateway/src/db/schema.ts`. Migrations are handled by `drizzle-kit push` (schema-push approach, not migration files).

## Package Boundaries

The monorepo has clear package responsibilities:

### Apps

| Package    | Responsibility             | Deployment               |
| ---------- | -------------------------- | ------------------------ |
| `gateway`  | Backend server             | Self-hosted or our cloud |
| `cli`      | Command-line interface     | npm: `@director.run/cli` |
| `studio`   | Web UI (Next.js)           | Bundled with gateway     |
| `sdk`      | Programmatic access        | npm: `@director.run/sdk` |
| `registry` | Public MCP server registry | Hosted service           |

### Internal Packages

| Package                        | Responsibility                               |
| ------------------------------ | -------------------------------------------- |
| `packages/mcp`                 | MCP SDK extensions (proxy, clients, OAuth)   |
| `packages/utilities`           | Shared helpers (logging, errors, CLI)        |
| `packages/client-configurator` | Generate MCP client configs (Claude, Cursor) |
| `packages/design`              | UI components (Storybook)                    |

**Dependency rule**: Apps can depend on packages. Packages should not depend on apps. Packages should minimize cross-dependencies.

## Extension Points

### Adding a New MCP Transport

The `packages/mcp` package abstracts transport details. To add a new transport:

1. Create a new client class implementing the `Client` interface in `packages/mcp/src/client/`
2. Add transport type to the Zod schema in the gateway
3. Update `Playbook.fromConfig()` to handle the new type

### Adding a New MCP Client Integration

To support a new AI assistant (like Cursor, Claude Code):

1. Add a configurator in `packages/client-configurator/src/`
2. Implement the `ClientConfigurator` interface
3. Add tests covering config file read/write
4. Update CLI's `connect` command to include the new target

## Known Limitations

**In-memory cache without invalidation**: If running multiple gateway instances, playbook updates on one instance won't propagate to others. Fix: Use Redis pub/sub for cache invalidation.

**N+1 queries in getAll()**: Loading all playbooks issues individual queries for servers/prompts per playbook. This is fine for typical usage (few playbooks per user) but would need batch queries for enterprise scale.

**No playbook versioning**: Changes are immediate with no rollback capability. Consider event sourcing pattern for audit/rollback needs.

## Security Considerations

See `SECURITY.md` for disclosure policy. Architectural security notes:

- **Dangerous flags blocked in production**: `DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS` and similar flags throw on startup if `NODE_ENV=production`
- **OAuth tokens encrypted at rest** using `BETTER_AUTH_SECRET`
- **User isolation enforced at query level**: All playbook queries include `userId` predicate
- **Security headers applied**: X-Frame-Options, X-Content-Type-Options, Referrer-Policy

## Testing Philosophy

- **Integration tests preferred**: Most tests in `apps/gateway` are integration tests using `IntegrationTestHarness`
- **Tests must be deterministic**: No parallelism (`--fileParallelism=false`) due to shared database
- **Test fixtures in packages/mcp/test/**: Shared mock MCP servers for consistent testing
