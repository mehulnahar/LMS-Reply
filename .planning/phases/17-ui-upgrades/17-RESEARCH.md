# Phase 17: UI Upgrades - Research

**Researched:** 2026-03-06
**Domain:** React frontend UI components (reply editor upgrades, validation surfaces)
**Confidence:** HIGH

## Summary

Phase 17 is a pure frontend phase. All the heavy backend work (validation, signal detection, thread context, mockup decisions) was completed in Phases 13-16. The backend already computes and stores job analysis blocks, link analysis blocks, banned phrase violations, word counts, next-step detection, and prompt type routing. The task is to surface this intelligence in the reply editor UI within `client/src/pages/Inbox.jsx` and supporting components.

The codebase is React 19 + Vite + Tailwind CSS with zero component library dependencies. All UI is hand-built with Tailwind utility classes. The Inbox.jsx file is the monolith containing all reply editor logic (~1460 lines). Some of the UIUP requirements are already partially implemented (word count, next-step warning, prompt badge, banned phrase list), but need upgrades to match the full spec (highlighting inside the editor, mode toggle, variant A/B selection, collapsible analysis panel).

**Primary recommendation:** Decompose Inbox.jsx by extracting the reply editor into a dedicated `ReplyEditor` component (or multiple sub-components), add the missing analysis panel and variant selector, and upgrade existing partial implementations (banned phrase highlighting, copy-blocking in Flag mode, dynamic word limits) to match the full UIUP spec.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UIUP-01 | Collapsible analysis panel above reply editor showing [JOB ANALYSIS] and [LINK ANALYSIS] blocks; collapsed by default; never in clipboard output | Backend stores `job_analysis_block` and `link_analysis_block` on the `replies` table (migration 006) but does NOT return them in the `/api/replies/generate` response. Must add these fields to the response JSON. Frontend needs a `<details>` or state-driven collapsible panel. Session persistence via `useState` (not localStorage). Clipboard already only copies `replyText` (line 427) so analysis panel content is naturally excluded. |
| UIUP-02 | Banned phrase violations highlighted red IN the editor after generation; Settings toggle between "Auto-rewrite" and "Flag" modes; Flag mode blocks copy until resolved; dashboard metric for violations caught this week | Backend already returns `bannedPhraseViolations` array with `{phrase, index, category, replacement}`. Current UI shows violations as a list BELOW the editor (lines 1379-1403), not highlighted INSIDE the text. Need: (1) a rich-text or overlay approach to highlight phrases in-place, (2) a user setting for mode toggle (new DB column + Settings UI), (3) copy-blocking logic in Flag mode, (4) dashboard metric (new API endpoint or query). |
| UIUP-03 | Live word count below editor: "X / [limit] words" with green/yellow/red colors; limit changes dynamically by classification | Already fully implemented in current codebase (lines 480-496, 1438-1443). `wordCount`, `wordLimit`, `wordCountColor` all computed correctly with dynamic limits based on `activePromptType`, `replyIntent`, and `followUpSequence`. This requirement is MET. Verification needed only. |
| UIUP-04 | Reply editor header shows "Using: [Prompt Name]" badge; manual override dropdown next to badge; selecting different prompt triggers re-generation; prompt_used recorded on reply_generations | Already fully implemented. Badge at line 1146-1150. Override dropdown at lines 1162-1171 with `PROMPT_OPTIONS`. Re-generation triggers `handleGenerate()` which sends `promptOverride`. `prompt_used` is already written to `reply_generations` (line 699). This requirement is MET. Verification needed only. |
| UIUP-05 | For Reply V2 and Follow-Up V2 (2 variants), both Variant A (Direct) and Variant B (Value-First) displayed side-by-side or in tabs; user must select one before copy button activates; variant_selected recorded on reply_generations | NOT implemented at all. Backend currently generates a single reply text. Must either: (a) have backend generate 2 variants in a single call (parse them from the response), or (b) make 2 parallel Claude calls. Frontend needs a tab/side-by-side selector. `variant_selected` column exists on `reply_generations` (VARCHAR 50) but is never written to. Requires backend change to produce 2 variants AND frontend to display/select them. |
| UIUP-06 | Next-step validation: yellow warning bar if no clear next step; copy button remains functional (soft warning); warning disappears when user edits to add next step | Already fully implemented. Warning bar at lines 1370-1377. Client-side re-evaluation on keystroke at lines 1357-1364. Copy button is NOT blocked (handleCopy has no guard). This requirement is MET. Verification needed only. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.0.0 | UI framework | Already in use; no version change needed |
| Tailwind CSS | 3.4.17 | Utility CSS | Already in use; provides all styling patterns needed |
| Vite | 6.0.7 | Build tool | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | All UIUP requirements can be built with existing React + Tailwind stack |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS overlay for highlighting | Slate.js / Draft.js rich text editor | Massive complexity increase for one feature; textarea with overlay spans is simpler and matches existing patterns |
| Hand-built tabs | Headless UI tabs | Adds a dependency for one component; the existing codebase hand-builds everything with Tailwind |
| `localStorage` for panel state | `useState` only | Spec says "session persistence" meaning current browser session; `useState` resets on page refresh which is acceptable for "session" |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
client/src/
  pages/
    Inbox.jsx           # Main inbox (refactored — delegates to components)
  components/
    ReplyEditor/
      ReplyEditor.jsx         # Orchestrator for the reply editing area
      AnalysisPanel.jsx        # UIUP-01: Collapsible [JOB ANALYSIS] + [LINK ANALYSIS]
      VariantSelector.jsx      # UIUP-05: Side-by-side or tabbed A/B variant selection
      BannedPhraseHighlight.jsx # UIUP-02: Textarea overlay with red highlights
      WordCounter.jsx           # UIUP-03: Already exists inline; extract for clarity
      NextStepWarning.jsx       # UIUP-06: Already exists inline; extract for clarity
