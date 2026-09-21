# Portfolio Calendar — customer name beside the project name

Status: shipped 2026-09-02 in PR #163 (Option A, 256px column, customer as a link). Merged to develop as 99f292c. Visual before/after: the "Portfolio Calendar Redline" artifact.

## Request

Show the customer name beside the project name in Portfolio Timelines → Calendar view (screenshot of the Executive page, 2026-09-02). The customer name links to the customer page.

## Findings

- `PortfolioProjectRow.customerName` (`string | null`) is already in the payload of `GET /reports/executive` and `GET /overview` — built in `backend/src/lib/portfolio.ts`. `customerId` is not: the select is `customer: { select: { name: true } }`.
- The Calendar view is `frontend/src/components/portfolio/PortfolioCalendar.tsx`. Its row label renders the name link + `ProjectStatusChip` in a hard-coded `w-48` (192px) column, repeated in three places (header spacer, Today-line spacer, row label).
- The same component serves the Overview page (`Overview.tsx`), so the change lands on both pages.
- The List view (`Executive.tsx` → `TimelineRow`) already shows `tamName · customerName` on the right. Unchanged.
- Customer route: `/customers/:id` (`App.tsx`). Muted-link precedent on the same page: `Overview.tsx` renders customer links as `hover:text-primary hover:underline` on `text-on-surface-variant` text. The calendar row follows that precedent so the project name stays the only primary-colored element on the line.
- No backend or frontend test covers the portfolio row shape. `frontend/src/lib/queries.ts` is on the spine list → instant opus review.

## Decisions (user, 2026-09-02)

1. Option A — customer on the same line as the name, after ` · `, in `text-on-surface-variant`. Name keeps the primary link style. One truncating line; `title` carries the full text. `null` customer → name only.
2. Label column `w-48` → `w-64` (256px).
3. Customer name is a `Link` to `/customers/:id`, muted, `hover:text-primary hover:underline`.

Alternatives weighed and rejected: B (own line under the name, +20px per row across ~426 rows) and C (beside the status chip — reads as status metadata, not identity).

## Tasks

1. `backend/src/lib/portfolio.ts`: select `customer: { select: { id: true, name: true } }`; add `customerId: number | null` to `PortfolioProjectRow` and emit `project.customer?.id ?? null`.
2. Backend test (vitest, isolated test DB): a project with a customer yields `customerId` + `customerName`; a project without one yields `null` for both. Covers both `GET /reports/executive` and `GET /overview` through the shared row builder.
3. `frontend/src/lib/queries.ts`: mirror `customerId: number | null` on `PortfolioProjectRow` (spine file → instant opus review).
4. `PortfolioCalendar.tsx`: hoist the label column width into one constant (`LABEL_COL = "w-64"`) and use it in the three spots.
5. `PortfolioCalendar.tsx`: wrap the name link and a customer `Link` in a `min-w-0 truncate` line with `title={customerName ? \`${name} · ${customerName}\` : name}`; render the customer only when `customerId` and `customerName` are non-null.
6. `CHANGELOG.md` entry under `[Unreleased]` → Added.

Dependency order: 1 → 3 → 5. Tasks 2, 4, 6 are independent. Single implementor, one branch off `origin/develop`, one PR into `develop`.

## Checks

- `docker compose exec backend npx tsc --noEmit` + `docker compose exec backend npm test` (isolated DB)
- `docker compose exec frontend npm run typecheck`
- one `.claude/scripts/gates.sh` run (frontend diff → Playwright smoke; `queries.ts` → spine → instant review)
- visual pass: Executive + Overview, dark + light, a project with no customer, a long name+customer pair, hover on the customer link.
