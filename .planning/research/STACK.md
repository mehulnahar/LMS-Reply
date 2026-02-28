# Stack Research

**Domain:** AI-Powered Freelancer CRM with Email Integration
**Project:** Upwork Proposal & Reply Cockpit
**Researched:** 2026-02-28
**Confidence:** HIGH (versions verified via npm registry; architecture rationale from established patterns)

---

## Existing Stack (Keep As-Is)

Already deployed on Railway. Do not replace.

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Node.js | >=18.0.0 | Runtime | Keep (engines field in package.json) |
| Express | ^4.21.2 | HTTP server | Keep on v4 -- see rationale below |
| PostgreSQL | Railway-managed | Primary database | Keep |
| pg | ^8.13.1 | PostgreSQL driver | Keep (used in src/config/db.js) |
| helmet | ^8.0.0 | Security headers | Keep |
| cors | ^2.8.5 | CORS middleware | Keep |
| morgan | ^1.10.0 | HTTP logging | Keep |
| dotenv | ^16.4.7 | Env vars | Keep |
| Jest | ^29.7.0 | Backend tests | Keep |

### Why Stay on Express 4, Not Upgrade to Express 5

Express 5.2.1 is now stable, but upgrading is premature for this project:
- The existing skeleton uses Express 4.21.2 which is fully supported (4.22.1 is latest v4)
- Express 5 has breaking changes (path matching, removed deprecated APIs) that add migration risk for zero feature benefit in this domain
- Middleware ecosystem (helmet, cors, morgan) all work with v4 without compatibility concerns
- **Decision:** Stay on Express 4.x. Upgrade to 5.x is a future tech-debt task, not a product feature

---

## Recommended Stack: New Additions

### Database Layer -- Drizzle ORM

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| drizzle-orm | ^0.45.1 | Type-safe ORM for PostgreSQL | Schema-as-code with zero runtime overhead. Works directly with pg Pool (already in project). SQL-like API means less abstraction leakage than Prisma. Push/pull migration workflows fit brownfield projects |
| drizzle-kit | ^0.31.9 | Schema migrations CLI | Generates SQL migrations from schema changes. `drizzle-kit push` for dev, `drizzle-kit migrate` for production |

**Why Drizzle over Prisma:**
- Prisma (v7.4.2) requires a separate binary (Prisma Engine) which adds ~15MB to Railway deploys and cold start latency
- Drizzle runs pure JS/TS -- no binary, no engine process, smaller deploy footprint
- Drizzle's `sql` template literal allows raw SQL escape hatches without leaving the ORM
- The project already uses raw `pg` Pool; Drizzle wraps it directly (`drizzle(pool)`) with zero config migration
- Prisma's schema.prisma DSL is a separate language; Drizzle schemas are TypeScript files

**Why not raw pg forever:**
- 20+ tables across leads, emails, accounts, templates, audit logs = unmaintainable raw SQL
- Drizzle provides type safety on queries without runtime cost
- Migration tracking prevents schema drift between dev and Railway production

### Frontend -- React + Vite + Tailwind

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React | ^19.2.4 | UI framework | Industry standard. React 19 is stable with improved Suspense, Actions, and use() hook |
| Vite | ^7.3.1 | Build tool & dev server | Sub-second HMR, native ESM, fastest DX. Vite 7 is current stable |
| TypeScript | ^5.9.3 | Type safety | Catches integration bugs at compile time across frontend-backend boundary |
| Tailwind CSS | ^4.2.1 | Utility-first styling | Dark/light theme support via CSS variables and `@custom-variant`. Tailwind v4 uses CSS-first config (no tailwind.config.js), Vite plugin via `@tailwindcss/vite` ^4.2.1 |
| React Router | ^7.13.1 | Client-side routing | v7 is stable, file-based or config-based routing, built-in data loading |

### State Management & Data Fetching

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TanStack Query | ^5.90.21 | Server state (API data) | Handles caching, refetching, pagination, optimistic updates for email/lead data. Eliminates manual loading/error state boilerplate |
| Zustand | ^5.0.11 | Client state (UI state) | Minimal API for auth tokens, sidebar state, theme toggle, draft compose state. No boilerplate, no providers, 1kb |

