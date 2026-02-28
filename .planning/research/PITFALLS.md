# Pitfalls Research

**Domain:** AI-powered freelancer email reply cockpit / CRM with Gmail API integration
**Researched:** 2026-02-28
**Confidence:** MEDIUM (training data through May 2025; no live web verification available -- Gmail API, Google OAuth2, and Claude API knowledge is well-established but specific quota numbers and policy changes should be verified against current docs before implementation)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or system-wide failures.

### Pitfall 1: OAuth2 Refresh Token Silent Expiry and Revocation

**What goes wrong:**
Google OAuth2 refresh tokens for Gmail can expire or become invalid in ways that are not obvious. Specifically:
- Refresh tokens for apps in "Testing" publishing status (not verified) expire after **7 days**. This is the single most common cause of "it worked in dev but broke in production."
- Users can revoke access via Google Account settings at any time.
- Google can revoke tokens if they detect the app violates Gmail API policies.
- If the OAuth consent screen is not verified (common for internal tools), Google imposes a 100-user cap and 7-day token expiry.
- A refresh token becomes invalid if the user changes their Google password (in some configurations).
- If you request incremental scopes and the user doesn't grant all, partial tokens cause confusing permission errors.

**Why it happens:**
Developers test with fresh tokens, see everything working, and never implement monitoring for token health. The 7-day expiry for "Testing" status apps is buried in Google's documentation and catches nearly every Gmail API project.

**How to avoid:**
1. **Publish the app and complete Google OAuth verification** before multi-user deployment. Budget 2-4 weeks for the verification process (Google reviews your app, may ask for a security audit for sensitive scopes like `gmail.modify`).
2. Store refresh tokens encrypted in the database with a `last_refreshed_at` timestamp and `status` column.
3. Implement a **proactive token health check** that runs every 4 hours: attempt a lightweight Gmail API call (e.g., `users.getProfile`) for each connected account. Mark accounts as `needs_reauth` if it fails.
4. Build a clear re-authentication flow in the UI. When a token is invalid, show a prominent banner: "Gmail account X disconnected -- click to reconnect."
5. Request all needed scopes upfront (not incrementally) to avoid partial-permission tokens.
6. Store the `token_expiry` from the OAuth response and refresh proactively (5 minutes before expiry), not reactively on 401 errors.

**Warning signs:**
- Works perfectly for 7 days then all Gmail accounts disconnect simultaneously.
- Intermittent 401 errors that "fix themselves" (race conditions in token refresh).
- Users reporting "I have to reconnect my Gmail every week."

**Phase to address:**
Phase 1 (Configuration/Integration foundation). This must be solved before any Gmail features are built. The token management layer is foundational.

---

### Pitfall 2: Gmail API Watch/Push Notification Expiry and Reliability

**What goes wrong:**
Gmail API's push notification system (`users.watch()` with Cloud Pub/Sub) has strict constraints that cause inbox sync to silently stop:
- Watch registrations expire after **7 days maximum** (not configurable).
- You must call `users.watch()` again before expiry, or you stop receiving notifications entirely with no error.
- Push notifications are **not guaranteed** -- Google documents that notifications may be delayed or dropped. You cannot rely solely on push for inbox completeness.
- The `historyId` used for incremental sync can become invalid if too much time passes between syncs, requiring a full re-sync.
- Cloud Pub/Sub adds infrastructure complexity (Google Cloud project, topic/subscription setup, IAM permissions, message acknowledgment).

**Why it happens:**
Developers implement watch, see real-time notifications, and assume the system is reliable. They skip implementing polling as a fallback. The 7-day expiry is easy to forget because the app works fine for the first week.

**How to avoid:**
1. **Use a hybrid approach**: Push notifications for real-time feel + polling every 2-5 minutes as a reliability backstop.
2. Implement a cron job that calls `users.watch()` every 6 days (24 hours before expiry) for each connected Gmail account.
3. Store the `historyId` from each sync and validate it on the next sync. If Gmail returns a 404 on `history.list()`, fall back to a full message list sync for the relevant time window.
4. Consider **skipping push entirely** for an MVP and using polling only (every 60-90 seconds). This is simpler, more reliable, and the latency difference is negligible for a reply cockpit use case.
5. If using push, implement dead letter handling: if no notification received for an account in 10 minutes during business hours, trigger a poll.

