# Architecture Research

**Domain:** AI-powered freelancer reply cockpit / CRM
**Researched:** 2026-02-28
**Confidence:** MEDIUM (based on training data + existing codebase analysis; web verification tools unavailable)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React SPA)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  Inbox   │  │  Reply   │  │  Leads   │  │ Settings │            │
│  │   View   │  │ Composer │  │ Scoring  │  │  Panel   │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │             │              │                  │
│  ┌────┴──────────────┴─────────────┴──────────────┴──────┐          │
│  │                  API Client Layer                      │          │
│  └───────────────────────┬───────────────────────────────┘          │
└──────────────────────────┼───────────────────────────────────────────┘
                           │ HTTPS (REST JSON)
┌──────────────────────────┼───────────────────────────────────────────┐
│                     EXPRESS.JS API SERVER                             │
│  ┌───────────────────────┴───────────────────────────────┐          │
│  │              Route Layer (controllers)                  │          │
│  │  /auth  /emails  /replies  /leads  /settings  /health  │          │
│  └───────────────────────┬───────────────────────────────┘          │
│  ┌───────────────────────┴───────────────────────────────┐          │
│  │              Service Layer (business logic)             │          │
│  │  AuthService  EmailService  AIService  LeadService     │          │
│  │  SettingsService  LeadhackService                      │          │
│  └───┬──────────┬──────────┬──────────┬──────────────────┘          │
│      │          │          │          │                              │
│  ┌───┴───┐  ┌──┴───┐  ┌──┴───┐  ┌──┴────┐                         │
│  │  DAL  │  │Gmail │  │Claude│  │Lead-  │                          │
│  │(Repos)│  │Client│  │Client│  │hack   │                          │
│  └───┬───┘  └──┬───┘  └──┬───┘  │Client │                          │
│      │         │         │      └──┬────┘                           │
└──────┼─────────┼─────────┼─────────┼────────────────────────────────┘
       │         │         │         │
  ┌────┴───┐ ┌──┴────┐ ┌──┴────┐ ┌──┴──────────┐
  │Postgres│ │Gmail  │ │Claude │ │leadhack.info│
  │  (DB)  │ │API    │ │API    │ │   API       │
  └────────┘ └───────┘ └───────┘ └─────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **React SPA** | All UI rendering, user interaction, state management | Vite + React 18, React Router, component library |
| **API Client Layer** | HTTP requests to backend, auth token management, error handling | fetch/axios wrapper with interceptors |
| **Route Layer** | Request validation, parameter parsing, response formatting | Express Router modules per domain |
| **Auth Middleware** | JWT verification, role-based access control | express middleware, jsonwebtoken |
| **Service Layer** | All business logic, orchestration between external APIs | Pure JS classes/modules, no framework dependency |
| **DAL (Data Access)** | SQL queries, data mapping, transaction management | pg Pool queries, no ORM (keep it lean) |
| **Gmail Client** | OAuth token management, email fetching, message parsing | googleapis npm package |
| **Claude Client** | Prompt construction, API calls, response parsing | @anthropic-ai/sdk |
| **Leadhack Client** | Auth token caching, job detail lookups | Custom HTTP client wrapping leadhack.info endpoints |

## Recommended Project Structure

### Backend (existing Express.js, extend from current)

