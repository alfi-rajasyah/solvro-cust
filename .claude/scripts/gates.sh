#!/usr/bin/env bash
# Solvro quality gates — deterministic replacement for the retired solvro-qa agent.
# Pipeline v2 (approved 2026-07-28): gates run per task; review runs per phase,
# except spine touches which require an instant opus review (enforced here, not by
# model judgment). Design: docs/archive/plans/pipeline-v2-design.md
#
# Usage: .claude/scripts/gates.sh [options]
#   --base=<ref>                diff base, merge-base semantics (default: origin/develop)
#   --backend | --frontend      force area gates regardless of diff
#   --all                       force both areas
#   --skip-smoke                skip the Playwright smoke gate
#   --performed-review=<none|opus>  review already performed for spine touches (default: none)
#
# Test hook: GATES_DIFF_OVERRIDE (newline-separated paths) stands in for the real diff.
# Output: one "PASS <gate>" / "FAIL <gate> — reason" line per gate; failing command
# output echoed indented. Exit 0 iff every gate passed.

set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

# Single-writer lock (2026-07-30): concurrent gates runs contend for the shared
# Docker stack and cross-contaminate results (the diff spans the whole working
# tree, so parallel agents see each other's files). One run at a time; full runs
# are orchestrator-owned. Stale-lock recovery: rmdir the directory below.
LOCKDIR="${TMPDIR:-/tmp}/solvro-gates.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "FAIL gates-lock — another gates.sh run is active ($LOCKDIR). Gates are single-writer: wait for it, or rmdir a stale lock." >&2
  exit 2
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

BASE="origin/develop"; F_BACK=0; F_FRONT=0; SKIP_SMOKE=0; REVIEW="none"
for a in "$@"; do case "$a" in
  --base=*) BASE="${a#*=}" ;;
  --backend) F_BACK=1 ;;
  --frontend) F_FRONT=1 ;;
  --all) F_BACK=1; F_FRONT=1 ;;
  --skip-smoke) SKIP_SMOKE=1 ;;
  --performed-review=*) REVIEW="${a#*=}" ;;
  *) echo "unknown option: $a" >&2; exit 2 ;;
esac; done

# Diff = committed changes since merge-base with $BASE + working tree + untracked.
if [ -n "${GATES_DIFF_OVERRIDE:-}" ]; then
  DIFF_FILES="$GATES_DIFF_OVERRIDE"
else
  DIFF_FILES="$( { git diff --name-only "$BASE"...HEAD 2>/dev/null; \
                   git diff --name-only HEAD 2>/dev/null; \
                   git status --porcelain | awk '{print $NF}'; } | sort -u | sed '/^$/d')"
fi

FAILS=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 — $2"; FAILS=$((FAILS+1)); }
run_gate() { # run_gate <name> <cmd...>: PASS/FAIL by exit code, show output on failure
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then pass "$name"; else
    fail "$name" "command failed"
    echo "$out" | tail -n 25 | sed 's/^/    | /'
  fi
}
touches() { echo "$DIFF_FILES" | grep -qE "$1"; }

# ---------- area gates (conditional on diff, forceable) ----------
touches '^backend/'  && F_BACK=1
touches '^frontend/' && F_FRONT=1

backend_vitest() { # isolated test DB — see backend/CLAUDE.md traps
  local url
  url="$(docker compose exec -T backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|')" || return 1
  [ -n "$url" ] || { echo "could not derive test DATABASE_URL"; return 1; }
  docker compose exec -T -e DATABASE_URL="$url" backend npm test
}
smoke_gate() {
  # Pre-flight: the e2e fixture admin (e2e/fixtures/test.ts) must be able to
  # log in, or every smoke test fails opaquely inside the seed fixture. Agents
  # have twice reset this user's password via create-admin.ts for their own
  # verification — fail here with a one-line diagnosis instead.
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${ADMIN_EMAIL:-qa@solvro.test}\",\"password\":\"${ADMIN_PASSWORD:-QaTest1234!}\"}")
  if [ "$code" = "000" ]; then
    echo "backend unreachable on :3000 — the stack isn't up (docker compose up -d), not a fixture problem"
    return 1
  fi
  if [ "$code" != "200" ]; then
    echo "e2e fixture admin login failed (HTTP $code) — restore it with:"
    echo "  docker compose exec -e ADMIN_EMAIL=qa@solvro.test -e ADMIN_PASSWORD='QaTest1234!' backend npx tsx scripts/create-admin.ts"
    return 1
  fi
  (cd e2e && BASE_URL="${BASE_URL:-http://localhost:5173}" npx playwright test tests/smoke.spec.ts)
}

if [ "$F_BACK" -eq 1 ]; then
  run_gate backend-typecheck docker compose exec -T backend npx tsc --noEmit
  run_gate backend-vitest backend_vitest