**Why this split, not Redux:**
- Redux Toolkit is overkill for this app. There are two types of state: server data (emails, leads, jobs) and UI state (which panel is open, draft text, theme)
- TanStack Query owns server state with automatic cache invalidation when emails arrive or leads update
- Zustand owns the remaining UI state with a dead-simple `create(set => ...)` API
- Combined bundle size is ~15kb vs Redux Toolkit's ~40kb+

### UI Component Library

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| shadcn/ui | ^3.8.5 (CLI) | Component primitives | Not a dependency -- copies accessible, composable components into your codebase. Built on Radix UI. Full control over styling. Dark mode built-in via CSS variables |
| Radix UI primitives | ^1.1.x | Accessible headless components | Used by shadcn/ui under the hood. Dialog, Dropdown, Tooltip, Select, Tabs -- all ARIA-compliant |
| Lucide React | ^0.575.0 | Icons | Tree-shakeable, consistent style, 1500+ icons. Used by shadcn/ui by default |
| class-variance-authority | ^0.7.1 | Component variant API | Type-safe variant definitions for buttons, badges, etc. |
| clsx | ^2.1.1 | Class merging utility | Conditional class application |
| tailwind-merge | ^3.5.0 | Tailwind conflict resolution | Prevents `p-2 p-4` duplication in merged classes |
| Sonner | ^2.0.7 | Toast notifications | Best React toast library. Accessible, animated, composable. Used by shadcn/ui's toast component |

### Gmail API Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| googleapis | ^171.4.0 | Gmail API client | Official Google SDK. Provides `google.gmail()` for messages, threads, labels, watch. Handles pagination, batching |
| google-auth-library | ^10.6.1 | OAuth2 authentication | Handles token refresh, credential storage, multi-account OAuth flows. Used by googleapis internally but also needed standalone for token management |

**Multi-account architecture:**
- Store OAuth2 refresh tokens per Gmail account in PostgreSQL (encrypted at rest)
- Use `google-auth-library` to create per-account OAuth2Client instances
- Each client independently refreshes its access token
- Gmail `users.watch()` sets up push notifications per account via Google Cloud Pub/Sub
- Webhook endpoint receives push notifications, triggers email sync for the specific account

**Gmail push notifications vs polling:**
- Use `users.watch()` with Google Cloud Pub/Sub for near-real-time email arrival notifications (typically <5 second latency)
- `watch()` must be renewed every 7 days (use node-cron for renewal)
- Pub/Sub sends a notification that new mail exists -- your webhook then calls `messages.list` with a history ID to fetch only new messages
- Fallback: periodic full sync (every 15 min) catches anything push notifications miss

### AI Integration -- Anthropic Claude

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @anthropic-ai/sdk | ^0.78.0 | Claude API client | Official TypeScript SDK. Streaming support for real-time reply generation. Handles retries, rate limits |

**Usage patterns for this project:**
- **Reply generation:** Stream Claude's response to frontend via SSE (Server-Sent Events) for real-time typing effect
- **Proposal generation:** Combine job details (from leadhack API) + freelancer profile + email context as structured prompt
- **Lead scoring:** Batch analysis of job fit using Claude with structured JSON output
- **Prompt caching:** Cache system prompts and freelancer profile context to reduce cost (up to 90% savings on cached tokens)
- **Model selection:** Use `claude-sonnet-4-20250514` for reply/proposal generation (fast, cost-effective). Use `claude-opus-4-0-20250514` only for complex analysis if needed

**SSE streaming pattern (backend):**
```javascript
// Express SSE endpoint for streaming AI replies
app.post('/api/ai/reply/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      res.write(`data: ${JSON.stringify(event.delta)}\n\n`);
    }
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
```

### Real-Time Communication

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Socket.IO | ^4.8.3 | WebSocket server | Real-time email notifications, live inbox updates when new emails arrive via Gmail push. Rooms per user for multi-account isolation |
| socket.io-client | ^4.8.3 | WebSocket client | Frontend connection. Auto-reconnect, fallback to polling |

**Why Socket.IO over raw WebSockets:**
- Auto-reconnection with exponential backoff (critical for Railway deploys that may restart)
- Room-based broadcasting (each user joins their room; new email notifications target the right user)
- Fallback to HTTP long-polling if WebSocket fails (corporate firewalls)
- Namespace support for separating email notifications from AI streaming events

