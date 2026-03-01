# LMS Reply — Upwork Proposal & Reply Cockpit

## Project Overview
AI-powered Upwork client management system. Pulls emails from Gmail, matches to job data via leadhack.info API, generates context-aware replies using Claude AI.

## Tech Stack
- **Backend**: Node.js + Express.js
- **Frontend**: React (from scratch, not Lovable)
- **Database**: PostgreSQL (Railway)
- **AI**: Anthropic Claude (Sonnet for heavy tasks, Haiku for lightweight)
- **Email**: Gmail API (OAuth, multi-account)
- **Deployment**: Railway (auto-deploy via GitHub Actions CI/CD)

## Project Structure
```
src/
  index.js          # Server entry point
  app.js            # Express app setup (middleware, routes, error handling)
  config/
    db.js           # PostgreSQL connection pool
  routes/
    health.js       # Health check endpoint
  tests/
    health.test.js  # Jest + Supertest tests
```

## External APIs

### leadhack.info (Job Data Source)
- **Base URL**: `https://app.leadhack.info:3000/api/admin`
- `POST /getAuthToken` — Auth with email + password → JWT token
- `POST /addDataV4` — Ingest job/lead data (from RSS scraper)
- `POST /getJobDetails` — Query by `email_id` + `email_subject` → full job context
- Response shape: `{ status: boolean, data: [{ id, first_name, last_name, email_id, email_subject, job_heading, job_description }] }`
- **Do NOT rebuild this** — integrate with it as a configurable external data source

### Gmail API
- OAuth2 with multi-account support
- User has Google Cloud credentials ready

### Anthropic Claude API
- User has API key
- Use Sonnet for reply/proposal generation, Haiku for scoring/classification

## Development Commands
```bash
npm start          # Production server
npm run dev        # Dev server with nodemon
npm run lint       # ESLint check
npm run test       # Jest tests (--passWithNoTests --forceExit)
npm run test:coverage  # Jest with coverage
```

## Conventions
- **Module-by-module development**: Build one module, user tests, then next
- **Everything configurable**: No hardcoded API keys, emails, or integration URLs
- **UI**: Minimalist, polished, professional. Dark + light mode toggle. NOT generic template look.
- **Auth**: Custom role-based access (owner + VA team with granular permissions)
- **Code style**: ESLint enforced, CommonJS (require/module.exports)
- **Tests**: Jest + Supertest for API tests
- **Commits**: Descriptive messages, Co-Authored-By trailer

## Railway Services
- **LMS Reply API** (Express backend)
- **LMS Reply Frontend** (React — not yet built)
- **PostgreSQL** (database)

## CI/CD
- GitHub Actions: lint → test → Railway auto-deploys via "Wait for CI"
- No manual deploy step — Railway watches for green CI

## Key Design Principles
1. Speed-to-reply: The system must feel faster than doing it manually
2. Trust but verify: AI replies need review → edit → send flow (configurable skip)
3. No context switching: The inbox IS the workspace
4. Configurability over convention: User controls everything via settings