```
src/
├── index.js                    # Server startup (exists)
├── app.js                      # Express app config (exists)
├── config/
│   ├── db.js                   # PG pool (exists)
│   ├── constants.js            # App-wide constants
│   └── environment.js          # Validated env vars
├── middleware/
│   ├── auth.js                 # JWT verification
│   ├── rbac.js                 # Role-based access control
│   ├── validate.js             # Request validation (Joi/Zod)
│   └── errorHandler.js         # Centralized error handling
├── routes/
│   ├── health.js               # Health check (exists)
│   ├── auth.js                 # Login, register, token refresh
│   ├── emails.js               # Email inbox operations
│   ├── replies.js              # AI reply generation, editing, sending
│   ├── leads.js                # Lead scoring, listing
│   └── settings.js             # Configuration CRUD
├── services/
│   ├── auth.service.js         # Password hashing, JWT creation, sessions
│   ├── email.service.js        # Email sync orchestration, parsing
│   ├── ai.service.js           # Claude prompt building, reply generation
│   ├── lead.service.js         # Lead scoring logic, analysis
│   ├── settings.service.js     # Config management with encryption
│   └── notification.service.js # (future) real-time notifications
├── integrations/
│   ├── gmail/
│   │   ├── client.js           # Gmail API wrapper
│   │   ├── oauth.js            # OAuth flow management
│   │   ├── parser.js           # Email body/header parsing
│   │   └── sync.js             # Incremental sync logic
│   ├── anthropic/
│   │   ├── client.js           # Claude API wrapper
│   │   ├── prompts.js          # Prompt templates (the 10 PRD prompts)
│   │   └── models.js           # Model selection (Sonnet vs Haiku)
│   └── leadhack/
│       ├── client.js           # leadhack.info API wrapper
│       └── auth.js             # JWT token caching for leadhack
├── repositories/
│   ├── user.repo.js            # User CRUD queries
│   ├── email.repo.js           # Email record queries
│   ├── reply.repo.js           # Generated reply queries
│   ├── lead.repo.js            # Lead/job queries
│   └── settings.repo.js        # Settings queries
├── db/
│   └── migrations/
│       ├── 001_users.sql
│       ├── 002_email_accounts.sql
│       ├── 003_emails.sql
│       ├── 004_jobs.sql
│       ├── 005_replies.sql
│       ├── 006_leads.sql
│       └── 007_settings.sql
├── utils/
│   ├── crypto.js               # Encryption for API keys at rest
│   ├── validators.js           # Shared validation schemas
│   └── logger.js               # Structured logging
└── tests/
    ├── health.test.js           # (exists)
    ├── services/
    └── routes/
```

### Frontend (new React app, separate Railway service)

```
frontend/
├── index.html
├── vite.config.js
├── package.json
├── src/
│   ├── main.jsx                # App entry point
│   ├── App.jsx                 # Root component + router
│   ├── api/
│   │   ├── client.js           # Axios/fetch wrapper
│   │   ├── auth.js             # Auth API calls
│   │   ├── emails.js           # Email API calls
│   │   ├── replies.js          # Reply API calls
│   │   ├── leads.js            # Lead API calls
│   │   └── settings.js         # Settings API calls
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Header.jsx
│   │   │   └── MainLayout.jsx
│   │   ├── common/
│   │   │   ├── Button.jsx
│   │   │   ├── Input.jsx
│   │   │   ├── Modal.jsx
│   │   │   └── ThemeToggle.jsx
│   │   ├── emails/
│   │   │   ├── EmailList.jsx
│   │   │   ├── EmailDetail.jsx
│   │   │   └── EmailFilters.jsx
│   │   ├── replies/
│   │   │   ├── ReplyComposer.jsx
│   │   │   ├── ReplyPreview.jsx
│   │   │   └── PromptSelector.jsx
│   │   ├── leads/
│   │   │   ├── LeadCard.jsx
│   │   │   ├── LeadScore.jsx
│   │   │   └── LeadList.jsx
│   │   └── settings/
│   │       ├── EmailAccountForm.jsx
│   │       ├── ApiKeyForm.jsx
│   │       └── RoleManager.jsx
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── InboxPage.jsx
│   │   ├── LeadsPage.jsx
│   │   └── SettingsPage.jsx
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useEmails.js
│   │   └── useTheme.js
│   ├── context/
│   │   ├── AuthContext.jsx
│   │   └── ThemeContext.jsx
│   └── styles/
│       ├── globals.css
│       └── theme.css           # CSS custom properties for dark/light
```

### Structure Rationale

- **`services/` vs `integrations/`**: Services contain business logic; integrations contain external API wrappers. A service may call multiple integrations. This separation means swapping an integration (e.g., switching from Gmail to Outlook) does not touch business logic.
- **`repositories/`**: Thin SQL query layer. No business logic. This keeps database queries testable in isolation and makes it straightforward to swap from raw `pg` to Knex/Drizzle later if needed.
- **`db/migrations/`**: Plain SQL migration files. Use a simple migration runner (node-pg-migrate or custom). Avoids ORM lock-in while the schema is evolving rapidly.
- **Frontend `api/`**: Centralizes all HTTP calls. Components never call fetch directly. Makes it trivial to add auth headers, error handling, and caching in one place.

## Architectural Patterns

### Pattern 1: Service Layer Orchestration

**What:** Route handlers delegate to service functions. Services orchestrate integrations and repositories. Routes never contain business logic.
**When to use:** Every API endpoint.
**Trade-offs:** Slightly more files, but dramatically more testable and maintainable.

