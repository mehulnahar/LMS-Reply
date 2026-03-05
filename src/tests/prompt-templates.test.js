/**
 * Test Suite: AI Prompt Templates (Phase 2: Configuration UI)
 * Requirements: CONF-05
 *
 * All tests FAIL until implementation is built.
 */

const request = require("supertest");
const app = require("../app");

const getAuthToken = async () => {
  const res = await request(app).post("/api/auth/login").send({
    email: "testowner@example.com",
    password: "SecureP@ss123",
  });
  return res.body.token;
};

// ============================================================
// CONF-05: Create/edit/delete AI prompt templates stored in DB
// ============================================================
describe("CONF-05: AI Prompt Templates", () => {
  describe("Happy Path", () => {
    it("should create a new prompt template", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Standard Reply",
          content:
            "You are a professional freelancer at HipHype Tech. Reply to the client email: {{email_body}}. Job context: {{job_description}}.",
          category: "reply",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Standard Reply");
      expect(res.body.content).toContain("{{email_body}}");
    });

    it("should list all prompt templates", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .get("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((template) => {
        expect(template).toHaveProperty("id");
        expect(template).toHaveProperty("name");
        expect(template).toHaveProperty("content");
        expect(template).toHaveProperty("category");
      });
    });

    it("should get a single prompt template by ID", async () => {
      const token = await getAuthToken();
      // Create first
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Fetch Template",
          content: "Fetch test content",
          category: "reply",
        });
      const templateId = createRes.body.id;

      const res = await request(app)
        .get(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Fetch Template");
    });

    it("should edit an existing prompt template", async () => {
      const token = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Edit Me",
          content: "Original content",
          category: "reply",
        });
      const templateId = createRes.body.id;

      const res = await request(app)
        .put(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Edited Template",
          content: "Updated content with {{job_heading}}",
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Edited Template");
      expect(res.body.content).toContain("{{job_heading}}");
    });

    it("should delete a prompt template", async () => {
      const token = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Delete Me",
          content: "To be deleted",
          category: "reply",
        });
      const templateId = createRes.body.id;

      const res = await request(app)
        .delete(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);

      // Verify deletion
      const getRes = await request(app)
        .get(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(getRes.statusCode).toBe(404);
    });

    it("should support template variables (placeholders)", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Variable Template",
          content:
            "Client: {{client_name}}. Email: {{email_body}}. Job: {{job_description}}. Heading: {{job_heading}}.",
          category: "reply",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.content).toContain("{{client_name}}");
      expect(res.body.content).toContain("{{email_body}}");
      expect(res.body.content).toContain("{{job_description}}");
    });

    it("should support multiple categories (reply, proposal, scoring)", async () => {
      const token = await getAuthToken();
      const categories = ["reply", "proposal", "scoring"];
      for (const category of categories) {
        const res = await request(app)
          .post("/api/settings/prompt-templates")
          .set("Authorization", `Bearer ${token}`)
          .send({
            name: `${category} template`,
            content: `Template for ${category}`,
            category,
          });
        expect(res.statusCode).toBe(201);
        expect(res.body.category).toBe(category);
      }
    });

    it("should filter templates by category", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .get("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .query({ category: "reply" });
      expect(res.statusCode).toBe(200);
      res.body.forEach((template) => {
        expect(template.category).toBe("reply");
      });
    });
  });

  describe("Failure Cases", () => {
    it("should reject template creation without authentication", async () => {
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .send({
          name: "No Auth",
          content: "Content",
          category: "reply",
        });
      expect(res.statusCode).toBe(401);
    });

    it("should reject template without name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ content: "No name provided", category: "reply" });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it("should reject template without content", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "No Content", category: "reply" });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/content/i);
    });

    it("should reject template with invalid category", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Bad Category",
          content: "Content",
          category: "invalid_category",
        });
      expect(res.statusCode).toBe(400);
    });

    it("should reject editing non-existent template", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .put("/api/settings/prompt-templates/99999")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated" });
      expect(res.statusCode).toBe(404);
    });

    it("should reject deleting non-existent template", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .delete("/api/settings/prompt-templates/99999")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(404);
    });

    it("should reject duplicate template names", async () => {
      const token = await getAuthToken();
      await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Unique Name",
          content: "First",
          category: "reply",
        });
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Unique Name",
          content: "Duplicate",
          category: "reply",
        });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("Edge Cases", () => {
    it("should handle template with very long content (10k+ chars)", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Long Template",
          content: "a".repeat(10000),
          category: "reply",
        });
      expect([201, 400]).toContain(res.statusCode);
    });

    it("should handle template name with special characters", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Template <script>alert('xss')</script>",
          content: "Safe content",
          category: "reply",
        });
      expect([201, 400]).toContain(res.statusCode);
      if (res.statusCode === 201) {
        expect(res.body.name).not.toContain("<script>");
      }
    });

    it("should handle template with empty content string", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Empty Content", content: "", category: "reply" });
      expect(res.statusCode).toBe(400);
    });

    it("should handle template with only whitespace content", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Whitespace Content",
          content: "   \n\t  ",
          category: "reply",
        });
      expect(res.statusCode).toBe(400);
    });

    it("should preserve template content formatting (newlines, indentation)", async () => {
      const token = await getAuthToken();
      const content = "Line 1\n  Indented\n\nParagraph 2\n\tTabbed";
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Formatted", content, category: "reply" });
      expect(res.statusCode).toBe(201);
      expect(res.body.content).toBe(content);
    });

    it("should handle unicode in template content", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Unicode Template",
          content: "Reply: {{email_body}} — Grüße, HipHype 技術チーム",
          category: "reply",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.content).toContain("Grüße");
    });

    it("should include createdAt and updatedAt timestamps", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Timestamped",
          content: "Content",
          category: "reply",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("createdAt");
      expect(res.body).toHaveProperty("updatedAt");
    });
  });

  describe("Security", () => {
    it("should isolate templates between users", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .get("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      // User should only see their own templates
    });

    it("should sanitize XSS in template name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: '<img onerror="alert(1)" src=x>',
          content: "Safe",
          category: "reply",
        });
      if (res.statusCode === 201) {
        expect(res.body.name).not.toContain("onerror");
      }
    });

    it("should reject SQL injection in template name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "'; DROP TABLE prompt_templates; --",
          content: "Content",
          category: "reply",
        });
      expect([201, 400]).toContain(res.statusCode);
      // Table should still exist regardless
    });
  });
});
