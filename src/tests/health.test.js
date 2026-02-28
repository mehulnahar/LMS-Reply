const request = require("supertest");
const app = require("../app");

describe("GET /api/health", () => {
  it("returns healthy status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("timestamp");
  });
});

describe("GET /", () => {
  it("returns app info", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe("LMS Reply");
    expect(res.body.status).toBe("running");
  });
});

describe("GET /unknown-route", () => {
  it("returns 404", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.statusCode).toBe(404);
  });
});
