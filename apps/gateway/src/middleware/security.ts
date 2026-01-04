import type { RequestHandler } from "express";

/**
 * Security headers middleware for Director Gateway.
 *
 * Implements OWASP-recommended HTTP security headers without requiring
 * external dependencies like Helmet. This keeps the dependency tree small
 * while providing essential protections.
 *
 * Headers applied:
 * - X-Content-Type-Options: Prevents MIME-sniffing attacks
 * - X-Frame-Options: Blocks clickjacking via iframes
 * - X-XSS-Protection: Disabled (CSP is the modern approach)
 * - Referrer-Policy: Limits referrer leakage to third parties
 * - Permissions-Policy: Restricts access to sensitive browser APIs
 *
 * Note: Content-Security-Policy is intentionally omitted here because
 * the Studio frontend needs its own tailored CSP. Add CSP at the
 * reverse proxy layer (nginx, Cloudflare) for production deployments.
 *
 * @example
 * ```typescript
 * import { securityHeaders } from "./middleware/security";
 *
 * app.use(securityHeaders());
 * ```
 *
 * @see https://owasp.org/www-project-secure-headers/
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    // Prevent browsers from MIME-sniffing the content-type
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Block this site from being embedded in iframes (clickjacking protection)
    res.setHeader("X-Frame-Options", "DENY");

    // X-XSS-Protection is deprecated and can introduce vulnerabilities.
    // Setting to "0" explicitly disables it. Use CSP instead.
    res.setHeader("X-XSS-Protection", "0");

    // Only send referrer for same-origin requests; HTTPS→HTTPS cross-origin
    // gets origin only (no path). Protects against referrer leakage.
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Restrict access to powerful browser features. Director doesn't need
    // camera, mic, geolocation, etc. This is defense in depth.
    res.setHeader(
      "Permissions-Policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
        "magnetometer=(), microphone=(), payment=(), usb=()",
    );

    next();
  };
}
