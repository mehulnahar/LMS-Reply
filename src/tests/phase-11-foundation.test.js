/**
 * Test Suite: Phase 11 — DB + Prompt Foundation
 * Requirements: DB-01, DB-02, DB-03, DB-04, DB-05, PROMPT-01
 *
 * Tests the v2.0 database schema migration and foundation data.
 * Covers: positive paths, negative/constraint paths, and edge cases.
 */

const request = require("supertest");
const app = require("../app");
const pool = require("../config/db");
const { run: runSeed } = require("../config/seeds/seed_v2_foundation");

// ============================================================
// Test Helpers
// ============================================================
const getAuthToken = async () => {
  const res = await request(app).post("/api/auth/login").send({
    email: "testowner@example.com",
    password: "SecureP@ss123",
  });
  return res.body.token;
};

// ============================================================
// PHASE 11 SETUP: Seed all v2 foundation data via seed script
// (idempotent — safe to run even if some data already exists)
// ============================================================
beforeAll(async () => {
  await runSeed().catch(() => {});
});

// ============================================================
// DB-01: jobs table v2.0 column existence
// ============================================================
describe("DB-01: jobs table v2.0 columns", () => {
  it("(Positive) should have all v2.0 required columns on jobs table", async () => {
    const { rows } = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'jobs'
      ORDER BY column_name
    `);
    const columnNames = rows.map((r) => r.column_name);

    const requiredColumns = [
      "job_description_raw",
      "job_analysis_json",
      "link_analysis_json",
      "objection_detected",
      "follow_up_count",
      "follow_up_1_angle",
      "follow_up_2_angle",
      "agency_sensitive",
      "client_scope_framing",
      "client_message_length",
      "re_engagement_strategy",
      "mockup_sent",
      "mockup_lovable_prompt",
      "post_call_recap_sent",
      "thread_stage",
      "thread_depth",
      "thread_client_messages",
      "last_prompt_used",
      "next_step_ours",
      "next_step_theirs",
      "next_step_followup_date",
      "next_step_approach",
      "cc_contacts",
    ];

    for (const col of requiredColumns) {
      expect(columnNames).toContain(col);
    }
  });

  it("(Positive) follow_up_count should default to 0", async () => {
    const { rows } = await pool.query(`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'jobs' AND column_name = 'follow_up_count'
    `);
    expect(rows[0].column_default).toBe("0");
  });

  it("(Positive) mockup_sent should default to false", async () => {
    const { rows } = await pool.query(`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'jobs' AND column_name = 'mockup_sent'
    `);
    expect(rows[0].column_default).toBe("false");
  });
});

// ============================================================
// DB-02: banned_phrases table
// ============================================================
describe("DB-02: banned_phrases table", () => {
  it("(Positive) table should exist with required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'banned_phrases'
      ORDER BY column_name
    `);
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("phrase");
    expect(columns).toContain("category");
    expect(columns).toContain("replacement_suggestion");
    expect(columns).toContain("active");
  });

  it("(Positive) should have 40+ active banned phrases seeded", async () => {
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM banned_phrases WHERE active = true"
    );
    expect(parseInt(rows[0].count, 10)).toBeGreaterThanOrEqual(40);
  });

  it("(Positive) should have all 8 categories represented", async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT category FROM banned_phrases WHERE active = true ORDER BY category"
    );
    const categories = rows.map((r) => r.category);
    const expectedCategories = [
      "ASSUMPTION",
      "CORPORATE",
      "ENTHUSIASM",
      "FILLER",
      "FOLLOWUP",
      "GUILT",
      "PASSIVE",
      "SELF_FOCUSED",
    ];
    for (const cat of expectedCategories) {
      expect(categories).toContain(cat);
    }
  });

  it("(Negative) should reject insert with invalid category enum", async () => {
    await expect(
      pool.query(
        `INSERT INTO banned_phrases (phrase, category) VALUES ('test invalid', 'RANDOM'::banned_phrase_category_enum)`
      )
    ).rejects.toThrow();
  });

  it("(Negative) should reject duplicate phrases", async () => {
    // First insert succeeds
    await pool
      .query(
        `INSERT INTO banned_phrases (phrase, category) VALUES ('test_unique_phrase_99', 'FILLER'::banned_phrase_category_enum)`
      )
      .catch(() => {});

    // Second insert with same phrase should fail
    await expect(
      pool.query(
        `INSERT INTO banned_phrases (phrase, category) VALUES ('test_unique_phrase_99', 'CORPORATE'::banned_phrase_category_enum)`
      )
    ).rejects.toThrow();

    // Cleanup
    await pool
      .query("DELETE FROM banned_phrases WHERE phrase = 'test_unique_phrase_99'")
      .catch(() => {});
  });
});

