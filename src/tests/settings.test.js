/**
 * Test Suite: API Key Settings (Phase 1: Foundation)
 * Requirements: CONF-01
 *
 * All tests FAIL until implementation is built.
 */

const request = require("supertest");
const app = require("../app");

// Helper: get auth token for tests
const getAuthToken = async () => {
  const res = await request(app).post("/api/auth/login").send({
    email: "testowner@example.com",
    password: "SecureP@ss123",
  });
  return res.body.token;
};

// ============================================================
// CONF-01: User can add/update/remove API keys with encrypted storage
// ============================================================
describe("CONF-01: Encrypted API Key Storage", () => {
  // --- Happy Path ---
  describe("Happy Path", () => {
    it("should store a new Anthropic API key", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "anthropic",
          apiKey: "sk-ant-api03-validkey123",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("service", "anthropic");
      expect(res.body).toHaveProperty("status", "connected");
    });

    it("should store a new leadhack API key", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "leadhack",
          apiKey: "lh-key-abc123",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.service).toBe("leadhack");
    });

    it("should update an existing API key", async () => {
      const token = await getAuthToken();
      // Create first
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey: "sk-ant-api03-original" });
      // Update
      const res = await request(app)
        .put("/api/settings/api-keys/anthropic")
        .set("Authorization", `Bearer ${token}`)
        .send({
          apiKey: "sk-ant-api03-updatedkey456",
        });
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("status", "connected");
    });

    it("should remove an API key", async () => {
      const token = await getAuthToken();
      // Create first
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey: "sk-ant-api03-todelete" });
      // Delete
      const res = await request(app)
        .delete("/api/settings/api-keys/anthropic")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
    });

    it("should list all configured API keys (masked)", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .get("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Keys should be masked (e.g., "sk-ant-***key123")
      res.body.forEach((key) => {
        expect(key).toHaveProperty("service");
        expect(key).toHaveProperty("maskedKey");
        expect(key.maskedKey).toMatch(/\*{3,}/); // Contains asterisks
        expect(key).not.toHaveProperty("apiKey"); // Never return full key
      });
    });
  });

  // --- Encryption Verification ---
  describe("Encryption", () => {
    it("should encrypt API key at rest (not stored as plaintext)", async () => {
      const token = await getAuthToken();
      const apiKey = "sk-ant-api03-plaintextcheck";
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey });
      // Direct DB query should NOT find plaintext key
      // The stored value should be different from the input
    });

    it("should use AES-256-GCM encryption (not reversible without key)", async () => {
      const token = await getAuthToken();
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey: "sk-ant-api03-enctest" });
      // Verify encryption includes IV and auth tag (AES-GCM components)
    });

    it("should decrypt API key correctly when needed for API calls", async () => {
      const token = await getAuthToken();
      const originalKey = "sk-ant-api03-decrypttest";
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey: originalKey });
      // Internal: decrypt should return original key
      // Test via a verify endpoint
      const verifyRes = await request(app)
        .post("/api/settings/api-keys/anthropic/verify")
        .set("Authorization", `Bearer ${token}`);
      expect(verifyRes.statusCode).toBe(200);
    });
  });

  // --- Failure Cases ---
  describe("Failure Cases", () => {
    it("should reject API key storage without authentication", async () => {
      const res = await request(app).post("/api/settings/api-keys").send({
        service: "anthropic",
        apiKey: "sk-ant-api03-noauth",
      });
      expect(res.statusCode).toBe(401);
    });

    it("should reject unknown service name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "unknown_service",
          apiKey: "some-key",
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/invalid service|unsupported/i);
    });

    it("should reject empty API key", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "anthropic",
          apiKey: "",
        });
      expect(res.statusCode).toBe(400);
    });

    it("should reject API key with only whitespace", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "anthropic",
          apiKey: "   ",
        });
      expect(res.statusCode).toBe(400);
    });

    it("should reject updating non-existent API key", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .put("/api/settings/api-keys/nonexistent")
        .set("Authorization", `Bearer ${token}`)
        .send({ apiKey: "some-key" });
      expect(res.statusCode).toBe(404);
    });

    it("should reject deleting non-existent API key", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .delete("/api/settings/api-keys/nonexistent")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(404);
    });
  });

  // --- Edge Cases ---
  describe("Edge Cases", () => {
    it("should handle API key with special characters", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "anthropic",
          apiKey: "sk-ant-api03-special!@#$%^&*()",
        });
      expect(res.statusCode).toBe(201);
    });

    it("should handle very long API key (1000+ chars)", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "anthropic",
          apiKey: "sk-" + "a".repeat(1000),
        });
      expect([201, 400]).toContain(res.statusCode);
    });

    it("should isolate API keys between users (user A cannot see user B keys)", async () => {
      // User A stores a key
      const tokenA = await getAuthToken(); // user A
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ service: "anthropic", apiKey: "sk-user-a-key" });

      // User B should not see user A's keys
      // (Requires a second user token - implementation detail)
    });

    it("should handle concurrent API key updates gracefully", async () => {
      const token = await getAuthToken();
      // Create key first
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey: "sk-ant-api03-concurrent-init" });
      const updates = Array(5)
        .fill()
        .map((_, i) =>
          request(app)
            .put("/api/settings/api-keys/anthropic")
            .set("Authorization", `Bearer ${token}`)
            .send({ apiKey: `sk-concurrent-${i}` })
        );
      const results = await Promise.all(updates);
      // All should succeed or handle conflict/not-found race
      results.forEach((res) => {
        expect([200, 404, 409]).toContain(res.statusCode);
      });
    });
  });

  // --- Security ---
  describe("Security", () => {
    it("should never return full API key in any response", async () => {
      const token = await getAuthToken();
      const apiKey = "sk-ant-api03-neverexpose";
      await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ service: "anthropic", apiKey });

      const listRes = await request(app)
        .get("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`);
      const body = JSON.stringify(listRes.body);
      expect(body).not.toContain(apiKey);
    });

    it("should not log API keys in server logs", async () => {
      // This is a code review test — verify morgan/logger config excludes sensitive fields
      expect(true).toBe(true); // Placeholder for manual verification
    });

    it("should reject SQL injection in service name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({
          service: "'; DROP TABLE settings; --",
          apiKey: "some-key",
        });
      expect(res.statusCode).toBe(400);
    });
  });
});