fi
if [ "$F_FRONT" -eq 1 ]; then
  run_gate frontend-typecheck docker compose exec -T frontend npm run typecheck
  run_gate frontend-vitest docker compose exec -T frontend npm test
  # East-of-UTC run: pins the date-contract invariant (dateField.ts) — a reintroduced
  # local-midnight serialization is invisible under the container's default UTC clock.
  run_gate frontend-vitest-tz docker compose exec -T -e TZ=Asia/Jakarta frontend npm test
  if [ "$SKIP_SMOKE" -eq 0 ]; then run_gate playwright-smoke smoke_gate; else echo "SKIP playwright-smoke (--skip-smoke)"; fi
fi

# ---------- changelog presence (always) ----------
# Any non-doc change requires CHANGELOG.md in the same diff. Entry *quality* is a
# reviewer concern; this gate only guarantees presence.
NON_DOC="$(echo "$DIFF_FILES" | grep -vE '^(docs/|\.claude/|\.git/)|(^|/)CLAUDE\.md$|^CHANGELOG\.md$|^README\.md$' | sed '/^$/d')"
if [ -n "$NON_DOC" ]; then
  if echo "$DIFF_FILES" | grep -qx 'CHANGELOG.md'; then pass changelog-presence
  else fail changelog-presence "code/config changed without a CHANGELOG.md entry"; fi
else pass "changelog-presence (no code changes in diff)"; fi

# ---------- standing guardrail checks (always) ----------
if [ -f frontend/src/pages/Tasks.tsx ] && grep -q 'path="tasks"' frontend/src/App.tsx; then
  pass guardrail-tasks-page
else fail guardrail-tasks-page "Tasks.tsx or its /tasks route is missing (Guardrail: must never be deleted)"; fi

if grep -q gantt-task-react backend/package.json frontend/package.json 2>/dev/null; then
  fail guardrail-no-gantt-lib "gantt-task-react found in a package.json (Guardrail: never install)"
else pass guardrail-no-gantt-lib; fi

# INTERNAL-notes guardrail. The Reports export packet was removed 2026-08-03.
# While frontend/src/lib/export/ exists, it must filter CUSTOMER_FACING (re-arm
# branch). Without it, the gate instead pins the note-consuming file set to an
# allowlist: a new consumer must be hand-verified to never surface INTERNAL
# notes in customer-facing output, then added here. (2026-08-29: DailyReview.tsx
# reads notes through GET /daily-review now; ProjectOverview.tsx shows a read-only,
# in-app 14-day note feed — verified: no export/customer-facing path.
# 2026-08-31: Overview.tsx shows the read-only 7-day "Recent notes" feed via
# useRecentNotes (GET /notes/recent) — verified: in-app only, no export path.)
NOTE_ALLOWLIST="frontend/src/lib/queries.ts
frontend/src/pages/Overview.tsx
frontend/src/pages/views/ProjectOverview.tsx"
NOTE_CONSUMERS="$(grep -rl 'useProjectNotes\|useRecentNotes\|NoteVisibility' frontend/src --include='*.ts' --include='*.tsx' 2>/dev/null | sort)"
if [ -d frontend/src/lib/export ]; then
  if grep -rq CUSTOMER_FACING frontend/src/lib/export/; then pass guardrail-internal-notes
  else fail guardrail-internal-notes "no CUSTOMER_FACING visibility filter found in frontend/src/lib/export/ (Guardrail: INTERNAL notes never in exports)"; fi
elif [ "$NOTE_CONSUMERS" = "$NOTE_ALLOWLIST" ]; then pass "guardrail-internal-notes (note consumers match allowlist)"
else fail guardrail-internal-notes "note-consuming files drifted from the allowlist (Guardrail: INTERNAL notes never in customer-facing output) — got: $(echo "$NOTE_CONSUMERS" | tr '\n' ' ')"; fi

# Inverted for the customer distribution (2026-09-21): .claude/, the CLAUDE.md files and
# docs/ are TRACKED here by user decision, unlike the source repository this script came
# from. The check guards the inverse mistake — re-adding the source repo's ignore block
# would silently drop the agent workflow from the distribution. .superpowers stays
# untracked either way.
if [ -n "$(git ls-files -- .claude CLAUDE.md backend/CLAUDE.md frontend/CLAUDE.md e2e/CLAUDE.md docs)" ] \
   && [ -z "$(git ls-files -- .superpowers)" ]; then
  pass guardrail-local-only-tracked
else fail guardrail-local-only-tracked "the agent workflow files (.claude/, CLAUDE.md, docs/) must stay tracked in this repository, and .superpowers must not be"; fi

# Update EXPECTED_KANBAN_PATCHES together with the CHANGELOG when a sanctioned patch lands.
EXPECTED_KANBAN_PATCHES=0
if [ -f frontend/src/components/reui/kanban.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/kanban.tsx)"
  if [ "$N" -eq "$EXPECTED_KANBAN_PATCHES" ]; then pass guardrail-kanban-vendor
  else fail guardrail-kanban-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_KANBAN_PATCHES"; fi
