import { getLogger } from "@director.run/utilities/logger";
import type { RequestHandler } from "express";

const logger = getLogger("Tracing");

/**
 * Request tracing middleware for Director Gateway.
 *
 * This provides basic request tracing without external dependencies.
 * For production OpenTelemetry integration, see the otel.ts file.
 *
 * Features:
 * - Generates unique trace IDs per request
 * - Propagates W3C Trace Context headers if present
 * - Logs request start/end with timing
 * - Adds trace ID to response headers
 *
 * @example
 * ```typescript
 * import { requestTracing } from "./middleware/tracing";
 * app.use(requestTracing());
 * ```
 */
export function requestTracing(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();

    // Use incoming traceparent header or generate new trace ID
    const traceparent = req.headers.traceparent as string | undefined;
    const traceId = extractTraceId(traceparent) || generateTraceId();
    const spanId = generateSpanId();

    // Attach trace context to request for downstream use
    (req as RequestWithTrace).traceId = traceId;
    (req as RequestWithTrace).spanId = spanId;

    // Add trace ID to response headers
    res.setHeader("X-Trace-Id", traceId);

    // Log request start
    logger.debug({
      msg: "request_start",
      traceId,
      spanId,
      method: req.method,
      path: req.path,
    });

    // Capture response
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info({
        msg: "request_end",
        traceId,
        spanId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
      });
    });

    next();
  };
}

/**
 * Extract trace ID from W3C traceparent header.
 * Format: {version}-{trace-id}-{parent-id}-{flags}
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 */
function extractTraceId(traceparent: string | undefined): string | null {
  if (!traceparent) {
    return null;
  }

  const parts = traceparent.split("-");
  if (parts.length >= 2 && parts[1].length === 32) {
    return parts[1];
  }
  return null;
}

/**
 * Generate a random 32-character hex trace ID.
 */
function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a random 16-character hex span ID.
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Extended request type with trace context.
 */
export interface RequestWithTrace extends Express.Request {
  traceId: string;
  spanId: string;
}
