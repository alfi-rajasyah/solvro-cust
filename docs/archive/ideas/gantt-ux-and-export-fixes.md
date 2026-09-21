# Gantt UX + Production Export Fixes

Refined 2026-07-20 from four TAM bug reports. Companion implementation plan:
`docs/plans/gantt-ux-and-export-fixes-plan.md`.

## 1 · Exports hang in production (VPN/LAN-only deployment)

> **CORRECTED 2026-07-31 — the diagnosis in this section is wrong.** The real
> cause is Chromium's insecure-download blocking, keyed on the origin scheme
> (`http://solvro.elitery.local`), not Safe Browsing and not the VPN's egress.
> Chromium's download-protection ping is capped at 7 s
> (`kDownloadRequestTimeoutMs`), so it cannot hang a download indefinitely.
> Everything below about Safe Browsing, full-tunnel egress, and
> `SafeBrowsingAllowlistDomains` is superseded. Current record:
> `docs/ISSUES.md` → "Gantt Excel/PDF export downloads blocked in production".
> Kept unedited below as the historical record of what was believed on
> 2026-07-20.

**Problem:** How might we make Excel/PDF export complete reliably for TAMs
working over the VPN?

**Diagnosis:** The exports work — files generate client-side at full size
(observed 10 KB xlsx / 43 KB pdf reaching "10/10 KB" in the download shelf)
and then hang at 100%. That is the signature of Chrome's Safe Browsing
download check: Chrome pings Google to vet every finished download, and on a
full-tunnel VPN with no internet egress that ping never completes. Nothing in
Solvro's export code path can cause or fix this. Prod is also plain HTTP,
which disables secure-context APIs: clipboard copy on Reports
(`Reports.tsx:192`), Admin ID copy, and the PWA service worker.

**Recommended direction:** Environment fix, not app fix — in order of
preference: (a) split-tunnel the VPN so browsers keep internet egress;
(b) `SafeBrowsingAllowlistDomains` Chrome policy for the Solvro host if
browsers are managed; (c) per-user stopgap: Firefox for exports. Regardless,
put prod behind HTTPS with an internal-CA cert to revive the whole
secure-context class. One code fix rides along: a clipboard fallback helper
so Reports/Admin copy works even on HTTP.

**Assumptions to validate (5-minute checklist, over VPN):**
- [ ] Full tunnel confirmed — google.com unreachable while connected
- [ ] `chrome://downloads` shows the stuck export as "Scanning…"
- [ ] Firefox completes the same export instantly
- [ ] (Optional) Chrome Safe Browsing set to "No protection" → export
      completes → flip it back

**Update 2026-07-20:** VPN is NetBird (split-tunnel by default, zones give a
static http:// domain). Decided: ship an in-app "View PDF in tab" action
(plan Task 8) as a partial mitigation — viewing/printing bypasses the
download pipeline; Excel has no in-browser equivalent, so the browser-side
fixes (Firefox stopgap, `SafeBrowsingAllowlistDomains` per-machine policy,
or NetBird DNS upstream check) remain the real solution. No NetBird changes
required for any option.

**Not doing:** permanently disabling Safe Browsing; moving export
server-side (browser scans a server download identically).

## 2 · "Color by" selector for the Gantt

**Problem:** How might we make Gantt bars carry meaning at a glance instead
of uniform grey?

**Root cause:** Live bars tint by section color; sections default to
`#94a3b8` grey and no UI exists to change it (`updateSection` is only used
for rename/reorder — the backend already validates a `color` patch field).
Exports meanwhile color by status + priority (`palette.ts`), so screen and
export disagree.

**Direction (chosen in interview):** A "Color by: Status | Section |
Priority" segmented control in the Gantt toolbar, defaulting to **Section**
(decided 2026-07-20 — upgrade-day visuals unchanged; status one click away),
persisted in localStorage. One shared resolver feeds live bars and both
exports so what the customer receives matches the screen. Section mode gets
an 8-swatch preset picker on the section color dot (finishing the existing
DB → `Row.sectionColor` → bar plumbing). Compact legend chips for
status/priority modes. Milestone diamond stays primary green.

**Assumptions to validate:**
- [x] Default mode — decided 2026-07-20: Section (no visual surprise on
      upgrade). Trade-off accepted: exports follow the mode, so an untouched
      install exports section-grey until a mode/color is chosen.
- [ ] localStorage persistence suffices for a solo-use tool

**Not doing:** color-by-label (multi-valued); free-hex section colors
(presets keep the palette coherent); recoloring the milestone diamond.

## 3 · Explicit milestone flag

**Problem:** How might we let TAMs decide what's a milestone instead of
inferring it from same-day dates — and let milestones participate in
dependencies?

**Root cause:** `geometry.ts:326` derives milestone from
`startDate === dueDate` (or due-only); no schema field exists. The diamond
render branch returns before the dependency connector dots
(`GanttBar.tsx:222`), so milestones can't initiate dependency drags.

**Direction (chosen in interview):** Add `isMilestone Boolean @default(false)`
to `Task` with a one-time backfill marking existing same-day/due-only tasks
as milestones (nothing changes visually on upgrade). Task panel gets a
Task/Milestone toggle; new same-day tasks default to a normal 1-day bar.
Milestones gain dependency connector dots. Convention: a flagged milestone
anchors to its **due date**; saving keeps `startDate` synced to it.

**Assumptions to validate:**
- [ ] Backfill rule matches intent — spot-check a seeded project in dev
- [ ] Connector anchoring (`GanttConnectors.tsx:118`) works for
      drag-initiation from a diamond

**Not doing:** milestone date ranges; Kanban/List milestone styling;
critical-path logic (deferred per CLAUDE.md); drag-to-move for diamonds
(edit dates via panel/list for now).

## 4 · Dates column truncates and never widens

**Problem:** How might we show full date ranges in the Gantt task list at any
window size?

**Root cause:** The dates sub-column is fixed at `DATE_RANGE_COL_WIDTH = 92`
px (`constants.ts`) while `fmtDateRangeDDMM` produces up to 15 characters
("12 Jul – 16 Jul" ≈ 99 px at 11px mono + 16 px padding). The name column is
`flex-1`, so both window stretching and divider dragging feed the name
column — the dates cell can never grow. Not responsive-related; it's a
constant sized for a shorter format.

**Direction:** Widen the constant to 118 px (fits the bounded worst case;
`DEFAULT_LIST_PANE_WIDTH` derives automatically). No format change needed —
the format is bounded, so a fixed fit beats introducing adaptive layout.

**Not doing:** flexing the dates column with the divider (format is bounded —
fixed fit is simpler); compact "12–16 Jul" same-month format (unnecessary
once the column fits).

## Suggested sequencing

1. Validation checklist for #1 (no code) — Firefox may unblock the TAM today
2. #4 dates column — one-line quick win
3. #3 milestones — schema + render, self-contained
4. #2 color-by — frontend + export param, most visible payoff
5. Clipboard fallback + HTTPS/VPN infra track — parallel
