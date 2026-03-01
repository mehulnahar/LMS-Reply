const app = require("./app");
const { runMigrations } = require("./config/migrate");

const PORT = process.env.PORT || 3000;

async function start() {
  // Always run migrations on startup — ensures tables exist even after DB wipe
  console.log("Running database migrations...");
  try {
    const count = await runMigrations();
    if (count > 0) {
      console.log(`  ${count} migration(s) applied.`);
    }
  } catch (err) {
    console.error("Migration failed:", err.message);
    console.error("Server starting anyway — some features may not work.");
  }

  app.listen(PORT, () => {
    console.log(`LMS Reply server running on port ${PORT}`);
  });
}

start();
