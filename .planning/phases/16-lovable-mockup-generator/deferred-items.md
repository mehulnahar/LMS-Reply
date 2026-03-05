# Deferred Items — Phase 16: Lovable Mockup Generator

## From Plan 03 (TDD Tests)

1. **content_writ regex word boundary edge case** — The `content\s?writ` pattern in SERVICE_NO_CATEGORIES uses `\b` (word boundary) which prevents matching "content writing" because "writ" is not at a word boundary inside "writing". The regex matches "content writ" but not "content writing". This means inputs like "Content writing for tech blog" fall through to `unknown` instead of `content`. Fix: change to `content\s?writing?` or remove trailing `\b` from the group. Pre-existing in mockupDecision.js from Plan 01, not caused by Plan 03.