**Warning signs:**
- Inbox stops updating for one or more accounts after ~7 days.
- Users saying "I got an email 10 minutes ago but it's not showing up."
- `historyId` errors in logs that come and go.

**Phase to address:**
Phase 2 (Reply Inbox). Critical decision: push vs. poll vs. hybrid. For MVP, polling-only is the pragmatic choice.

---

### Pitfall 3: Claude API Cost Explosion from Uncontrolled Generation

**What goes wrong:**
Without budget controls, Claude API costs can escalate rapidly:
- Each reply generation with full job context can consume 2,000-4,000 input tokens + 500-1,500 output tokens.
- If a VA regenerates replies 10 times per email trying to get the "right" tone, that's 10x the cost per email.
- If the system auto-generates replies for all incoming emails (not just relevant ones), costs multiply by the noise ratio.
- Long job descriptions (common on Upwork) can push individual requests to 5,000-8,000 input tokens.
- Sonnet is ~5x more expensive than Haiku per token. Using Sonnet for everything when Haiku would suffice for simple tasks wastes budget.
- No circuit breaker means a bug in the reply loop could generate hundreds of API calls in minutes.

**Why it happens:**
Developers focus on making AI features work, not on constraining them. Cost monitoring is treated as "nice to have" and added after the first shocking invoice.

**How to avoid:**
1. **Implement per-user daily token budgets** in the database. Track `tokens_used_today` per user. Reject generation requests when budget is exhausted with a clear message.
2. **Implement per-request max_tokens**: set `max_tokens` to 1,024 for replies (they should be concise) and 2,048 for proposals.
3. **Truncate job descriptions** to the first 2,000 characters for context. The AI doesn't need the full 5,000-word Upwork posting to write a reply.
4. **Use Haiku for first-draft generation and scoring**, reserve Sonnet for final "polish" or complex proposals.
5. **Add a generation counter** per email thread: warn after 3 regenerations, hard-stop after 5. Show the user estimated cost.
6. **Never auto-generate** -- always require explicit user action (button click) to generate a reply.
7. Log every API call with token counts, cost, and user_id. Build a simple dashboard showing daily/weekly spend.

**Warning signs:**
- No `max_tokens` parameter in API calls.
- No generation count limits in the UI.
- Cost tracking is "we'll add it later."
- Full job descriptions passed as context without truncation.

**Phase to address:**
Phase 3 (Smart Reply Generator). Must be built into the AI integration layer from day one, not bolted on later.

---

### Pitfall 4: LeadHack API as Single Point of Failure