```

**Alternative (simpler):** Keep everything in Inbox.jsx (matching existing pattern) and just add the new sections inline. The file is already ~1460 lines. Adding ~200-300 more lines for the new features is manageable if the team prefers avoiding new component files. Both approaches work.

### Pattern 1: Textarea with Highlight Overlay (UIUP-02)
**What:** A container div holds both a transparent `<textarea>` for editing and a background `<div>` that renders the same text with banned phrases wrapped in red `<mark>` tags. They share identical font, padding, and sizing so the highlights align perfectly behind the text.
**When to use:** When you need inline highlighting in an editable text area without a full rich-text editor.
**Example:**
```jsx
// Overlay highlighting pattern (no external library)
function HighlightedTextarea({ value, onChange, highlights }) {
  return (
    <div className="relative">
      {/* Background layer: rendered text with highlights */}
      <div
        className="absolute inset-0 px-4 py-3 text-sm whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
        aria-hidden="true"
      >
        {renderHighlighted(value, highlights)}
      </div>
      {/* Foreground: transparent textarea for editing */}
      <textarea
        value={value}
        onChange={onChange}
        className="relative w-full px-4 py-3 text-sm bg-transparent caret-black dark:caret-white resize-y"
        style={{ color: 'transparent', caretColor: 'inherit' }}
      />
    </div>
  );
}