**Why not SSE for everything:**
- SSE is unidirectional (server-to-client). Fine for AI streaming responses
- Socket.IO is bidirectional. Needed for: "mark as read" ack, typing indicators, draft sync across tabs
- Use SSE for AI streaming (simpler, no library needed). Use Socket.IO for inbox real-time updates

### Authentication & Authorization

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| jsonwebtoken | ^9.0.3 | JWT token creation/verification | Industry standard for stateless auth. Access + refresh token pattern |
| bcryptjs | ^3.0.3 | Password hashing | Pure JS bcrypt (no native compilation issues on Railway). Cost factor 12 |
| express-rate-limit | ^8.2.1 | Rate limiting | Prevent brute force on login, rate limit AI generation endpoints |

**Auth architecture:**
- Short-lived access tokens (15 min) + long-lived refresh tokens (7 days) stored in httpOnly cookies
- Role-based access: `admin` (freelancer), `va` (virtual assistant), with per-feature permissions
- Gmail OAuth tokens stored separately from app auth (different concern)

### Background Jobs & Scheduling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| BullMQ | ^5.70.1 | Job queue | Reliable email sync jobs, AI generation queue, retry with backoff. Required for: Gmail history sync, batch lead scoring, scheduled proposal sends |
| ioredis | ^5.10.0 | Redis client (BullMQ dep) | BullMQ requires Redis. Railway offers Redis as an add-on service |
| node-cron | ^4.2.1 | Cron scheduling | Gmail watch renewal (every 6 days), periodic full sync fallback, stale lead cleanup |

**Why BullMQ, not just node-cron:**
- Gmail sync can fail (rate limits, network). BullMQ provides automatic retries with exponential backoff
- AI generation is expensive. Queue prevents concurrent requests from exceeding Anthropic rate limits
- Job prioritization: urgent email replies > batch lead scoring > scheduled syncs
- Dashboard via `bull-board` for monitoring job health

**Railway consideration:** BullMQ requires Redis. Railway charges for Redis add-on. If budget is tight, start with node-cron + in-memory queue (pg-boss as alternative using PostgreSQL as queue backend, no Redis needed).

### External API Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| axios | ^1.13.6 | HTTP client for leadhack.info API | Better error handling than fetch for external APIs. Interceptors for auth token injection. Timeout handling |

**leadhack.info integration pattern:**
- `getAuthToken` -- called on startup, cached with TTL
- `addDataV4` -- called when new leads identified from emails
- `getJobDetails` -- called per-lead for enrichment, cache results in PostgreSQL

### Forms & Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React Hook Form | ^7.71.2 | Form state management | Uncontrolled components = minimal re-renders. Critical for large reply/proposal editor forms |
| @hookform/resolvers | ^5.2.2 | Schema validation bridge | Connects React Hook Form to Zod schemas |
| Zod | ^4.3.6 | Schema validation | Shared validation between frontend forms and backend API endpoints. TypeScript-first |

**Shared validation pattern:**
```typescript
// shared/schemas/reply.ts -- used by both frontend and backend
import { z } from 'zod';

export const replySchema = z.object({
  emailId: z.string().uuid(),
  body: z.string().min(1).max(10000),
  tone: z.enum(['professional', 'friendly', 'brief']),
  includePortfolio: z.boolean().default(false),
});

export type ReplyInput = z.infer<typeof replySchema>;
```

### Content Rendering

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| react-markdown | ^10.1.0 | Render AI-generated markdown | Claude outputs markdown. Render proposals/replies with formatting |
| DOMPurify | ^3.3.1 | HTML sanitization | Sanitize email HTML content before rendering. Prevents XSS from inbound emails |
| date-fns | ^4.1.0 | Date formatting | Lightweight, tree-shakeable. Format email timestamps, lead activity dates |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| TypeScript | ^5.9.3 | Type safety | Use across both frontend (Vite) and backend (tsx or ts-node for dev) |
| Vitest | ^4.0.18 | Frontend tests | Vite-native, same config. Jest API-compatible but faster for Vite projects |
| @testing-library/react | ^16.3.2 | Component tests | DOM-based testing, user-centric queries |
| ESLint | ^8.57.1 | Linting | Already in project. Consider upgrading to v9 flat config later |
| nodemon | ^3.1.9 | Backend dev reload | Already in project |
| drizzle-kit | ^0.31.9 | DB migrations | Schema push for dev, SQL migrations for prod |