**What goes wrong:**
The system depends entirely on `leadhack.info` for job data. If this external API is down, slow, or changes its contract:
- The job matching feature (email subject + sender -> job details) breaks completely.
- The AI reply generator loses all job context, producing generic, useless replies.
- There's no cached fallback, so the entire value proposition evaporates.
- The API uses JWT authentication that expires, and if token refresh fails, all job lookups fail silently.
- If leadhack.info goes offline permanently (it's a custom service, not a commercial SaaS), the entire system loses its core differentiator.

**Why it happens:**
When you control both systems, you assume the dependency is reliable. External API failure handling is rarely tested because "it always works in dev."

**How to avoid:**
1. **Cache all job data locally** in PostgreSQL. When a job lookup succeeds, store the full response. On subsequent lookups for the same email/subject, use cached data first.
2. **Implement circuit breaker pattern**: after 3 consecutive failures to leadhack, stop making requests for 5 minutes and serve from cache only. Alert the user that "job data may be stale."
3. **Store the leadhack JWT token** with its expiry and refresh proactively. Don't wait for a 401 to refresh.
4. **Design the UI to degrade gracefully**: if no job data is available, still show the email with a "Job context unavailable" banner. Allow manual entry of job details.
5. **Add a response timeout** of 5 seconds to leadhack calls. Do not let a slow external API block the entire inbox loading.
6. **Consider a background sync job** that periodically fetches and caches recent job data, rather than on-demand lookups only.

**Warning signs:**
- No try/catch around leadhack API calls.
- No timeout configuration on HTTP client.
- UI shows a spinner forever when leadhack is slow.
- No local cache table for job data.

**Phase to address:**
Phase 2 (Reply Inbox) for the integration layer. Phase 1 (Configuration) for the API key/token management. The caching and circuit breaker must be designed when building job matching, not after.

---

### Pitfall 5: Gmail API Quota Exhaustion with Multiple Accounts

**What goes wrong:**
Gmail API quotas are per-project (not per-user) with per-user rate limits:
- Default project quota: ~250 quota units per second per user, with different operations costing different units (messages.list = 5 units, messages.get = 5 units, messages.send = 100 units).
- Daily per-user sending limit: 500 emails/day for consumer Gmail, 2,000 for Google Workspace.
- If you poll 5 Gmail accounts every 60 seconds, each poll doing a `messages.list` + up to 20 `messages.get` calls, that's (5 + 20*5) * 5 accounts = 525 quota units per minute. This is fine normally, but spikes (e.g., on reconnect after downtime, doing a full sync) can easily blow through limits.
- Batch requests count against the same quota -- they don't reduce usage, just reduce HTTP overhead.
- 429 (rate limit) responses require exponential backoff. If you retry immediately, Google may ban your project temporarily.

**Why it happens:**
Developers test with 1-2 accounts and extrapolate. They don't account for "thundering herd" scenarios (all accounts reconnecting at once after a server restart) or full re-sync situations.

**How to avoid:**
1. **Stagger account polling**: don't poll all accounts simultaneously. Spread them across the polling interval (e.g., 5 accounts over 60 seconds = poll one account every 12 seconds).
2. **Implement proper exponential backoff** with jitter on 429 responses. Google's recommendation: initial delay 1s, multiply by 2, add random jitter, max 32s.
3. **Use `historyId`-based incremental sync** instead of full message listing. This dramatically reduces API calls after the initial sync.
4. **Cache message metadata** in PostgreSQL. Only fetch full message content when the user opens an email, not on sync.
5. **Use batch API requests** where possible to reduce HTTP overhead (though quota remains the same).
6. **Implement a quota tracker**: count units consumed per account per minute/hour. Throttle before hitting limits rather than reacting to 429s.
7. **Initial sync should be paginated and rate-limited**: when connecting a new account, don't try to fetch all emails at once. Fetch the last 7 days of inbox, then backfill older data asynchronously.

**Warning signs:**
- All accounts polled in a tight loop.
- No exponential backoff implementation.
- Full message fetch on every poll (instead of incremental sync).
- Server restart causes a flood of Gmail API calls.

**Phase to address:**
Phase 2 (Reply Inbox). The sync engine architecture must account for quota from the start.

---

### Pitfall 6: Storing OAuth Tokens and API Keys Insecurely

**What goes wrong:**
This system stores extremely sensitive credentials:
- Gmail OAuth refresh tokens (grant full email access).
- LeadHack API credentials (email + password).
- Anthropic API key (can run up charges on someone's account).
- User authentication tokens.

Common mistakes:
- Storing refresh tokens in plain text in PostgreSQL.
- Logging tokens in error messages or debug output (the existing `morgan("combined")` will log request headers).
- Sending API keys to the frontend for "convenience."
- Not encrypting the database column holding tokens.
- Using `.env` files with secrets in the git repo.

**Why it happens:**
In early development, encryption feels like overhead. "We'll encrypt it later" never happens. And morgan's combined format logs request headers by default, which can include Authorization headers.

**How to avoid:**
1. **Encrypt all tokens at rest** using AES-256-GCM with a key stored in environment variables (not in the database). Use a dedicated encryption utility module.
2. **Never send OAuth tokens or API keys to the frontend**. The frontend should call backend endpoints that use tokens server-side.
3. **Configure morgan** to redact sensitive headers. Create a custom token format that excludes Authorization and Cookie headers.
4. **Use parameterized queries** for all database operations (the `pg` library supports this natively -- never use string interpolation for SQL).
5. **Audit logging**: log that a token was used (account ID, timestamp, operation) but never log the token value itself.
6. **Rotate encryption keys** periodically. Build the encryption layer to support key rotation (store key version alongside encrypted data).

**Warning signs:**
- Tokens stored as plain text columns in PostgreSQL.
- `console.log(token)` or `console.log(response)` statements in auth code.
- API keys passed as query parameters instead of headers.
- Morgan logging full request/response bodies.

**Phase to address:**
Phase 1 (Configuration). Security architecture must be established before any credentials are stored. This is foundational.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Polling Gmail every 10s instead of implementing push | Simpler code, works immediately | Higher API quota usage, slight latency | MVP only -- re-evaluate at 5+ accounts |
| Storing all config in `.env` instead of DB-backed settings | Fast to implement, familiar pattern | Can't change settings without redeploy, no per-user config | Never for user-facing settings; acceptable for infrastructure secrets only |
| Passing full job descriptions to Claude | Better AI context | 2-3x token costs, slower responses | Never -- always truncate/summarize to essential details |
| Single PostgreSQL connection pool for everything | Simple setup | Connection exhaustion under load, no isolation between critical and non-critical queries | MVP with <10 concurrent users |
| Synchronous email sync (blocking API response while fetching Gmail) | Simpler request/response flow | UI freezes during sync, timeout errors, poor UX | Never -- email sync must be background/async |
| Hardcoding Claude model names (e.g., `claude-sonnet-4-20250514`) | Works today | Model versions are deprecated; code breaks when model is retired | Never -- use config/env variable for model selection |
| Using `gmail.readonly` scope "for now" | Easier OAuth verification | Must re-request consent for `gmail.modify` later to send replies; users must re-authenticate | Only if Phase 1 is truly read-only; plan the scope migration |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gmail API (OAuth) | Requesting `gmail.readonly` then needing `gmail.send` later -- forces all users to re-authenticate | Request all needed scopes upfront: `gmail.modify` covers read + send + label. Plan scope requirements before first OAuth flow |
| Gmail API (message parsing) | Assuming email body is always in `payload.body.data` | Gmail message structure is deeply nested and varies: multipart/alternative, multipart/mixed, nested parts. Must recursively walk `payload.parts[]` to find text/plain or text/html. Build a robust parser, not a happy-path one |
| Gmail API (threads vs messages) | Treating each message independently | Gmail groups messages into threads. Users expect to see conversation threads, not individual messages. Use `threads.list()` + `threads.get()` instead of `messages.list()` for inbox display |
| LeadHack API | Assuming the job lookup always returns data | Many emails won't match any job (spam, non-Upwork emails, new clients). The `getJobDetails` endpoint may return empty results for valid Upwork emails if the job wasn't scraped yet. Handle "no match" as a normal case, not an error |
| LeadHack API | Not handling JWT expiry | The auth token from `getAuthToken` expires. Store expiry time and refresh proactively. Don't discover it's expired when a user needs job data |
| Claude API | Not handling streaming errors mid-response | If using streaming (`stream: true`), the connection can drop mid-generation. Must handle partial responses gracefully -- either retry or show what was generated so far with a "generation interrupted" message |
| Claude API | Not setting `system` prompt separately from user message | The system prompt should define the AI's role/tone/constraints. User message should contain the specific email context. Mixing them reduces quality and makes prompt management harder |
| Google OAuth | Using `prompt: 'consent'` on every auth request | This forces the user to re-approve every time. Use `prompt: 'consent'` only on first auth. For re-auth of expired tokens, use `prompt: 'none'` first, fall back to `prompt: 'consent'` only if needed |
| Google OAuth | Not storing the `id_token` claims for account identification | Use the `sub` (subject) claim from the ID token as the stable account identifier, not the email address (users can change their email). Store `sub` as the foreign key linking Gmail accounts to your system |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching full email content on inbox list load | Page load > 5s, high memory usage | Fetch only headers/snippets for list view. Load full body on-demand when user clicks an email | 50+ emails in inbox |
| No pagination on email list queries | Slow queries, high memory, browser tab crashes | Implement cursor-based pagination (using Gmail's `nextPageToken`). Show 25-50 emails per page | 200+ emails |
| Generating AI reply on the main request thread | Request timeouts (Railway default 30s), blocked Express event loop | Use background job (Bull/BullMQ with Redis, or a simple in-memory queue for MVP). Return immediately with a job ID, poll for completion | Any Claude API call (typically 3-10s latency) |
| Storing email bodies as large text columns without indexing strategy | Full table scans on search, bloated database | Store email metadata (from, to, subject, date, snippet) separately from full body. Index metadata columns. Load body on-demand | 10,000+ emails |
| Running all Gmail account syncs sequentially | Sync time = N accounts * sync_time_per_account. 5 accounts * 5s = 25s total | Run syncs concurrently with `Promise.allSettled()` but respect per-user rate limits. Use a queue if > 10 accounts | 3+ Gmail accounts |
| No database connection pooling limits | PostgreSQL "too many connections" error | Set `max` pool size in `pg.Pool` configuration (default is 10; appropriate for small deployments). Monitor active connections | 20+ concurrent requests |
| Caching job data with no TTL | Stale job data shown to users, wrong context for AI replies | Set cache TTL of 24 hours for job details. Allow manual refresh. Show "last updated" timestamp | When job details change on Upwork |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| VA users can see/modify other VAs' Gmail tokens | Account compromise -- a disgruntled VA could access another person's email | Strict row-level access: VAs can only see accounts they're assigned to. Owner can see all. Never expose token values through any API endpoint |
| Gmail OAuth redirect URI not restricted | OAuth token theft via redirect manipulation | Register exact redirect URIs in Google Cloud Console. Never use wildcard or localhost in production |
| Storing Anthropic API key in client-accessible config | Anyone with browser DevTools can steal the API key and run up charges | API key stays server-side only. Frontend calls your backend, which proxies to Claude. Never put API keys in environment variables that are bundled into frontend code |
| No rate limiting on AI generation endpoint | A malicious or buggy client could trigger hundreds of Claude API calls per minute | Implement per-user rate limiting: max 10 generation requests per minute. Use express-rate-limit or a token bucket in Redis |
| Email content (potentially containing passwords, personal data) logged to stdout | Log aggregation services store sensitive customer data | Sanitize all log output. Never log email bodies, subject lines, or recipient addresses at INFO level. Use structured logging with explicit field selection |
| CORS configured as `cors()` with no origin restriction | Any website can make authenticated requests to your API | Configure CORS with explicit origin whitelist matching your frontend domain. The current `cors()` setup allows all origins -- must be fixed before production |
| JWT session tokens with no expiry or long expiry | Stolen session tokens remain valid indefinitely | Set JWT expiry to 1-8 hours. Implement refresh token rotation. Store a token blacklist for forced logout |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing AI-generated reply without clear "this is a draft" indicator | VA accidentally sends unreviewed AI text to a client, damaging the freelancer's reputation | Always show AI replies in a distinct "draft" state with a different background color. Require explicit "Approve & Send" action. Never auto-send |
| No way to see/edit the AI prompt that generated the reply | Users can't improve output quality. Black box frustration | Show the system prompt template. Allow power users (owner role) to customize tone/instructions per account or per category |
| Email inbox doesn't show which emails have been replied to | Users re-reply to emails or miss ones that need responses | Clear visual status indicators: Unreplied (red dot), Draft (yellow), Sent (green check). Filter by status |
| Job context panel takes up too much screen space | Email content is cramped, hard to read and reply | Collapsible side panel for job details. Default to collapsed with a summary line. Full panel on demand |
| No keyboard shortcuts for power users (VAs processing many emails) | Slow workflow. Mouse-heavy interaction for repetitive tasks | j/k for next/previous email, r for reply, g for generate AI reply, Enter to approve. Show shortcut hints |
| Dark/light mode toggle doesn't persist or flashes wrong theme on load | Jarring white flash on page load in dark mode. Toggle resets on refresh | Store theme preference in localStorage AND user profile (server). Apply theme via `<html>` class before React hydrates (use a blocking `<script>` in `<head>`) to prevent flash |
| Sync status not visible to users | Users don't know if their inbox is current. Mistrust the system | Show "Last synced: 2 minutes ago" per account. Show sync-in-progress indicator. Allow manual "Sync now" button |
| Error messages are technical (showing API error codes) | Users see "Error 429" or "UNAUTHENTICATED" and don't know what to do | Map all API errors to human-friendly messages: "Gmail is temporarily busy, retrying..." or "Your Gmail connection expired. Click here to reconnect" |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Gmail OAuth flow:** Often missing token refresh logic -- verify that tokens refresh automatically before expiry, not just on 401 error
- [ ] **Gmail OAuth flow:** Often missing revocation handling -- verify the app detects when a user revokes access from Google Account settings and shows re-auth prompt
- [ ] **Email sync:** Often missing incremental sync -- verify the system uses `historyId` for delta updates, not full re-fetch on every poll
- [ ] **Email sync:** Often missing duplicate detection -- verify the same email isn't inserted twice if sync runs while a previous sync is still processing
- [ ] **AI reply generation:** Often missing error handling for partial/failed generation -- verify the UI handles timeout, rate limit, and network errors gracefully
- [ ] **AI reply generation:** Often missing input sanitization -- verify that email content with special characters, HTML, or very long text doesn't break the prompt template
- [ ] **Multi-account inbox:** Often missing account-specific error isolation -- verify that one account's auth failure doesn't block sync for other accounts
- [ ] **Job matching:** Often missing the "no match" state -- verify the UI works when leadhack returns no job data (most emails won't match)
- [ ] **Role-based access:** Often missing row-level filtering -- verify VAs can't access other accounts' data by modifying API request parameters
- [ ] **Configuration page:** Often missing validation -- verify that entering an invalid API key or email shows a helpful error, not a silent failure or crash
- [ ] **Send email:** Often missing sent-mail sync -- verify that emails sent through the system appear in Gmail's Sent folder and in the local conversation thread
- [ ] **Theme toggle:** Often missing server-side persistence -- verify theme preference survives clearing localStorage (synced to user profile)

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| OAuth tokens all expired (7-day testing mode) | MEDIUM | 1. Push app to "Production" status in Google Console. 2. Trigger re-auth for all connected accounts. 3. Notify users via email/UI banner. 4. Implement proactive token health check to prevent recurrence |
| Claude API cost overrun | LOW | 1. Set a hard spend cap in Anthropic dashboard. 2. Disable AI generation temporarily. 3. Audit usage logs to find the source (regeneration loops, missing max_tokens, wrong model). 4. Implement per-user budgets before re-enabling |
| LeadHack API goes down permanently | HIGH | 1. Serve from cached job data (this is why caching is critical from day one). 2. Build a manual job entry form as stopgap. 3. Evaluate alternative data sources (Upwork RSS feeds directly, other scraping services). 4. Consider bringing job scraping in-house |
| Gmail quota exceeded, project throttled | MEDIUM | 1. Reduce polling frequency immediately. 2. Implement staggered polling. 3. Check for sync loops or bugs causing excessive API calls. 4. Request quota increase from Google Cloud Console (takes 24-48 hours). 5. Switch to incremental sync if not already implemented |
| Sensitive data leaked in logs | HIGH | 1. Immediately rotate all affected tokens/keys. 2. Clear log storage. 3. Audit log pipeline for other sensitive data. 4. Implement structured logging with explicit field allow-listing. 5. Add automated log scanning for token-like patterns |
| AI sends inappropriate/hallucinated reply to client | HIGH | 1. Immediately disable auto-send if it was enabled. 2. Add mandatory human review step. 3. Implement content safety checks (profanity filter, hallucination detection -- check for fabricated URLs, false claims). 4. Add "undo send" with a 10-second delay before actually sending |
| Database corruption/data loss | HIGH | 1. Restore from Railway's automatic backups (verify backup schedule is configured). 2. Re-sync emails from Gmail (emails are the source of truth, your DB is a cache). 3. Re-fetch job data from leadhack. 4. User accounts/settings must be backed up separately -- implement regular pg_dump schedule |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| OAuth token silent expiry | Phase 1: Configuration | Token health check endpoint returns healthy for all accounts after 8+ days of uptime |
| OAuth token insecure storage | Phase 1: Configuration | Tokens encrypted at rest; decrypted only in memory during API calls; no tokens in logs |
| CORS misconfiguration | Phase 1: Configuration | `cors()` replaced with explicit origin whitelist; tested that cross-origin requests from unknown domains are rejected |
| Gmail watch expiry | Phase 2: Reply Inbox | Inbox receives new emails within 2 minutes of arrival after 8+ days without manual intervention |
| Gmail quota exhaustion | Phase 2: Reply Inbox | System operates normally with 5 Gmail accounts polling every 60s for 24 hours without 429 errors |
| Email parsing failures | Phase 2: Reply Inbox | Test with multipart, HTML-only, plain-text-only, attachment-heavy, and non-English emails |
| LeadHack single point of failure | Phase 2: Reply Inbox | Inbox loads and functions (without job context) when leadhack is unreachable; cached data shown for previously matched jobs |
| AI cost explosion | Phase 3: Smart Reply | Daily cost stays within configured budget with 5 VAs generating 50 replies/day each |
| AI hallucination/quality | Phase 3: Smart Reply | Generated replies reviewed by human before send; no fabricated URLs, prices, or capabilities |
| AI generation blocking UI | Phase 3: Smart Reply | UI remains responsive during generation; shows progress indicator; handles timeout after 30s |
| VA accessing other accounts' data | Phase 4: Auth & Roles (or Phase 1 if auth is foundational) | VA-scoped API token returns 403 when requesting data outside their assigned accounts |
| Theme flash on page load | Phase 5 or embedded in Phase 1 frontend | Dark mode users see no white flash on full page reload |
| Stale job data | Phase 2: Reply Inbox | Job data shows "last updated" timestamp; cache TTL enforced; manual refresh available |

## Additional Domain-Specific Warnings

### Upwork-Specific Pitfalls

**Upwork has no public API and actively discourages scraping.** The reliance on leadhack.info for job data means:
- If Upwork changes their page structure, leadhack's scraping breaks and your data pipeline stops.
- Upwork could send a cease-and-desist to leadhack, shutting down the data source.
- Job data freshness is limited by leadhack's scraping frequency, which you don't control.
- Email subjects from Upwork follow specific patterns (e.g., "New Upwork Message from [Client Name]"), but these patterns can change without notice.

**Mitigation:** Design the system to function (in degraded mode) without job context. The email management and reply features should work independently. Job matching is a value-add, not a hard dependency.

### Email-to-Job Matching Fragility

**What goes wrong:** Matching incoming emails to Upwork jobs via email subject + sender is inherently fragile:
- Clients may reply from a different email address than the one on their Upwork profile.
- Email subjects get mangled by forwarding, auto-translation, or client email clients.
- A client may discuss multiple jobs in one email thread.
- The leadhack `getJobDetails` API may return multiple matches or no matches.

**Mitigation:**
1. Implement fuzzy matching (not exact string comparison) for subjects.
2. Allow manual job linking: "This email is about [select job]."
3. Show match confidence score in the UI.
4. Cache successful matches to improve future lookups from the same sender.

### Multi-Account Email Identity Confusion

**What goes wrong:** When managing multiple Gmail accounts, the system must track which account is replying. Common mistakes:
- Sending a reply from Account B when the original email arrived at Account A.
- Showing emails from all accounts interleaved without clear account indicators.
- OAuth confusion: refreshing the wrong account's token, or mixing up which refresh token belongs to which account.

**Mitigation:**
1. Color-code or badge each email with its source account.
2. When replying, auto-select the receiving account and lock it (prevent accidental send from wrong account).
3. Store OAuth tokens with a strict 1:1 relationship to Gmail email address. Use the Google `sub` claim as the unique identifier.

## Sources

- Gmail API quotas and limits: Google Developers documentation (developers.google.com/gmail/api/reference/quota) -- MEDIUM confidence, based on training data through May 2025. Specific quota numbers should be verified against current docs.
- Google OAuth2 token expiry behavior: Google Identity documentation (developers.google.com/identity/protocols/oauth2) -- HIGH confidence for core mechanics (7-day testing mode, refresh token behavior), these are long-standing documented behaviors.
- Gmail API push notifications (watch): Google Developers documentation (developers.google.com/gmail/api/guides/push) -- HIGH confidence for 7-day watch expiry and Cloud Pub/Sub requirement.
- Claude API rate limits and pricing: Anthropic documentation (docs.anthropic.com) -- MEDIUM confidence, pricing tiers and rate limits change. Verify current values before implementation.
- OAuth security best practices: OWASP OAuth Security Cheat Sheet -- HIGH confidence for standard security recommendations.
- Email parsing complexity: Direct experience with Gmail API message structure (multipart MIME) -- HIGH confidence, this is a well-known pain point in every Gmail API integration.

**Confidence note:** All findings are based on training data through May 2025. WebSearch and WebFetch tools were unavailable during this research session. Before implementation, the following should be verified against current documentation:
1. Exact Gmail API quota numbers (may have changed)
2. Current Claude API pricing tiers and rate limits
3. Google OAuth verification timeline and requirements
4. LeadHack API current status and documentation

---
*Pitfalls research for: Upwork Proposal & Reply Cockpit (LMS Reply)*
*Researched: 2026-02-28*
