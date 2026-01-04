<h1 align="center">Director Enhanced (Redis)</h1>
<p align="center">MCP Playbooks for AI agents</p>
<p align="center"><em>Enhanced fork with Redis caching for horizontal scaling</em></p>

<p align="center">
  <a href="./DEPLOYMENT.md"><strong>Read the Deployment Guide »</strong></a> OR 
  <a href="./CONTRIBUTING.md"><strong>Start Contributing »</strong></a>
</p>

> [!WARNING] > **Experimental Version**: This is an enhanced fork of Director implementing horizontal scaling patterns (Redis, Read Replicas). While functionally complete, it has not yet been fully battle-tested in large-scale production environments. Use with caution.

---

> **📋 Redis-Enabled Fork** - This fork adds:
>
> - 🔄 **Redis cache with pub/sub invalidation** for horizontal scaling
> - 🔒 Security headers middleware (OWASP-compliant)
> - 🛡️ Production guards blocking dangerous flags
> - 📖 [Architecture deep-dive](./ARCHITECTURE.md)
> - 🚀 [Deployment guide](./DEPLOYMENT.md)
> - ✅ N+1 query optimization with batch methods
>
> Upstream: [director-run/director](https://github.com/director-run/director)

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![ci](https://github.com/director-run/director/workflows/CI/badge.svg)](https://github.com/director-run/director/actions/workflows/ci.yml)
[![Release](https://github.com/director-run/director/workflows/Release/badge.svg)](https://github.com/director-run/director/actions/workflows/release.yml)

</div>

# Overview

Director allows you to provide <ins>**playbooks**</ins> to AI Agents. A playbook is a set of <ins>**MCP tools**</ins>, <ins>**prompts**</ins> and <ins>**configuration**</ins>, that give agents new <ins>**skills**</ins>. You can connect Claude, Cursor and VSCode in 1-click, or integrate manually through a single MCP endpoint.

Playbooks are portable and can easily be switched in and out of context. Director is local-first - setup and client integration takes 30 seconds. In addition, Director provides all of the MCP management functionality that you'd expect: tool filtering, logging, strong isolation, and unified OAuth.

<br />

https://github.com/user-attachments/assets/cafc0902-a854-4ee8-ac89-b7535f10c93d

## Key Features

- 📚 **Playbooks** - Maintain sets of tools, prompts and config for different tasks or environments.
- 🚀 **1-Click Integration** - Switch playbooks with a single click. Currently supports Claude Code, Claude Desktop, Cursor, VSCode
- 🔗 **Shareable** - Playbooks are accessible through a single MCP endpoint, making them easy to share across agents.
- 🏠 **Local-First** - Director is local-first, designed to easily run on your own machine or infrastructure.
- 🔑 **Unified OAuth** - Connect to OAuth MCPs centrally, and use them across all of your agents.
- 🎯 **Tool Filtering** - Select only the MCP tools that are required for the specific task, preserving context.
- 📊 **Observability** - Centralized JSON logging, that allows you to understand exactly what your agent is doing.
- 🔌 **MCP Compliant** - Just works with any MCP server or client. Up to date with the latest MCP spec.

# Quickstart

```bash
# Install dependencies
bun install

# Start the gateway (with Redis if configured)
bun run serve
```

# Core Concepts

## Playbooks

A playbook is a set of tools, prompts and configuration, used to provide specific capabilities to your agent. Under the hood, playbooks are built on top of the MCP tools & prompts primitives.

The easiest way to author a playbook is via the UI (`director studio`). But you can also use the CLI. You can have many playbooks, typically one per task or per environment. You can connect to them via a single CLI command or directly over a URL.

## Architecture

At a high level, Director is a service that sits between your agents and MCP servers. It's transparent to clients, requiring no additional tokens. It models playbooks, which can be thought of as standalone, portable skills that enhance your AI agent with new capabilities.

<img src="https://github.com/director-run/director/blob/main/apps/docs/images/director-highlevel-overview.png" width="100%" alt="director demo">

# Usage

## Installation

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup or [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment.

```bash
# Clone the repo
git clone https://github.com/xhu96/director.git
cd director

# Install dependencies
bun install

# Start the server
bun run serve
```

## The Studio (Web UI)

The simplest way to interact with director is via the admin interface:

```bash
# Open studio in your browser
$ director studio
```

## CLI Reference

```bash
Playbooks for your AI agent

USAGE
  director <command> [subcommand] [flags]

CORE COMMANDS
   quickstart                                    Start the gateway and open the studio in your browser
   serve                                         Start the web service
   studio                                        Open the UI in your browser
   ls                                            List playbooks
   get <playbookId> [serverName]                 Show playbook details
   auth <playbookId> <server>                    Authenticate a server
   create <name>                                 Create a new playbook
   destroy <playbookId>                          Delete a playbook
   connect <playbookId> [options]                Connect a playbook to a MCP client
   disconnect <playbookId> [options]             Disconnect a playbook from an MCP client
   add <playbookId> [options]                    Add a server to a playbook.
   remove <playbookId> <serverName>              Remove a server from a playbook
   update <playbookId> [serverName] [options]    Update playbook attributes
   http2stdio <url>                              Proxy an HTTP connection (sse or streamable) to a stdio stream
   env [options]                                 Print environment variables
   status                                        Get the status of the director

REGISTRY
   registry ls                                   List all available servers in the registry
   registry get <entryName>                      Get detailed information about a registry item
   registry readme <entryName>                   Print the readme for a registry item

MCP
   mcp list-tools <playbookId>                   List tools on a playbook
   mcp get-tool <playbookId> <toolName>          Get the details of a tool
   mcp call-tool <playbookId> <toolName> [options]  Call a tool on a playbook

PROMPTS
   prompts ls <playbookId>                       List all prompts for a playbook
   prompts add <playbookId>                      Add a new prompt to a playbook
   prompts edit <playbookId> <promptName>        Edit an existing prompt
   prompts remove <playbookId> <promptName>      Remove a prompt from a playbook
   prompts get <playbookId> <promptName>         Show the details of a specific prompt

FLAGS
   -V, --version                                 output the version number

EXAMPLES
  $ director create my-playbook # Create a new playbook
  $ director add my-playbook --entry fetch # Add a server to a playbook
  $ director connect my-playbook --target claude # Connect my-playbook to claude

```

### TypeScript SDK

Programmatic control for advanced use cases:

```typescript
import { Gateway, GatewayConfig } from "@director.run/sdk";

// Start the gateway
const gateway = await Gateway.start({
  config: await GatewayConfig.createMemoryBasedConfig({
    defaults: {
      server: {
        port: 3673,
      },
    },
  }),
  baseUrl: "http://localhost:3673",
});

// Add a new playbook
await gateway.playbookStore.create({
  name: "test",
  servers: [
    {
      name: "notion",
      type: "http",
      url: "https://mcp.notion.com/mcp",
    },
  ],
});
```

# Repository Structure

### External Apps

### External Apps

- [`apps/gateway`](./apps/gateway/README.md) - Core gateway and playbook logic
- [`apps/cli`](./apps/cli/README.md) - The command-line interface
- [`apps/sdk`](./apps/sdk/README.md) - The Typescript SDK
- [`apps/docker`](./apps/docker/README.md) - Docker configuration
- [`apps/docs`](./apps/docs/README.md) - Project documentation
- [`apps/registry`](./apps/registry/README.md) - Registry backend service
- [`apps/studio`](./apps/studio/README.md) - Director frontend application

### Internal Packages

- [`packages/client-configurator`](./packages/client-configurator/README.md) - Library for managing MCP client configuration files
- [`packages/mcp`](./packages/mcp/README.md) - Extensions to MCP SDK that add middleware functionality
- [`packages/utilities`](./packages/utilities/README.md) - Shared utilities used across all packages and apps
- [`packages/design`](./packages/design/README.md) - Design system: reusable UI components, hooks, and styles for all Director apps

_This is a monorepo managed by [Turborepo](https://turbo.build/)._

# Community

If you're using director, have any ideas, or just want to chat about MCP, we'd love to chat:

- 💬 Join our [Discord](https://discord.gg/kWZGvWks)

- 🐛 Report a [Bug](https://github.com/director-run/director/issues)
- 🐦 Follow us on [X / Twitter](https://x.com/barnabymalet)

# Contributing

We welcome contributions! See [CONTRIBUTING.mdx](./apps/docs/project/contributing.mdx) for guidelines.

## Setting up Development Environment

```bash
# Fork and clone
git clone https://github.com/director_run/director
cd director
./scripts/setup-development.sh
bun run test
```

# License

AGPL v3 - See [LICENSE](./LICENSE) for details.