function renderHighlighted(text, highlights) {
  if (!highlights || highlights.length === 0) return text;
  // Sort highlights by index to process left-to-right
  const sorted = [...highlights].sort((a, b) => a.index - b.index);
  const parts = [];
  let cursor = 0;
  for (const h of sorted) {
    if (h.index > cursor) parts.push(text.slice(cursor, h.index));
    parts.push(
      <mark key={h.index} className="bg-red-200 dark:bg-red-800/40 text-red-800 dark:text-red-300 rounded px-0.5">
        {text.slice(h.index, h.index + h.phrase.length)}
      </mark>
    );
    cursor = h.index + h.phrase.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
```

### Pattern 2: Variant A/B Selector (UIUP-05)
**What:** After generation, if the prompt type is `EMAIL_REPLY_V2` or `FOLLOW_UP_V2`, display two panels (tabs or side-by-side) with Variant A and Variant B. Copy button is disabled until one is selected.
**When to use:** When the backend returns 2 variants in its response.
**Example:**
```jsx
function VariantSelector({ variantA, variantB, selected, onSelect }) {
  return (
    <div className="flex gap-2 mb-3">
      <button
        onClick={() => onSelect('A')}
        className={`flex-1 px-3 py-1.5 text-xs rounded-md border ${
          selected === 'A' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        Variant A — Direct
      </button>
      <button
        onClick={() => onSelect('B')}
        className={`flex-1 px-3 py-1.5 text-xs rounded-md border ${
          selected === 'B' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        Variant B — Value-First
      </button>
    </div>
  );
}
```

### Pattern 3: Collapsible Panel (UIUP-01)
**What:** HTML `<details>` element with Tailwind styling, or a state-driven panel. `<details>` is simplest and matches the existing mockup analysis pattern (line 1266 uses `<details>`).
**When to use:** Collapsible content that should be collapsed by default.
**Example:**
```jsx
// Already used in the codebase at line 1266 for mockup analysis
<details className="text-xs text-gray-500 dark:text-gray-400">
  <summary className="cursor-pointer font-medium hover:text-gray-700 dark:hover:text-gray-300">
    Analysis Panel
  </summary>
  <div className="mt-2 space-y-2">
    {jobAnalysisBlock && <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-lg p-3">{jobAnalysisBlock}</pre>}
    {linkAnalysisBlock && <pre className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-lg p-3">{linkAnalysisBlock}</pre>}
  </div>
</details>
```

### Anti-Patterns to Avoid
- **Adding a rich-text editor library for one feature:** Slate.js, Draft.js, TipTap, etc. are overkill for banned phrase highlighting. The overlay pattern is simpler, lighter, and matches the existing hand-built approach.
- **Making the textarea a `contenteditable` div:** Breaks keyboard behavior, loses undo/redo, introduces XSS vectors. Keep the native `<textarea>`.
- **Storing analysis panel expanded state in localStorage:** The spec says "persists for the session" which means current page visit, not across browser restarts. `useState` is correct.
- **Blocking copy for next-step warning:** UIUP-06 explicitly says "copy button remains functional (soft warning, not hard block)". Only UIUP-02 Flag mode blocks copy.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible panels | Custom accordion with state management | HTML `<details>` + `<summary>` | Native browser behavior, accessible by default, already used in codebase |
| Text highlighting in textarea | Custom contenteditable div | Transparent textarea + background overlay div | Proven pattern, no accessibility issues, no library needed |
| Tab switching for variants | Full tab component library | Two buttons + conditional rendering | Only 2 states needed; a tab library is overkill |

**Key insight:** This phase requires zero new npm dependencies. Everything is achievable with React state, Tailwind classes, and standard HTML elements. The existing codebase patterns (inline Tailwind, `<details>`, SVG icons, `useState`) should be followed exactly.

## Common Pitfalls

### Pitfall 1: Textarea/Overlay Synchronization
**What goes wrong:** The highlight overlay and the transparent textarea get out of sync — text wraps differently, scroll positions diverge, or font rendering differs between the `<div>` and `<textarea>`.
**Why it happens:** `<textarea>` and `<div>` have different default CSS for line-height, padding, font-family, word-break, and scrolling.
**How to avoid:** Share IDENTICAL CSS properties: same `font-family`, `font-size`, `line-height`, `padding`, `border`, `word-break`, and `white-space`. Use `whitespace-pre-wrap` and `break-words` on the overlay div. Set the overlay div to `overflow: hidden` (not `auto`) to prevent its own scrollbar. Sync scroll position using `onScroll` on the textarea.
**Warning signs:** Highlights appear shifted by 1-2 pixels; text wraps at different points in overlay vs textarea.

### Pitfall 2: Banned Phrase Index Stale After Edit
**What goes wrong:** User edits the text, but the `bannedPhraseViolations` array still holds indexes from the original generated text. Highlights appear at wrong positions.
**Why it happens:** The violations array from the backend is computed once at generation time. Editing text shifts character positions.
**How to avoid:** Re-scan the text client-side after each edit (or debounced). Use `String.indexOf()` to find current positions of banned phrases in the current text. If a phrase is no longer found, remove it from the highlight list.
**Warning signs:** Red highlights appear on wrong words after user edits.

### Pitfall 3: Two-Variant Generation Doubles API Cost
**What goes wrong:** Generating both Variant A and Variant B means 2 Claude API calls per generation, doubling token usage.
**Why it happens:** Each variant needs a separate prompt or a single prompt that explicitly asks for 2 outputs.
**How to avoid:** Use a SINGLE Claude call with a system prompt that requests both variants in one response, separated by a clear delimiter (e.g., `---VARIANT A---` and `---VARIANT B---`). Parse both from the single response. This is the approach used by the prompt documents (Reply V2 and Follow-Up V2 already have dual-variant output instructions built into their templates).
**Warning signs:** Generation time doubles; API costs increase.

### Pitfall 4: Analysis Panel Data Not Returned by API
**What goes wrong:** Frontend tries to display `jobAnalysisBlock` and `linkAnalysisBlock` but the generate response does not include them.
**Why it happens:** The backend stores these in the DB (`replies` table, migration 006) but the response builder at line 741-776 of `replies.js` does NOT include `jobAnalysisBlock` or `linkAnalysisBlock` in the JSON response.
**How to avoid:** Must add `jobAnalysisBlock` and `linkAnalysisBlock` to the `responseBody.reply` object in `replies.js`. This is a small backend change required before the frontend can work.
**Warning signs:** Analysis panel always shows "No analysis available".

### Pitfall 5: Copy-Blocking in Flag Mode Must Be Conditional
**What goes wrong:** Copy button is always blocked when banned phrases exist, even in Auto-rewrite mode.
**Why it happens:** Developer implements copy-blocking without checking the current mode setting.
**How to avoid:** Check the user's banned phrase mode preference before applying copy block. In "Auto-rewrite" mode, phrases are already rewritten so copy should work. In "Flag" mode, copy is blocked ONLY when unresolved violations remain (violations with no replacement that the user hasn't manually fixed).
**Warning signs:** Copy button is disabled even though all phrases were auto-rewritten.

### Pitfall 6: Variant Selection Not Persisted to reply_generations
**What goes wrong:** User selects Variant A or B, copies it, but the `variant_selected` field on `reply_generations` is never updated.
**Why it happens:** The current `reply_generations` INSERT at line 692-709 of `replies.js` does not write `variant_selected` (it passes no value).
**How to avoid:** Either: (a) update `variant_selected` when the user copies via a new API endpoint, or (b) include `variant_selected` in the initial insert after the frontend sends back which variant was chosen.
**Warning signs:** Analytics queries on `variant_selected` always return NULL.

## Code Examples

### Backend: Add Analysis Blocks to Response (required change)
```javascript
// In src/routes/replies.js, line ~741, add to responseBody.reply:
const responseBody = {
  reply: {
    // ... existing fields ...
    jobAnalysisBlock: jobAnalysisBlock || null,    // ADD THIS
    linkAnalysisBlock: linkAnalysisBlock || null,  // ADD THIS
    // ... rest of fields ...
  },
};
```

### Backend: Variant A/B Parsing (required change)
```javascript
// In src/routes/replies.js, after extractInternalBlocks:
// Parse dual variants if Reply V2 or Follow-Up V2
let variantA = null;
let variantB = null;
if (promptType === 'EMAIL_REPLY_V2' || promptType === 'FOLLOW_UP_V2') {
  const variantSplit = cleanText.split(/---\s*VARIANT\s*B\s*---/i);
  if (variantSplit.length === 2) {
    variantA = variantSplit[0].replace(/---\s*VARIANT\s*A\s*---/i, '').trim();
    variantB = variantSplit[1].trim();
  }
  // If no variant markers found, treat entire text as single variant (backwards compatible)
}
```

### Frontend: Banned Phrase Mode Setting
```javascript
// New user_settings column or localStorage key for banned phrase mode
// Options: 'auto_rewrite' (default) or 'flag'
const [bannedPhraseMode, setBannedPhraseMode] = useState(
  localStorage.getItem('bannedPhraseMode') || 'auto_rewrite'
);
```

### Frontend: Variant Selection State
```javascript
const [variantA, setVariantA] = useState(null);
const [variantB, setVariantB] = useState(null);
const [selectedVariant, setSelectedVariant] = useState(null);  // 'A' or 'B' or null

// In handleGenerate, after receiving response:
if (data.reply.variantA && data.reply.variantB) {
  setVariantA(data.reply.variantA);
  setVariantB(data.reply.variantB);
  setSelectedVariant(null);  // Force user to pick
  setReplyText('');  // Don't pre-fill until variant is selected
} else {
  setVariantA(null);
  setVariantB(null);
  setSelectedVariant(null);
  setReplyText(data.reply.generatedText);
}

// Copy button disabled when variants exist but none selected:
const copyDisabled = (variantA && variantB && !selectedVariant);
```

### API: Update variant_selected on reply_generations
```javascript
// New endpoint or modify markReplyCopied to accept variant
router.put("/:id/variant", requireAuth, async (req, res, next) => {
  const { variant } = req.body; // 'A' or 'B'
  // Update the reply_generations record
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Banned phrase list below editor | Overlay highlights inside editor text | This phase | Users see violations in-context, not separate list |
| Single variant output | Dual variant A/B selection | This phase | Matches Reply V2 and Follow-Up V2 prompt design |
| No analysis visibility | Collapsible analysis panel | This phase | Team can verify AI context without copy-paste contamination |

**Deprecated/outdated:**
- The current banned phrase list (lines 1379-1403) will be replaced by in-editor highlighting. The list below could remain as a secondary view or be removed.
- The current plain `<textarea>` for reply editing will gain an overlay layer for highlighting.

## Open Questions

1. **Variant A/B delimiter format in prompt templates**
   - What we know: Reply V2 and Follow-Up V2 prompts are stored in `prompt_templates` table and were designed to produce 2 variants. The exact delimiter format in the stored templates needs verification.
   - What's unclear: Do the stored prompt templates already instruct Claude to output `---VARIANT A---` and `---VARIANT B---` markers? Or is the format different?
   - Recommendation: Read the actual prompt template content from the DB (or seed script) before implementing the parser. Design the parser to be flexible with whitespace and casing.

2. **Banned phrase mode storage location**
   - What we know: UIUP-02 says "Settings shows a toggle". This implies a persistent user preference.
   - What's unclear: Should this be stored in a new DB column (user_settings table?) or in localStorage? The existing codebase has no user_settings/preferences table.
   - Recommendation: Use a new `user_preferences` table row or add a column to `users` table. If the team prefers speed over correctness, `localStorage` works but won't sync across devices.

3. **Dashboard metric for banned phrases caught this week**
   - What we know: UIUP-02 requires a dashboard metric. The Dashboard.jsx currently shows basic status cards only.
   - What's unclear: Should this be a new API endpoint (e.g., `GET /api/analytics/banned-phrase-stats`) or piggyback on an existing endpoint?
   - Recommendation: New API endpoint that queries `replies` table: `SELECT SUM(banned_phrases_caught) FROM replies WHERE created_at >= NOW() - INTERVAL '7 days' AND user_id = $1`.

4. **Whether UIUP-04 override dropdown should trigger immediate re-generation**
   - What we know: Current implementation lets user pick from dropdown, then click "Generate Reply". The spec says "selecting a different prompt from the dropdown triggers a re-generation."
   - What's unclear: Should changing the dropdown auto-trigger generation (no button click needed)?
   - Recommendation: Auto-trigger re-generation when the user changes the dropdown AND there is already a generated reply. If no reply exists yet, just set the override for the next generation.

## Inventory of What Already Works vs What Needs Building

### Already Implemented (verify only)
- **UIUP-03** (word count): Lines 480-496 compute; lines 1438-1443 render. Dynamic limits based on prompt type, intent, and follow-up sequence.
- **UIUP-04** (prompt badge + override): Badge at lines 1146-1150. Override dropdown at lines 1162-1171. Backend records `prompt_used` on `reply_generations`.
- **UIUP-06** (next-step warning): Warning bar at lines 1370-1377. Client-side re-evaluation on edit. Copy button NOT blocked (correct per spec).

### Partially Implemented (upgrade needed)
- **UIUP-02** (banned phrases): Violations LIST below editor exists (lines 1379-1403). Missing: in-editor RED HIGHLIGHTS, mode toggle in Settings, copy-blocking in Flag mode, dashboard metric.

### Not Implemented (build from scratch)
- **UIUP-01** (analysis panel): Backend stores data but does not return it in API response. Frontend has zero analysis panel code.
- **UIUP-05** (variant A/B selection): Backend generates single variant. No parsing, no UI, no `variant_selected` tracking.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `client/src/pages/Inbox.jsx` (lines 1-1460) — current reply editor implementation
- Direct codebase analysis: `src/routes/replies.js` (lines 1-1100+) — backend response shape, validation pipeline
- Direct codebase analysis: `src/utils/validateReply.js` — bannedPhraseScanner, nextStepScanner signatures
- Direct codebase analysis: `src/config/migrations/005_v2_prompt_foundation.sql` — `reply_generations.variant_selected` column
- Direct codebase analysis: `src/config/migrations/006_reply_analysis_columns.sql` — `replies.job_analysis_block`, `replies.link_analysis_block`
- Direct codebase analysis: `client/package.json` — React 19, no component libraries
- Direct codebase analysis: `client/tailwind.config.js` — custom brand colors, dark mode via class

### Secondary (MEDIUM confidence)
- Textarea overlay highlighting pattern is a well-established pattern used in code editors and form validators. No library needed; CSS synchronization is the main challenge.

### Tertiary (LOW confidence)
- Exact variant delimiter format in stored prompt templates needs verification from DB content.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - direct codebase inspection, no new libraries needed
- Architecture: HIGH - patterns derived directly from existing codebase conventions
- Pitfalls: HIGH - identified from code analysis (missing API fields, stale indexes, cost doubling)
- Open questions: MEDIUM - variant delimiter format and settings storage need DB inspection

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable — no external API or library version concerns)