**Example:**
```javascript
// routes/replies.js — thin controller
router.post('/:emailId/generate', auth, async (req, res, next) => {
  try {
    const reply = await replyService.generateReply(
      req.params.emailId,
      req.body.promptType,
      req.user.id
    );
    res.json({ data: reply });
  } catch (err) {
    next(err);
  }
});

// services/reply.service.js — orchestrates everything
async function generateReply(emailId, promptType, userId) {
  const email = await emailRepo.findById(emailId);
  if (!email) throw new AppError('Email not found', 404);

  // Get job context from leadhack
  const jobContext = await leadhackClient.getJobDetails(
    email.senderEmail,
    email.subject
  );

  // Load knowledge base / user preferences
  const settings = await settingsRepo.getAISettings(userId);

  // Build prompt and call Claude
  const prompt = buildPrompt(promptType, email, jobContext, settings);
  const aiResponse = await claudeClient.generateMessage(prompt);

  // Save generated reply
  const reply = await replyRepo.create({
    emailId,
    jobId: jobContext?.id,
    promptType,
    generatedText: aiResponse.content,
    model: aiResponse.model,
    tokensUsed: aiResponse.usage,
    createdBy: userId,
  });

  return reply;
}
```

### Pattern 2: Integration Client Wrapper

**What:** Each external API gets a dedicated client class/module that handles authentication, retries, error mapping, and rate limiting. The rest of the app never calls external APIs directly.
**When to use:** Every external service integration (Gmail, Claude, leadhack.info).
**Trade-offs:** More upfront code, but isolates all third-party concerns. When an API changes, only one file changes.