else fail guardrail-kanban-vendor "frontend/src/components/reui/kanban.tsx missing"; fi

# Same drift guard for the vendored Sortable (vendored 2026-07-30, zero sanctioned patches).
EXPECTED_SORTABLE_PATCHES=0
if [ -f frontend/src/components/reui/sortable.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/sortable.tsx)"
  if [ "$N" -eq "$EXPECTED_SORTABLE_PATCHES" ]; then pass guardrail-sortable-vendor
  else fail guardrail-sortable-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_SORTABLE_PATCHES"; fi
else fail guardrail-sortable-vendor "frontend/src/components/reui/sortable.tsx missing"; fi

# Same drift guard for the vendored Filters (vendored 2026-07-31; 18 sanctioned
# SOLVRO PATCH markers incl. comment-only ones — provenance header in the file;
# bumped from 13 for the duplicate-chip idempotence guard, 2026-08-02: a shared
# `findMatchingFilter` check (wrapping the module-level, unit-tested pure
# `findFilterMatch`) applied at all four unconditional chip-append call sites
# — the plain field add, the single-remaining-field direct list, and both
# branches of the field-then-value submenu flow (multiselect + single-select)
# — since only the last three are reachable for this app's actual filter
# fields (all `type: "select"` with populated options, so `addFilter` itself
# is a fallback path, not the one users hit in practice)).
EXPECTED_FILTERS_PATCHES=18
if [ -f frontend/src/components/reui/filters.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/filters.tsx)"
  if [ "$N" -eq "$EXPECTED_FILTERS_PATCHES" ]; then pass guardrail-filters-vendor
  else fail guardrail-filters-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_FILTERS_PATCHES"; fi
else fail guardrail-filters-vendor "frontend/src/components/reui/filters.tsx missing"; fi

# Same drift guards for the vendored Data Grid family (dir-total) and Badge
# (vendored 2026-08-01; counts include comment-only markers).
EXPECTED_DATAGRID_PATCHES=40
if [ -d frontend/src/components/reui/data-grid ]; then
  N="$(grep -rc 'SOLVRO PATCH' frontend/src/components/reui/data-grid/ | awk -F: '{s+=$2} END {print s}')"
  if [ "$N" -eq "$EXPECTED_DATAGRID_PATCHES" ]; then pass guardrail-datagrid-vendor
  else fail guardrail-datagrid-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_DATAGRID_PATCHES"; fi
else fail guardrail-datagrid-vendor "frontend/src/components/reui/data-grid/ missing"; fi

EXPECTED_BADGE_PATCHES=5
if [ -f frontend/src/components/reui/badge.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/badge.tsx)"
  if [ "$N" -eq "$EXPECTED_BADGE_PATCHES" ]; then pass guardrail-badge-vendor
  else fail guardrail-badge-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_BADGE_PATCHES"; fi
else fail guardrail-badge-vendor "frontend/src/components/reui/badge.tsx missing"; fi

# ---------- spine check (always) ----------
# Shared spine of the projects page + app-wide hot surfaces. Touching any of these
# requires an instant opus review of the task (--performed-review=opus).
SPINE='^backend/src/lib/taskOrdering\.ts$|^backend/src/routes/tasks\.ts$|^backend/src/routes/projects\.ts$|^backend/src/http/auth\.ts$|^backend/src/routes/admin\.ts$|^backend/src/lib/visibility\.ts$|^backend/prisma/schema\.prisma$|^backend/prisma/migrations/|^frontend/src/lib/dateField\.ts$|^frontend/src/components/DateField\.tsx$|^frontend/src/components/DateRangeField\.tsx$|^frontend/src/components/InlineDateRangeEditor\.tsx$|^frontend/src/lib/queries\.ts$|^frontend/src/components/kanban-v2/(adapter|commitMapper)\.ts$|^frontend/src/components/gantt-v2/|^frontend/src/components/reui/|^frontend/src/lib/export/|^frontend/src/lib/gantt/export(Excel|Pdf)\.ts$|^docker-compose\.yml$|^\.env|^setup\.sh$|^frontend/nginx\.conf$'
SPINE_HITS="$(echo "$DIFF_FILES" | grep -E "$SPINE" | sed '/^$/d' || true)"
if [ -n "$SPINE_HITS" ]; then
  echo "SPINE TOUCHED — instant review required:"
  echo "$SPINE_HITS" | sed 's/^/    /'
  if [ "$REVIEW" = "opus" ]; then pass spine-review
  else fail spine-review "spine files touched but no opus review recorded (pass --performed-review=opus after the review)"; fi
else pass "spine-review (no spine files touched)"; fi

echo "----------------------------------------"
if [ "$FAILS" -eq 0 ]; then echo "ALL GATES PASSED"; exit 0
else echo "$FAILS GATE(S) FAILED"; exit 1; fi
