import { expect, test } from "@playwright/test";

/**
 * E2E tests for the login flow.
 *
 * Prerequisites:
 * - Gateway running on port 3673 with test database seeded
 * - Studio running on port 3000
 *
 * Run with: bunx playwright test
 */

test.describe("Login Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh - clear any existing session
    await page.context().clearCookies();
  });

  test("should display login page", async ({ page }) => {
    await page.goto("/login");

    // Verify login form elements are present
    await expect(page.getByRole("heading", { name: /login/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.goto("/login");

    // Enter invalid credentials
    await page.getByLabel(/email/i).fill("invalid@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Expect error message
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 5000 });
  });

  test("should redirect to dashboard after successful login", async ({
    page,
  }) => {
    await page.goto("/login");

    // Enter test credentials (from db:seed)
    await page.getByLabel(/email/i).fill("user@director.run");
    await page.getByLabel(/password/i).fill("password");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should redirect to dashboard/playbooks
    await expect(page).toHaveURL(/\/(dashboard|playbooks)/, { timeout: 10000 });
  });

  test("should persist session across page refreshes", async ({ page }) => {
    // Login first
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("user@director.run");
    await page.getByLabel(/password/i).fill("password");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for redirect
    await expect(page).toHaveURL(/\/(dashboard|playbooks)/, { timeout: 10000 });

    // Refresh and verify still logged in
    await page.reload();
    await expect(page).not.toHaveURL(/login/);
  });
});
