# Contributing to Director Enhanced

Thanks for your interest in contributing. This document covers the basics.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/director-enhanced.git
cd director-enhanced

# Install dependencies (requires Bun 1.3+)
bun install

# Copy env file and configure
cp apps/gateway/env/.env.example apps/gateway/env/.env.development
# Edit .env.development with your database URL

# Run database migrations
bun run db:push

# Start development server
bun run serve:dev
```

## Code Quality

We use [Biome](https://biomejs.dev/) for linting and formatting. Before submitting:

```bash
bun run lint      # Check for issues
bun run format    # Auto-format code
bun run typecheck # Verify types
bun run test      # Run tests
```

Or run everything at once:

```bash
bun run check
```

## Making Changes

1. **Create a branch** from `main` for your feature or fix
2. **Make your changes** with clear, atomic commits
3. **Add tests** if you're adding functionality
4. **Update docs** if you're changing behavior
5. **Run the full check** before pushing

## Commit Messages

We don't enforce a specific format, but good commits:

- Start with a verb (Add, Fix, Update, Remove)
- Are concise but descriptive
- Reference issues when applicable

Examples:

```
Fix N+1 query in PlaybookStore.getAll()
Add security headers middleware
Update DEPLOYMENT.md with Docker Compose example
```

## Pull Requests

- Keep PRs focused on a single concern
- Describe what and why in the PR description
- Link related issues
- Be responsive to review feedback

## Project Structure

```
apps/
├── gateway/     # Backend API server (Express + tRPC)
├── studio/      # Frontend web UI (Next.js)
├── cli/         # Command-line interface
└── ...

packages/
├── mcp/         # MCP SDK extensions
├── utilities/   # Shared helpers
└── ...
```

## Questions?

Open an issue or check the existing documentation:

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Running in production