---

## Installation

```bash
# === BACKEND (add to existing package.json) ===

# Database ORM
npm install drizzle-orm
npm install -D drizzle-kit

# Gmail API
npm install googleapis google-auth-library

# AI Integration
npm install @anthropic-ai/sdk

# Authentication
npm install jsonwebtoken bcryptjs express-rate-limit

# Real-time
npm install socket.io

# Background Jobs (requires Redis on Railway)
npm install bullmq ioredis node-cron

# Validation
npm install zod

# External API
npm install axios

# Dev dependencies
npm install -D typescript @types/node @types/express @types/jsonwebtoken @types/bcryptjs

# === FRONTEND (separate package in client/ directory) ===

# Scaffold with Vite
npm create vite@latest client -- --template react-ts

# Core
cd client && npm install react-router-dom @tanstack/react-query zustand axios

# UI
npx shadcn@latest init
npm install sonner lucide-react class-variance-authority clsx tailwind-merge

# Forms
npm install react-hook-form @hookform/resolvers zod

# Content
npm install react-markdown dompurify date-fns

# Real-time
npm install socket.io-client

# Dev
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not the Alternative |
|----------|-------------|-------------|------------------------|
| ORM | Drizzle ORM | Prisma 7 | Binary engine adds cold start latency and 15MB+ to deploys. Prisma schema is a separate DSL. Drizzle wraps existing pg Pool directly |
| ORM | Drizzle ORM | Knex.js | Knex is a query builder, not an ORM. No type inference from schema. Drizzle gives both |
| Frontend framework | React + Vite | Next.js | SSR is unnecessary for a CRM dashboard. Adds routing complexity, server components learning curve, and deployment complexity on Railway (needs different build config). Vite SPA is simpler and sufficient |
| Frontend framework | React + Vite | Remix | Same SSR argument as Next.js. This is a dashboard app, not a content site |
| State management | TanStack Query + Zustand | Redux Toolkit | Overkill for this app's state complexity. TQ handles server cache; Zustand handles UI state. Combined = less boilerplate, smaller bundle |
| State management | Zustand | Jotai | Zustand's store pattern is more intuitive for app-level state (auth, theme). Jotai's atomic model is better for granular shared state. Either works; Zustand has broader adoption |
| UI components | shadcn/ui | Material UI (MUI) | MUI's opinionated styling fights Tailwind. Heavy bundle. shadcn/ui copies components into your codebase = full control + Tailwind-native |
| UI components | shadcn/ui | Ant Design | Same problem as MUI. Opinionated design system that conflicts with custom dark/light theme needs |
| Background jobs | BullMQ | pg-boss | pg-boss uses PostgreSQL as queue backend (no Redis needed). Consider if Redis budget is a concern. BullMQ is faster and more battle-tested at scale |
| HTTP client | axios | native fetch | axios has interceptors (auto-attach leadhack auth token), better error objects, timeout handling. fetch requires more boilerplate for these patterns |
| Toast | Sonner | react-hot-toast | Sonner has better animations, promise-based toasts (loading->success/error), and is the shadcn/ui default |
| Testing (frontend) | Vitest | Jest | Vitest shares Vite config, faster startup, native ESM. Jest requires separate transform config for Vite projects |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Express 5.x (for now) | Breaking changes with no feature benefit for this project. Middleware compatibility not fully verified | Express 4.22.x |
| Sequelize | Legacy ORM, poor TypeScript support, heavy abstraction | Drizzle ORM |
| Mongoose | MongoDB ORM. Project uses PostgreSQL | Drizzle ORM |
| node-fetch | Redundant in Node 18+ (native fetch exists). If you need interceptors, use axios | axios or native fetch |
| moment.js | Deprecated, massive bundle | date-fns |
| create-react-app (CRA) | Deprecated and unmaintained since 2023 | Vite |
| Passport.js | Over-abstracted for simple JWT + Google OAuth. Adds complexity without value for 2 auth strategies | Direct jsonwebtoken + google-auth-library |
| nodemailer (for Gmail sending) | Gmail API's `users.messages.send` is more reliable than SMTP for Gmail accounts, handles OAuth natively, no "less secure app" issues | googleapis gmail.users.messages.send |
| Firebase Auth | External dependency, vendor lock-in. JWT + bcrypt is straightforward for a small team CRM | jsonwebtoken + bcryptjs |
| Tailwind CSS v3 | v4 is stable with CSS-first config, better performance, smaller output. No reason to use v3 for new projects | Tailwind CSS v4.2.1 |

---

## Stack Patterns by Variant

**If Redis is not available on Railway (budget constraint):**
- Replace BullMQ with `pg-boss` (uses PostgreSQL as job queue)
- Remove ioredis dependency
- Trade-off: slightly higher database load, but eliminates Redis cost

**If the project needs to go full TypeScript on backend:**
- Add `tsx` (npm view shows current version) for running .ts files directly in dev
- Use `tsc` for production build (compile to JS)
- Or use `tsup` for fast TypeScript bundling

**If email volume is very low (<50 emails/day across all accounts):**
- Skip BullMQ entirely
- Use simple async functions with retry logic
- node-cron for periodic Gmail sync (every 5 min)
- Add BullMQ later when volume justifies the Redis cost

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| drizzle-orm ^0.45.1 | pg ^8.x | Uses pg Pool directly via `drizzle(pool)` |
| @tailwindcss/vite ^4.2.1 | Vite ^7.x, Tailwind ^4.2.x | Required for Tailwind v4 in Vite projects |
| React ^19.2.4 | React Router ^7.x | React Router 7 requires React 18+ |
| TanStack Query ^5.90.x | React ^18 or ^19 | Fully compatible with React 19 |
| shadcn/ui CLI ^3.8.5 | Tailwind ^4.x, React ^18/19 | shadcn init detects Tailwind version |
| Socket.IO ^4.8.3 | socket.io-client ^4.8.3 | Must use matching major versions |
| BullMQ ^5.70.1 | ioredis ^5.x | BullMQ 5 requires ioredis 5 |
| Zod ^4.3.6 | @hookform/resolvers ^5.x | Resolvers v5 supports Zod v4 |
| googleapis ^171.x | google-auth-library ^10.x | googleapis uses google-auth-library internally |
| Express ^4.21.2 | helmet ^8.x, cors ^2.x | Verified compatible in existing package.json |

---

## Monorepo vs Separate Repos

**Recommendation: Monorepo with workspace structure**

```
lms-reply/
  package.json          # Root workspace config
  src/                  # Backend (Express API)
  client/               # Frontend (React + Vite)
  shared/               # Shared Zod schemas, types, constants