// ============================================================
// DB-03: counter_moves table
// ============================================================
describe("DB-03: counter_moves table", () => {
  it("(Positive) table should exist with required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'counter_moves'
      ORDER BY column_name
    `);
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("objection_type");
    expect(columns).toContain("objection_pattern");
    expect(columns).toContain("counter_move_name");
    expect(columns).toContain("counter_move_template");
    expect(columns).toContain("max_words");
    expect(columns).toContain("active");
  });

  it("(Positive) should have 10+ counter-moves seeded", async () => {
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM counter_moves WHERE active = true"
    );
    expect(parseInt(rows[0].count, 10)).toBeGreaterThanOrEqual(10);
  });

  it("(Positive) each counter-move should have a max_words value > 0", async () => {
    const { rows } = await pool.query(
      "SELECT id, max_words FROM counter_moves WHERE active = true"
    );
    for (const row of rows) {
      expect(row.max_words).toBeGreaterThan(0);
    }
  });

  it("(Positive) should have a PRICING objection type counter-move", async () => {
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM counter_moves WHERE objection_type = 'PRICING'::objection_type_enum"
    );
    expect(parseInt(rows[0].count, 10)).toBeGreaterThanOrEqual(1);
  });

  it("(Positive) should have a TECHNICAL_Q counter-move with max_words >= 80", async () => {
    const { rows } = await pool.query(
      "SELECT max_words FROM counter_moves WHERE objection_type = 'TECHNICAL_Q'::objection_type_enum"
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].max_words).toBeGreaterThanOrEqual(80);
  });
});

// ============================================================
// DB-04: reply_generations table
// ============================================================
describe("DB-04: reply_generations table", () => {
  it("(Positive) table should exist with required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'reply_generations'
      ORDER BY column_name
    `);
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("lead_id");
    expect(columns).toContain("prompt_used");
    expect(columns).toContain("thread_stage_detected");
    expect(columns).toContain("thread_depth_at_gen");
    expect(columns).toContain("variant_selected");
    expect(columns).toContain("was_edited");
    expect(columns).toContain("was_sent");
    expect(columns).toContain("had_next_step");
    expect(columns).toContain("banned_phrases_caught");
    expect(columns).toContain("word_count");
    expect(columns).toContain("generated_at");
    expect(columns).toContain("sent_at");
  });

  it("(Negative) should reject insert with non-existent lead_id (FK violation)", async () => {
    const fakeLeadId = "00000000-0000-0000-0000-000000000000";
    await expect(
      pool.query(
        `INSERT INTO reply_generations (lead_id, prompt_used)
         VALUES ($1, 'EMAIL_REPLY_V2'::prompt_type_enum)`,
        [fakeLeadId]
      )
    ).rejects.toThrow();
  });
});

