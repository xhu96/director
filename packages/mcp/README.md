# @director.run/mcp

Extensions to the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) that power Director's gateway functionality.

## What This Package Provides

This package isn't meant for direct consumption—it's an internal library that Director uses to proxy MCP connections. That said, understanding its structure helps if you're contributing to Director or building similar tooling.

### Core Components

| Module         | Purpose                                                      |
| -------------- | ------------------------------------------------------------ |
| `client/`      | MCP client implementations (HTTP, stdio, in-memory)          |
| `proxy/`       | Aggregating proxy server that combines multiple MCP backends |
| `oauth/`       | OAuth 2.0 / PKCE flow handling for authenticated MCP servers |
| `transport.ts` | SSE and Streamable HTTP transport utilities                  |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ProxyServer                            │
│  Exposes unified MCP interface to clients                   │
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ HTTPClient  │ │ StdioClient │ │ InMemClient │           │
│  │ (remote)    │ │ (local)     │ │ (testing)   │           │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘           │
└─────────┼───────────────┼───────────────┼───────────────────┘
          │               │               │
          ▼               ▼               ▼
    Remote Server    Local Process    In-Memory
    (via HTTP)       (via stdio)      (for tests)
```

## Client Types

### HTTPClient

Connects to remote MCP servers over HTTP (SSE or Streamable transport).

```typescript
import { HTTPClient } from "@director.run/mcp/client/http-client";

const client = new HTTPClient({
  url: "https://mcp.notion.com/mcp",
  name: "notion",
  oAuthProvider: factory.getProvider("notion"),
});

await client.connect();
const tools = await client.listTools();
```

Key features:

- Automatic OAuth handling via `OAuthProviderFactory`
- Reconnection on connection drops
- Support for both SSE and Streamable transports

### StdioClient

Runs a local MCP server as a subprocess:

```typescript
import { StdioClient } from "@director.run/mcp/client/stdio-client";

const client = new StdioClient({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  env: { HOME: "/home/user" },
});

await client.connect();
```

⚠️ **Security Warning**: Stdio clients execute arbitrary commands. Director blocks stdio servers in production via the `DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS` environment variable.

### InMemoryClient

For testing without network/process overhead:

```typescript
import { InMemoryClient } from "@director.run/mcp/client/in-memory-client";
import { makeEchoServer } from "@director.run/mcp/test/fixtures";

const client = new InMemoryClient({
  name: "echo",
  serverFactory: makeEchoServer,
});

await client.connect();
```

## Proxy Server

The `ProxyServer` aggregates multiple MCP backends into a single interface:

```typescript
import { ProxyServer } from "@director.run/mcp/proxy/proxy-server";

const proxy = new ProxyServer({
  name: "my-playbook",
  targets: [notionClient, githubClient],
  prompts: [{ name: "review", body: "Review this PR: {url}" }],
});

// Tools are namespaced: "notion__search", "github__create_issue"
await proxy.connect();
```

How it works:

1. Collects tools from all targets
2. Prefixes tool names with target name (`{target}__{tool}`)
3. Routes incoming calls to the correct backend
4. Merges prompts from all sources plus custom prompts

## OAuth Integration

For MCP servers requiring authentication:

```typescript
import { OAuthProviderFactory } from "@director.run/mcp/oauth/oauth-provider-factory";
import { DatabaseOAuthStorage } from "@director.run/gateway/db/oauth-storage";

const factory = new OAuthProviderFactory({
  storage: "custom",
  storageInstance: new DatabaseOAuthStorage({ database, userId }),
  baseCallbackUrl: "https://director.example.com",
  id: "playbook-123",
});

// Use with HTTPClient
const client = new HTTPClient({
  url: "https://mcp.notion.com/mcp",
  oAuthProvider: factory.getProvider("notion"),
});

// Check auth status
if (await client.needsAuthentication()) {
  const authUrl = await client.getAuthorizationUrl();
  // Redirect user to authUrl
}
```

Storage options:

- `in-memory`: Development/testing only
- `on-disk`: Single-user local deployment
- `custom`: Provide your own storage (Director uses database)

## Testing Utilities

The `test/fixtures.ts` file provides mock MCP servers:

```typescript
import {
  makeEchoServer,
  makeFooBarServer,
  makeKitchenSinkServer,
} from "@director.run/mcp/test/fixtures";

// Echo server: returns whatever you send
const echo = makeEchoServer();

// FooBar server: has "foo" and "bar" tools
const foobar = makeFooBarServer();

// Kitchen sink: multiple tools, prompts, resources
const kitchen = makeKitchenSinkServer();
```

Use with `serveOverSSE` or `serveOverStreamable` for integration testing:

```typescript
import { serveOverSSE } from "@director.run/mcp/transport";

const server = await serveOverSSE(makeEchoServer(), 4000);
// Now accessible at http://localhost:4000/sse
```

## Development

```bash
# Run tests
cd packages/mcp
bun run test

# Type check
bun run typecheck
```

Tests are in `*.test.ts` files alongside the source. They don't require a database—everything runs in-memory.

## Further Reading

- [MCP Specification](https://modelcontextprotocol.io/)
- [Director Architecture](../../ARCHITECTURE.md)
- [Gateway Integration](../../apps/gateway/README.md)