```

Use npm workspaces (built into npm 7+, no extra tool needed):
```json
{
  "workspaces": ["client", "shared"]
}
```

**Why monorepo:**
- Shared Zod schemas between frontend validation and backend API validation
- Shared TypeScript types for API request/response contracts
- Single git repo, single Railway deploy (backend serves static frontend build)
- No need for Turborepo/Nx -- npm workspaces is sufficient for 2-3 packages

---

## Sources

- npm registry (all versions verified via `npm view [package] version` on 2026-02-28) -- **HIGH confidence**
- Existing project package.json and source code (D:/LMS Reply/) -- **HIGH confidence**
- Express 4 vs 5 decision based on existing project constraints and middleware ecosystem -- **HIGH confidence**
- Gmail push notifications architecture based on Google Cloud Pub/Sub pattern (established pattern, verified endpoint exists in googleapis) -- **MEDIUM confidence** (specific Pub/Sub setup details should be verified against current Google Cloud docs during implementation)
- Anthropic SDK streaming pattern based on SDK TypeScript types and established usage -- **MEDIUM confidence** (verify exact streaming API shape against SDK docs at implementation time)
- BullMQ + Redis vs pg-boss trade-off -- **MEDIUM confidence** (Railway Redis pricing should be verified at deploy time)
- shadcn/ui + Tailwind v4 compatibility -- **MEDIUM confidence** (shadcn CLI v3.8.5 is current; verify Tailwind v4 template support during `shadcn init`)

---
*Stack research for: AI-Powered Freelancer CRM with Email Integration*
*Researched: 2026-02-28*