// ============================================================
// DB-05: next_steps table
// ============================================================
describe("DB-05: next_steps table", () => {
  it("(Positive) table should exist with required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'next_steps'
      ORDER BY column_name
    `);
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("lead_id");
    expect(columns).toContain("reply_generation_id");
    expect(columns).toContain("our_action");
    expect(columns).toContain("our_deadline");
    expect(columns).toContain("their_action");
    expect(columns).toContain("followup_date");
    expect(columns).toContain("followup_approach");
    expect(columns).toContain("status");
    expect(columns).toContain("created_at");
    expect(columns).toContain("completed_at");
  });

  it("(Positive) status should default to PENDING", async () => {
    const { rows } = await pool.query(`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'next_steps' AND column_name = 'status'
    `);
    expect(rows[0].column_default).toContain("PENDING");
  });

  it("(Negative) should reject insert with non-existent lead_id (FK violation)", async () => {
    const fakeLeadId = "00000000-0000-0000-0000-000000000000";
    await expect(
      pool.query(
        `INSERT INTO next_steps (lead_id, our_action)
         VALUES ($1, 'Test action')`,
        [fakeLeadId]
      )
    ).rejects.toThrow();
  });
});

// ============================================================
// PROMPT-01: Prompt Templates (via API)
// ============================================================
describe("PROMPT-01: Prompt Templates CRUD (via API)", () => {
  describe("(Positive) Create and retrieve", () => {
    it("should create a new reply prompt template", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Reply Template",
          content: "You are Ashish. Reply to: {{email_body}}",
          category: "reply",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test Reply Template");
      expect(res.body.category).toBe("reply");
    });

    it("should list all prompt templates", async () => {
      const token = await getAuthToken();

      // Create first
      await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "List Test Template A",
          content: "Content A",
          category: "reply",
        });

      const res = await request(app)
        .get("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((t) => t.name === "List Test Template A")).toBe(true);
    });

    it("should retrieve a single template by ID", async () => {
      const token = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Get By ID Template",
          content: "Specific content",
          category: "proposal",
        });
      const templateId = createRes.body.id;

      const res = await request(app)
        .get(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Get By ID Template");
      expect(res.body.content).toBe("Specific content");
    });

    it("should return createdAt and updatedAt timestamps", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Timestamp Template",
          content: "Content with timestamps",
          category: "reply",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("createdAt");
      expect(res.body).toHaveProperty("updatedAt");
      expect(new Date(res.body.createdAt).getTime()).not.toBeNaN();
    });

    it("should filter templates by category", async () => {
      const token = await getAuthToken();
      await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cat Filter Reply", content: "reply content", category: "reply" });
      await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cat Filter Proposal", content: "proposal content", category: "proposal" });

      const res = await request(app)
        .get("/api/settings/prompt-templates?category=reply")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      res.body.forEach((t) => {
        expect(t.category).toBe("reply");
      });
    });

    it("should preserve formatting (newlines, indentation)", async () => {
      const token = await getAuthToken();
      const content = "Line 1\n  Indented line\n\nParagraph 2\n\tTabbed";
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Formatting Template", content, category: "reply" });
      expect(res.statusCode).toBe(201);
      expect(res.body.content).toBe(content);
    });

    it("should create a template with a v2.0 prompt_type", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Email Reply V2 Custom",
          content: "Custom version of email reply prompt",
          category: "reply",
          prompt_type: "EMAIL_REPLY_V2",
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.promptType).toBe("EMAIL_REPLY_V2");
    });
  });

  describe("(Positive) Update", () => {
    it("should update an existing template name and content", async () => {
      const token = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "To Be Updated", content: "Original", category: "reply" });
      const templateId = createRes.body.id;

      const res = await request(app)
        .put(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated Name", content: "Updated content" });
      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Updated Name");
      expect(res.body.content).toBe("Updated content");
    });

    it("should bump version number when content is updated", async () => {
      const token = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Version Bump Test", content: "v1 content", category: "reply" });
      const templateId = createRes.body.id;
      const v1 = createRes.body.version;

      const updateRes = await request(app)
        .put(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ content: "v2 content" });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.version).toBe(v1 + 1);
    });
  });

  describe("(Positive) Delete", () => {
    it("should delete a template and confirm it returns 404 after", async () => {
      const token = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "To Be Deleted", content: "Delete me", category: "reply" });
      const templateId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(deleteRes.statusCode).toBe(200);

      const getRes = await request(app)
        .get(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(getRes.statusCode).toBe(404);
    });
  });

  describe("(Negative) Validation failures", () => {
    it("should reject creation without authentication", async () => {
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .send({ name: "No Auth", content: "Content", category: "reply" });
      expect(res.statusCode).toBe(401);
    });

    it("should reject template without name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ content: "No name", category: "reply" });
      expect(res.statusCode).toBe(400);
    });

    it("should reject template without content", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "No content", category: "reply" });
      expect(res.statusCode).toBe(400);
    });

    it("should reject template with empty content string", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Empty Content", content: "", category: "reply" });
      expect(res.statusCode).toBe(400);
    });

    it("should reject template with whitespace-only content", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Whitespace Only", content: "   \n\t  ", category: "reply" });
      expect(res.statusCode).toBe(400);
    });

    it("should reject template with invalid category", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Bad Cat", content: "Content", category: "invalid_category" });
      expect(res.statusCode).toBe(400);
    });

    it("should reject duplicate template names (same user)", async () => {
      const token = await getAuthToken();
      await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Dup Check Name", content: "First", category: "reply" });

      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Dup Check Name", content: "Duplicate", category: "reply" });
      expect(res.statusCode).toBe(409);
    });

    it("should return 404 when editing a non-existent template", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .put("/api/settings/prompt-templates/99999")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated" });
      expect(res.statusCode).toBe(404);
    });

    it("should return 404 when deleting a non-existent template", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .delete("/api/settings/prompt-templates/99999")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(404);
    });

    it("should not allow access to another user's templates", async () => {
      const ownerToken = await getAuthToken();
      const createRes = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Owner Only", content: "Private", category: "reply" });
      const templateId = createRes.body.id;

      // VA user tries to access owner's template
      const vaLoginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "va@example.com", password: "SecureP@ss123" });
      const vaToken = vaLoginRes.body.token;

      const res = await request(app)
        .get(`/api/settings/prompt-templates/${templateId}`)
        .set("Authorization", `Bearer ${vaToken}`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe("(Edge Cases)", () => {
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
      // Should succeed (no hardcoded length limit)
      expect([200, 201]).toContain(res.statusCode);
    });

    it("should sanitize XSS in template name", async () => {
      const token = await getAuthToken();
      const res = await request(app)
        .post("/api/settings/prompt-templates")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Template <script>alert('xss')</script> Name",
          content: "Safe content",
          category: "reply",
        });
      if (res.statusCode === 201) {
        expect(res.body.name).not.toContain("<script>");
      } else {
        expect(res.statusCode).toBe(400);
      }
    });
  });
});

// ============================================================
// Banned Phrases API endpoint (DB-02 via API)
// ============================================================
describe("Banned Phrases API — GET /api/settings/banned-phrases", () => {
  it("(Positive) should return 40+ active banned phrases", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/banned-phrases")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(40);
  });

  it("(Positive) each phrase should have id, phrase, category, active fields", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/banned-phrases")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    res.body.forEach((item) => {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("phrase");
      expect(item).toHaveProperty("category");
      expect(item).toHaveProperty("active");
    });
  });

  it("(Positive) should filter by CORPORATE category", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/banned-phrases?category=CORPORATE")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    res.body.forEach((item) => {
      expect(item.category).toBe("CORPORATE");
    });
  });

  it("(Negative) should return 401 without authentication", async () => {
    const res = await request(app).get("/api/settings/banned-phrases");
    expect(res.statusCode).toBe(401);
  });
});

// ============================================================
// Counter Moves API endpoint (DB-03 via API)
// ============================================================
describe("Counter Moves API — GET /api/settings/counter-moves", () => {
  it("(Positive) should return 10+ active counter-moves", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/counter-moves")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(10);
  });

  it("(Positive) each counter-move should have required fields", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/counter-moves")
      .set("Authorization", `Bearer ${token}`);
    res.body.forEach((item) => {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("objectionType");
      expect(item).toHaveProperty("objectionPattern");
      expect(item).toHaveProperty("counterMoveName");
      expect(item).toHaveProperty("counterMoveTemplate");
      expect(item).toHaveProperty("maxWords");
      expect(item.maxWords).toBeGreaterThan(0);
    });
  });

  it("(Positive) should filter by PRICING objection type", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/counter-moves?objection_type=PRICING")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    res.body.forEach((item) => {
      expect(item.objectionType).toBe("PRICING");
    });
  });

  it("(Positive) AGENCY counter-move max_words should be >= 40", async () => {
    const token = await getAuthToken();
    const res = await request(app)
      .get("/api/settings/counter-moves?objection_type=AGENCY")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].maxWords).toBeGreaterThanOrEqual(40);
  });

  it("(Negative) should return 401 without authentication", async () => {
    const res = await request(app).get("/api/settings/counter-moves");
    expect(res.statusCode).toBe(401);
  });
});

// ============================================================
// Idempotency: Running migration twice doesn't break
// ============================================================
describe("Migration Idempotency", () => {
  it("(Edge Case) tables still exist and have data after re-check", async () => {
    // Verify tables exist (migration already ran via setup.js)
    const tables = [
      "banned_phrases",
      "counter_moves",
      "reply_generations",
      "next_steps",
      "prompt_templates",
    ];
    for (const table of tables) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM information_schema.tables
         WHERE table_name = $1 AND table_schema = 'public'`,
        [table]
      );
      expect(parseInt(rows[0].count, 10)).toBe(1);
    }
  });

  it("(Positive) should have 5 system prompt templates seeded (is_system=true)", async () => {
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = true AND active = true"
    );
    expect(parseInt(rows[0].count, 10)).toBeGreaterThanOrEqual(5);
  });

  it("(Positive) system templates should cover all 5 v2.0 prompt types", async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT prompt_type FROM prompt_templates WHERE is_system = true AND active = true"
    );
    const types = rows.map((r) => r.prompt_type);
    expect(types).toContain("EMAIL_REPLY_V2");
    expect(types).toContain("THREAD_CONTINUATION_V1");
    expect(types).toContain("FOLLOW_UP_V2");
    expect(types).toContain("PROPOSAL_V4");
    expect(types).toContain("LOVABLE_MOCKUP_V1");
  });

  it("(Edge Case) adding same banned phrase twice does not create duplicate", async () => {
    const beforeCount = await pool
      .query("SELECT COUNT(*) as count FROM banned_phrases WHERE phrase = 'leverage'")
      .then((r) => parseInt(r.rows[0].count, 10));

    // Try to insert again — should silently skip via ON CONFLICT DO NOTHING
    await pool.query(
      `INSERT INTO banned_phrases (phrase, category) VALUES ('leverage', 'CORPORATE'::banned_phrase_category_enum)
       ON CONFLICT (phrase) DO NOTHING`
    );

    const afterCount = await pool
      .query("SELECT COUNT(*) as count FROM banned_phrases WHERE phrase = 'leverage'")
      .then((r) => parseInt(r.rows[0].count, 10));

    expect(afterCount).toBe(beforeCount);
  });
});
