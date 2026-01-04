# API Versioning Strategy

This document outlines Director's approach to API versioning.

## Current State

Director currently does not version its API endpoints. This document establishes the strategy for when breaking changes become necessary.

## Versioning Approach

We use **URL path versioning** for the tRPC API:

```
/trpc/v1/store.getAll    # Version 1
/trpc/v2/store.getAll    # Version 2 (future)
```

This approach was chosen because:

1. **Explicit**: Version is visible in logs and debugging
2. **Compatible**: Works with tRPC's router structure
3. **Standard**: Matches most enterprise API patterns

## Deprecation Policy

When introducing a breaking change:

1. **New version created**: e.g., `/trpc/v2/`
2. **Old version maintained**: for 6 months minimum
3. **Deprecation headers added**: `Deprecation: true` and `Sunset: <date>`
4. **Migration guide published**: in `/apps/docs/`
5. **Old version removed**: after sunset date

## Version Support Matrix

| Version       | Status  | Sunset Date | Notes                   |
| ------------- | ------- | ----------- | ----------------------- |
| v1 (implicit) | Current | N/A         | Current unversioned API |

## Implementation Notes

When implementing versioning:

1. Create `routers/trpc/v1/` and `routers/trpc/v2/` directories
2. Routers share common types but can diverge on schemas
3. Both versions share the same database layer
4. Version-specific middleware can inject deprecation headers

## MCP Endpoint Versioning

MCP endpoints (`/playbooks/{id}/mcp`) follow the MCP protocol version, not Director's API version. Protocol version is negotiated during connection handshake per MCP spec.

## References

- [Stripe API Versioning](https://stripe.com/docs/api/versioning) - Inspiration for header-based fallback
- [GitHub REST API Versioning](https://docs.github.com/en/rest/overview/api-versions) - Date-based approach alternative
- [tRPC Versioning Discussion](https://github.com/trpc/trpc/discussions/2773)