**Example:**
```javascript
// integrations/leadhack/client.js
class LeadhackClient {
  constructor() {
    this.baseUrl = process.env.LEADHACK_API_URL;
    this.token = null;
    this.tokenExpiry = null;
  }

  async ensureAuth() {
    if (this.token && this.tokenExpiry > Date.now()) return;
    const res = await fetch(`${this.baseUrl}/api/admin/getAuthToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.LEADHACK_EMAIL,
        password: process.env.LEADHACK_PASSWORD,
      }),
    });
    const data = await res.json();
    this.token = data.token;
    this.tokenExpiry = Date.now() + 55 * 60 * 1000; // Refresh before 1hr
  }

  async getJobDetails(clientEmail, emailSubject) {
    await this.ensureAuth();
    const res = await fetch(`${this.baseUrl}/api/admin/getJobDetails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        email_id: clientEmail,
        email_subject: emailSubject,
      }),
    });
    if (!res.ok) return null; // No match found — not an error
    return res.json();
  }
}

module.exports = new LeadhackClient(); // Singleton
```

### Pattern 3: Encrypted Settings Store

**What:** User-configurable settings (API keys, OAuth tokens, integration URLs) are stored in PostgreSQL with sensitive values encrypted at rest using AES-256-GCM. A master encryption key is in environment variables, never in the database.
**When to use:** Any stored credential or API key.
**Trade-offs:** Adds encrypt/decrypt overhead per read/write, but the security is non-negotiable for a system storing Gmail OAuth tokens and API keys.

**Example:**
```javascript
// utils/crypto.js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes

function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(ciphertext) {
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv(
    ALGORITHM, KEY, Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
```

### Pattern 4: Gmail Incremental Sync

**What:** Use Gmail API's `history.list` for incremental sync instead of polling full inbox. Store a `historyId` per account and fetch only changes since last sync. Full sync only on initial setup.
**When to use:** Email ingestion — both scheduled polling and on-demand refresh.
**Trade-offs:** More complex than simple polling but dramatically reduces API quota usage and latency. Gmail API has strict quotas (250 units/second per user); incremental sync uses far fewer.

**Confidence:** MEDIUM (based on training data knowledge of Gmail API; could not verify current quota details)

```
Initial Setup:
  messages.list(maxResults=500) → store messages → save historyId

Subsequent Syncs (every 2-5 min or on-demand):
  history.list(startHistoryId) → get added/deleted message IDs
  → fetch only new messages → update historyId

Future Enhancement:
  Gmail Push Notifications (Pub/Sub) → webhook triggers sync
  (requires Google Cloud Pub/Sub — defer to later phase)
```

## Data Flow

### Core Data Flow: Email to AI Reply

```
┌────────────┐
│ Gmail API  │
│ (External) │
└─────┬──────┘
      │ 1. Fetch new emails (poll or manual trigger)
      v
┌─────────────┐     2. Parse email     ┌──────────────┐
│   Gmail     │─────────────────────────│  Email       │
│  Integration│     headers + body      │  Repository  │
└─────┬───────┘                         └──────┬───────┘
      │                                        │ Store in DB
      │ 3. Extract sender email + subject      │
      v                                        v
┌─────────────┐     4. Match job       ┌──────────────┐
│  Leadhack   │─────────────────────────│  Job/Lead    │
│  Integration│     context            │  Repository  │
└─────────────┘                         └──────┬───────┘
                                               │ Cache job data
                                               v
                                        ┌──────────────┐
                                        │  AI Service  │
                                        │  (orchestrate)│
                                        └──────┬───────┘
                                               │ 5. Build prompt:
                                               │    email + job + KB
                                               v
                                        ┌──────────────┐
                                        │  Claude      │
                                        │  Integration │
                                        └──────┬───────┘
                                               │ 6. Generated reply
                                               v
                                        ┌──────────────┐
                                        │  Reply       │
                                        │  Repository  │
                                        └──────┬───────┘
                                               │ 7. Return to UI
                                               v
                                        ┌──────────────┐
                                        │  Frontend    │
                                        │  (display)   │
                                        └──────────────┘
```

### Authentication Flow

```
User (browser)
    │
    │ 1. POST /api/auth/login (email, password)
    v
Auth Route → Auth Service → User Repository → PostgreSQL
    │              │
    │         2. Verify password (bcrypt)
    │         3. Generate JWT (access + refresh tokens)
    │
    │ 4. Return { accessToken, refreshToken }
    v
Frontend stores tokens → attaches accessToken to every request
    │
    │ 5. On 401 → POST /api/auth/refresh (refreshToken)
    v
New accessToken returned → retry original request
```

### Gmail OAuth Flow

```
Frontend
    │
    │ 1. Click "Add Email Account"
    │ → Redirect to /api/settings/gmail/auth-url
    v
Backend generates Google OAuth URL
    │ → Redirect user to Google consent screen
    v
Google consent → callback to /api/settings/gmail/callback?code=XXX
    │
    │ 2. Exchange code for tokens (access_token, refresh_token)
    │ 3. Encrypt tokens → store in email_accounts table
    │ 4. Redirect back to frontend /settings?gmail=connected
    v
Backend uses stored refresh_token for all subsequent Gmail API calls
    │ (refresh_token → new access_token automatically)
```

### Settings Configuration Flow

```
Frontend Settings Page
    │
    │ 1. User saves API key / configuration
    │    POST /api/settings { key: "anthropic_api_key", value: "sk-ant-..." }
    v
Settings Route → RBAC Middleware (owner-only for API keys)
    │
    │ 2. Settings Service
    │    → Validate key name against whitelist
    │    → Encrypt sensitive values (API keys, tokens)
    │    → Store in settings table
    v
PostgreSQL settings table:
    { user_id, key, encrypted_value, is_sensitive, updated_at }
```

### Key Data Flows

1. **Email Ingestion**: Gmail API polling (cron or manual) fetches new messages, parses them, stores in DB, triggers job context lookup against leadhack.info. Results cached locally to avoid redundant API calls.

2. **Reply Generation**: User selects email in inbox, clicks "Generate Reply," system loads email + cached job context + knowledge base settings, constructs prompt from template, calls Claude API, saves generated text, returns to UI for review/edit before sending.

3. **Lead Scoring**: On email ingestion (or on-demand), job context from leadhack is analyzed. Scoring combines: job budget, client history, skill match, response deadline, competition level. Score stored per lead for dashboard sorting.

4. **Configuration Sync**: Settings changes propagate immediately. API key updates re-initialize the corresponding integration client. Email account additions trigger an initial full sync for that account.

## Database Schema Design

### Core Tables

```sql
-- Users and authentication
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    role          VARCHAR(50) NOT NULL DEFAULT 'va',  -- 'owner', 'va', custom roles
    permissions   JSONB DEFAULT '{}',                  -- granular permissions
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Gmail accounts (multi-account support)
CREATE TABLE email_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    email_address   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255),
    access_token    TEXT,                                -- encrypted
    refresh_token   TEXT NOT NULL,                       -- encrypted
    token_expiry    TIMESTAMPTZ,
    history_id      VARCHAR(100),                        -- Gmail sync cursor
    last_synced_at  TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ingested emails
CREATE TABLE emails (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
    gmail_id        VARCHAR(255) UNIQUE NOT NULL,        -- Gmail message ID
    thread_id       VARCHAR(255),                        -- Gmail thread ID
    sender_email    VARCHAR(255) NOT NULL,
    sender_name     VARCHAR(255),
    subject         VARCHAR(1000),
    body_text       TEXT,                                 -- Plain text body
    body_html       TEXT,                                 -- HTML body
    received_at     TIMESTAMPTZ NOT NULL,
    is_read         BOOLEAN DEFAULT false,
    is_archived     BOOLEAN DEFAULT false,
    is_replied      BOOLEAN DEFAULT false,
    labels          JSONB DEFAULT '[]',                   -- Gmail labels
    raw_headers     JSONB,                                -- Full headers for debugging
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_emails_sender ON emails(sender_email);
CREATE INDEX idx_emails_account ON emails(account_id, received_at DESC);
CREATE INDEX idx_emails_thread ON emails(thread_id);

-- Cached job context from leadhack.info
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leadhack_id     VARCHAR(255),                        -- ID from leadhack API
    email_id        UUID REFERENCES emails(id),
    client_email    VARCHAR(255),
    client_name     VARCHAR(255),
    email_subject   VARCHAR(1000),
    job_heading     VARCHAR(1000),
    job_description TEXT,
    raw_response    JSONB,                               -- Full leadhack response cached
    matched_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_jobs_client ON jobs(client_email);
CREATE INDEX idx_jobs_email ON jobs(email_id);

-- AI-generated replies
CREATE TABLE replies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id        UUID REFERENCES emails(id) ON DELETE CASCADE,
    job_id          UUID REFERENCES jobs(id),
    prompt_type     VARCHAR(100) NOT NULL,               -- Which of the 10 prompt templates
    prompt_text     TEXT,                                 -- Actual prompt sent (for auditing)
    generated_text  TEXT NOT NULL,                        -- AI output
    edited_text     TEXT,                                 -- User-edited version (null if unedited)
    model_used      VARCHAR(100),                        -- 'claude-sonnet-4-20250514' etc.
    tokens_input    INTEGER,
    tokens_output   INTEGER,
    cost_estimate   DECIMAL(10,6),                       -- Estimated API cost
    status          VARCHAR(50) DEFAULT 'draft',         -- draft, approved, sent, discarded
    created_by      UUID REFERENCES users(id),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_replies_email ON replies(email_id);
CREATE INDEX idx_replies_status ON replies(status);

-- Lead scores
CREATE TABLE leads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id        UUID REFERENCES emails(id),
    job_id          UUID REFERENCES jobs(id),
    score           INTEGER CHECK (score >= 0 AND score <= 100),
    score_breakdown JSONB,                               -- { budget: 8, fit: 7, urgency: 9, ... }
    analysis_text   TEXT,                                 -- AI-generated analysis
    model_used      VARCHAR(100),
    status          VARCHAR(50) DEFAULT 'new',           -- new, qualified, contacted, won, lost
    notes           TEXT,
    scored_at       TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_status ON leads(status);

-- Application settings (per-user, encrypted sensitive values)
CREATE TABLE settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    key             VARCHAR(255) NOT NULL,
    value           TEXT NOT NULL,                        -- Encrypted if is_sensitive
    is_sensitive    BOOLEAN DEFAULT false,
    category        VARCHAR(100),                         -- 'api_keys', 'integrations', 'preferences'
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, key)
);

-- Audit log (who did what, when)
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(255) NOT NULL,               -- 'reply.generated', 'email.synced', etc.
    entity_type     VARCHAR(100),                        -- 'email', 'reply', 'lead', 'setting'
    entity_id       UUID,
    metadata        JSONB,                               -- Additional context
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action);

-- Knowledge base entries (reusable context for AI prompts)
CREATE TABLE knowledge_base (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    content         TEXT NOT NULL,                        -- Portfolio pieces, standard responses, etc.
    category        VARCHAR(100),                         -- 'portfolio', 'skills', 'rates', 'templates'
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### Schema Design Rationale

- **UUIDs over auto-increment**: Prevents ID enumeration attacks, works across distributed systems, safe to expose in URLs.
- **JSONB for flexible data**: `permissions`, `score_breakdown`, `raw_response`, and `labels` use JSONB because their structure may evolve. Avoids premature schema rigidity.
- **Separate `jobs` table**: Caches leadhack.info responses locally. Avoids hitting the external API repeatedly for the same job. Also enables offline access to job data.
- **`knowledge_base` table**: Stores reusable content (portfolio pieces, rate cards, standard responses) that gets injected into AI prompts. Critical for reply quality.
- **`audit_log`**: Tracks all significant actions. Essential for a multi-user system where an owner needs to see what VAs are doing.
- **Encrypted settings**: API keys and OAuth tokens stored encrypted. The `is_sensitive` flag tells the service layer to decrypt on read and encrypt on write.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 users (current target) | Monolith is perfect. Single Express server handles everything. PostgreSQL on Railway handles the load trivially. Poll Gmail every 2-5 minutes via setInterval or simple cron. |
| 5-20 users | Add connection pooling limits to pg. Consider Bull/BullMQ for background job processing (email sync, AI generation) instead of blocking request handlers. Add Redis for job queues. |
| 20+ users | Move email sync and AI generation to separate worker processes. Add caching layer (Redis) for frequently accessed job data and settings. Consider Gmail push notifications via Pub/Sub to reduce polling overhead. |

### Scaling Priorities

1. **First bottleneck: Claude API latency.** AI reply generation takes 2-10 seconds. Never block the request handler. Return a job ID immediately, process in background, notify frontend via polling or SSE when complete. This is the single most important architectural decision for user experience.

2. **Second bottleneck: Gmail API quotas.** Google enforces per-user and per-project quotas. Incremental sync with historyId is mandatory. Batch requests where possible. Cache aggressively.

3. **Third bottleneck: Database connections.** Railway PostgreSQL has connection limits. Use the pg Pool with `max: 10` connections. Use transactions sparingly and release connections promptly.

## Anti-Patterns

### Anti-Pattern 1: Synchronous AI Generation

**What people do:** Call Claude API in the request handler and wait for the response before sending HTTP response to the client.
**Why it's wrong:** Claude can take 5-15 seconds for complex prompts. The browser shows a spinner, the user thinks it's broken, they might retry (doubling API costs), and the Express connection may timeout.
**Do this instead:** Return a reply ID immediately with `status: 'generating'`. Process AI generation asynchronously (setTimeout for v1, proper job queue for v2). Frontend polls for completion or uses Server-Sent Events.

### Anti-Pattern 2: Storing API Keys in Plaintext

**What people do:** Store Anthropic API keys, Gmail OAuth tokens, and leadhack credentials directly in the database as plain text.
**Why it's wrong:** A single SQL injection or database backup leak exposes all credentials. Gmail OAuth tokens grant full inbox access.
**Do this instead:** Encrypt all sensitive values with AES-256-GCM before storing. Keep the encryption key in environment variables only. Log when sensitive settings are accessed (audit trail).

### Anti-Pattern 3: Fat Route Handlers

**What people do:** Put all logic in Express route handlers — database queries, external API calls, business logic, error handling all in one function.
**Why it's wrong:** Untestable, unmaintainable, impossible to reuse logic across routes. When you need to generate a reply from both the API and a future scheduled job, you end up duplicating everything.
**Do this instead:** Routes are thin wrappers that validate input and call service functions. Services contain all business logic. Repositories handle data access. Each layer is independently testable.

### Anti-Pattern 4: Polling Gmail on Every Frontend Request

**What people do:** Each time the user opens the inbox, the backend calls Gmail API to check for new emails.
**Why it's wrong:** Hammers Gmail API quota, adds 1-3 seconds latency to every inbox load, may hit rate limits with multiple accounts.
**Do this instead:** Sync emails in the background on a schedule (every 2-5 minutes). Store locally. Serve inbox from local database. Add a manual "Sync Now" button that triggers an immediate sync. The UI is always fast because it reads from PostgreSQL, not Gmail.

### Anti-Pattern 5: Monolithic Prompt Strings

**What people do:** Hardcode long prompt strings inline wherever AI is called, duplicating context-building logic.
**Why it's wrong:** Impossible to iterate on prompts without touching business logic. Cannot A/B test prompts. No visibility into what was actually sent to the AI.
**Do this instead:** Prompt templates are stored separately (either in `prompts.js` or database). A prompt builder function assembles the final prompt from template + email context + job context + knowledge base. The assembled prompt is logged/stored for auditing.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Gmail API** | OAuth 2.0, googleapis npm package, incremental sync with historyId | Must handle token refresh automatically. Store refresh_token encrypted. Multiple accounts = multiple OAuth flows. Each account has its own sync cursor. |
| **Anthropic Claude API** | REST via @anthropic-ai/sdk, non-streaming for reply generation | Use Sonnet for reply generation (quality matters), Haiku for lead scoring (speed/cost matters). Store model choice in settings so user can adjust. Track token usage for cost visibility. |
| **leadhack.info API** | REST with JWT auth, three endpoints | Token expires after 1 hour — cache and refresh. `getJobDetails` may return null (no match) — handle gracefully. Cache results in `jobs` table to avoid redundant lookups. |
| **Google Cloud (future)** | Pub/Sub for Gmail push notifications | Defer to Phase 3+. Requires Google Cloud project setup, Pub/Sub topic, and a publicly accessible webhook endpoint on Railway. Significant complexity increase. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend <-> Backend | REST JSON over HTTPS | CORS configured for Railway frontend URL. Auth via JWT in Authorization header. All responses follow `{ data: ..., error: ... }` envelope. |
| Route <-> Service | Direct function call | Routes never import repositories or integrations directly. Services are the only entry point for business logic. |
| Service <-> Repository | Direct function call | Repositories return plain objects (not query results). Services never write SQL. |
| Service <-> Integration | Direct function call | Integration clients are singletons (one Gmail client per account, one Claude client, one leadhack client). Services never construct HTTP requests. |
| Backend <-> PostgreSQL | pg Pool, connection string via DATABASE_URL | SSL in production. Pool max 10 connections. All queries parameterized (no string interpolation). |

## Suggested Build Order

The architecture implies a specific build sequence based on dependency chains:

### Phase 1: Foundation (build first, everything depends on it)
- Database schema (migrations 001-007)
- Auth system (users table, JWT, login/register routes)
- Settings infrastructure (encrypted settings store, API key management)
- Base frontend scaffolding (Vite + React, router, layout, theme, login page)

**Why first:** Every other feature needs authenticated users and configuration to function. Cannot test Gmail without stored OAuth tokens. Cannot test AI without stored Anthropic API key.

### Phase 2: Email Ingestion (core data pipeline)
- Gmail OAuth flow (add account, consent, store tokens)
- Gmail sync service (initial full sync, incremental sync)
- Email parsing and storage
- Inbox UI (email list, detail view, filters)

**Why second:** Emails are the input to everything else. Cannot test job matching, AI replies, or lead scoring without actual emails in the system.

### Phase 3: Job Context + AI Replies (the core value)
- Leadhack client integration
- Job matching on email ingestion (automatic context lookup)
- Claude API integration
- Prompt template system (the 10 PRD prompts)
- Reply generation service (async pattern)
- Reply composer UI (generate, preview, edit, send)

**Why third:** This is the core product value but depends on having emails (Phase 2) and configuration (Phase 1).

### Phase 4: Lead Scoring + Polish
- Lead scoring algorithm (AI-powered analysis of job + client)
- Lead dashboard UI
- Knowledge base management (CRUD for portfolio pieces, rates, etc.)
- Audit logging
- Role-based access refinement (granular VA permissions)

**Why fourth:** Enhances the core workflow but is not blocking. Lead scoring uses the same job context infrastructure from Phase 3. Knowledge base improves reply quality but is not required for initial reply generation.

## Sources

- Existing codebase analysis: `D:/LMS Reply/src/` (Express.js skeleton, pg Pool config)
- Project definition: `D:/LMS Reply/.planning/PROJECT.md` (requirements, constraints, key decisions)
- Gmail API architecture: training data (MEDIUM confidence — could not verify current docs due to tool restrictions)
- Anthropic SDK patterns: training data (MEDIUM confidence — `@anthropic-ai/sdk` npm package patterns)
- leadhack.info API: project context (HIGH confidence — endpoints specified in PROJECT.md)
- Express.js service layer patterns: training data (HIGH confidence — well-established patterns, unlikely to have changed)
- PostgreSQL schema design: training data (HIGH confidence — standard relational design)

---
*Architecture research for: AI-powered freelancer reply cockpit / CRM*
*Researched: 2026-02-28*
