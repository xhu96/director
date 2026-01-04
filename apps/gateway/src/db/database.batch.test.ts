import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "../env";
import { Database } from "./database";

/**
 * Tests for batch query methods in Database class.
 *
 * These tests verify the N+1 query optimization methods:
 * - getServersByPlaybookIds()
 * - getPromptsByPlaybookIds()
 */
describe("Database batch query methods", () => {
  let database: Database;

  beforeAll(() => {
    database = Database.create(env.DATABASE_URL);
  });

  afterAll(async () => {
    await database.close();
  });

  describe("getServersByPlaybookIds", () => {
    test("returns empty Map for empty input", async () => {
      const result = await database.getServersByPlaybookIds([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test("returns empty Map for non-existent playbook IDs", async () => {
      const result = await database.getServersByPlaybookIds([
        "non-existent-id-1",
        "non-existent-id-2",
      ]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test("returns Map with servers grouped by playbookId", async () => {
      // This test requires seeded data - skip if no playbooks exist
      const playbooks = await database.getAllPlaybooks("");
      if (playbooks.length === 0) {
        return; // Skip - no test data
      }

      const playbookIds = playbooks.slice(0, 2).map((p) => p.id);
      const result = await database.getServersByPlaybookIds(playbookIds);

      expect(result).toBeInstanceOf(Map);

      // Verify each returned entry has the correct playbookId
      for (const [playbookId, servers] of result) {
        expect(playbookIds).toContain(playbookId);
        for (const server of servers) {
          expect(server.playbookId).toBe(playbookId);
        }
      }
    });
  });

  describe("getPromptsByPlaybookIds", () => {
    test("returns empty Map for empty input", async () => {
      const result = await database.getPromptsByPlaybookIds([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test("returns empty Map for non-existent playbook IDs", async () => {
      const result = await database.getPromptsByPlaybookIds([
        "non-existent-id-1",
        "non-existent-id-2",
      ]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test("returns Map with prompts grouped by playbookId", async () => {
      // This test requires seeded data - skip if no playbooks exist
      const playbooks = await database.getAllPlaybooks("");
      if (playbooks.length === 0) {
        return; // Skip - no test data
      }

      const playbookIds = playbooks.slice(0, 2).map((p) => p.id);
      const result = await database.getPromptsByPlaybookIds(playbookIds);

      expect(result).toBeInstanceOf(Map);

      // Verify each returned entry has the correct playbookId
      for (const [playbookId, prompts] of result) {
        expect(playbookIds).toContain(playbookId);
        for (const prompt of prompts) {
          expect(prompt.playbookId).toBe(playbookId);
        }
      }
    });
  });

  describe("batch vs individual query equivalence", () => {
    test("batch results match individual query results", async () => {
      const playbooks = await database.getAllPlaybooks("");
      if (playbooks.length === 0) {
        return; // Skip - no test data
      }

      const testPlaybook = playbooks[0];

      // Get servers via individual query
      const individualServers = await database.getServers(testPlaybook.id);

      // Get servers via batch query
      const batchResult = await database.getServersByPlaybookIds([
        testPlaybook.id,
      ]);
      const batchServers = batchResult.get(testPlaybook.id) || [];

      // Results should match
      expect(batchServers.length).toBe(individualServers.length);

      // Sort both by name for comparison
      const sortByName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name);
      const sortedIndividual = [...individualServers].sort(sortByName);
      const sortedBatch = [...batchServers].sort(sortByName);

      for (let i = 0; i < sortedIndividual.length; i++) {
        expect(sortedBatch[i].name).toBe(sortedIndividual[i].name);
        expect(sortedBatch[i].playbookId).toBe(sortedIndividual[i].playbookId);
      }
    });
  });
});
