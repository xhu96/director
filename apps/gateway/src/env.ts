import path from "path";
import { red } from "@director.run/utilities/cli/colors";
import { isDevelopment, isTest } from "@director.run/utilities/env";
import { createEnv } from "@t3-oss/env-core";
import dotenv from "dotenv";
import { z } from "zod";

// Load environment-specific .env files before validation
// Override is needed because some shells may have empty strings for env vars
if (isTest()) {
  dotenv.config({
    path: path.join(__dirname, "../env/.env.test"),
    override: true,
  });
} else if (isDevelopment()) {
  dotenv.config({
    path: path.join(__dirname, "../env/.env.development"),
    override: true,
  });
}

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    BASE_URL: z.string().url().default("http://localhost:3673"),
    PORT: z
      .string()
      .default("3673")
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().positive()),
    DEBUG: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    REGISTRY_URL: z.string().url().default("https://registry.director.run"),
    REGISTRY_API_KEY: z.string().optional(),
    TELEMETRY_ENABLED: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    TELEMETRY_WRITE_KEY: z.string().default(""),
    WAITLIST_ENABLED: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    BETTER_AUTH_SECRET: z.string(),
    ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((s) => s.split(",").filter(Boolean)),
    DANGEROUSLY_ENABLE_SEEDING: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    SEED_USER_EMAIL: z.string().optional(),
    SEED_USER_PASSWORD: z.string().optional(),
    DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    DANGEROUSLY_ALLOW_INSECURE_HTTP_SERVERS: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
    // API key rate limiting configuration
    API_KEY_RATE_LIMIT_WINDOW_SECONDS: z
      .string()
      .default("60")
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().positive()),
    API_KEY_RATE_LIMIT_MAX_REQUESTS: z
      .string()
      .default("1000")
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().positive()),
    // Redis cache configuration (optional, enables horizontal scaling)
    REDIS_URL: z.string().url().optional(),
    REDIS_CACHE_TTL_SECONDS: z
      .string()
      .default("300")
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().positive()),
    // Database read replica configuration (optional, enables read scaling)
    DATABASE_READ_REPLICA_URL: z.string().url().optional(),
    DATABASE_READ_REPLICA_ENABLED: z
      .string()
      .default("false")
      .transform((s) => s === "true"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

// SECURITY: Block dangerous flags in production environment.
// These flags allow arbitrary command execution and must never be enabled
// in production. Fail fast to prevent accidental security exposure.
if (
  process.env.NODE_ENV === "production" &&
  env.DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS
) {
  throw new Error(
    "FATAL: DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS cannot be enabled in production. " +
      "This flag allows arbitrary command execution on the host system and is a " +
      "critical security vulnerability. Remove this environment variable to start.",
  );
}

if (
  process.env.NODE_ENV === "production" &&
  env.DANGEROUSLY_ALLOW_INSECURE_HTTP_SERVERS
) {
  throw new Error(
    "FATAL: DANGEROUSLY_ALLOW_INSECURE_HTTP_SERVERS cannot be enabled in production. " +
      "This flag allows unencrypted HTTP connections which can expose credentials. " +
      "Remove this environment variable to start.",
  );
}

// Print warning if dangerous stdio mode is enabled (dev/test only at this point)
if (env.DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS) {
  const warningLines = [
    "╔════════════════════════════════════════════════════════╗",
    "║                      WARNING                           ║",
    "╠════════════════════════════════════════════════════════╣",
    "║  DANGEROUSLY_ALLOW_ARBITRARY_STDIO_SERVERS is enabled  ║",
    "║                                                        ║",
    "║  This allows users to execute arbitrary commands on    ║",
    "║  the host system via stdio MCP servers. This is a      ║",
    "║  significant security risk in multi-tenant or          ║",
    "║  production environments.                              ║",
    "║                                                        ║",
    "║  Only enable this for local development or trusted     ║",
    "║  single-user deployments.                              ║",
    "╚════════════════════════════════════════════════════════╝",
  ];
  for (const line of warningLines) {
    console.warn(red(line));
  }
}
