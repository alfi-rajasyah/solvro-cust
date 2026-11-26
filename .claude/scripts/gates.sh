#!/usr/bin/env bash
# Solvro quality gates — deterministic replacement for the retired solvro-qa agent.
# Full runs are orchestrator-owned and serial: once per lane-D or lane-S change, and per wave
# integration plus at close for a phase (lanes: root CLAUDE.md roster). Spine touches
# require an instant opus review in any lane (enforced here, not by model judgment).
# Design: docs/archive/plans/pipeline-v2-design.md, docs/archive/plans/pipeline-v3-simplify.md
#
# Usage: .claude/scripts/gates.sh [options]
#   --base=<ref>                diff base, merge-base semantics (default: origin/develop)
#   --backend | --frontend      force area gates regardless of diff
#   --all                       force both areas
#   --skip-smoke                skip the Playwright smoke gate
#   --performed-review=<none|opus>  review already performed for spine touches (default: none)
#
# Smoke targets: API_URL (default http://localhost:3000) and BASE_URL (default
# http://localhost:5173). Set both when the stack runs on other ports, e.g. a host
# that also runs the sibling stack: API_URL=http://localhost:3010 BASE_URL=http://localhost:5174.
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
                   git ls-files --others --exclude-standard; } | sort -u | sed '/^$/d')"
fi
# e2e specs added or modified in the diff (still on disk), as e2e/-relative paths.
CHANGED_SPECS=()
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && [ "$f" != "e2e/tests/smoke.spec.ts" ] && CHANGED_SPECS+=("${f#e2e/}")
done < <(echo "$DIFF_FILES" | grep -E '^e2e/tests/[^/]+\.spec\.ts$')

FAILS=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 — $2"; FAILS=$((FAILS+1)); }
run_gate() { # run_gate <name> <cmd...>: PASS/FAIL by exit code, show output on failure
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    pass "$name"
    # smoke_gate prints its spec list; show it on PASS too so a green run says what ran
    echo "$out" | grep '^playwright specs:' | sed 's/^/    | /'
  else
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
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL:-http://localhost:3000}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${ADMIN_EMAIL:-qa@solvro.test}\",\"password\":\"${ADMIN_PASSWORD:-QaTest1234!}\"}")
  if [ "$code" = "000" ]; then
    echo "backend unreachable at ${API_URL:-http://localhost:3000} — the stack isn't up (docker compose up -d), not a fixture problem"
    return 1
  fi
  if [ "$code" != "200" ]; then
    echo "e2e fixture admin login failed (HTTP $code) — restore it with:"
    echo "  docker compose exec -e ADMIN_EMAIL=qa@solvro.test -e ADMIN_PASSWORD='QaTest1234!' backend npx tsx scripts/create-admin.ts"
    return 1
  fi
  # Smoke plus any e2e spec added or modified in the diff (CHANGED_SPECS, derived at the top).
  local specs=("tests/smoke.spec.ts" "${CHANGED_SPECS[@]}")
  echo "playwright specs: ${specs[*]}"
  local rc=0
  (cd e2e && BASE_URL="${BASE_URL:-http://localhost:5173}" npx playwright test "${specs[@]}") || rc=$?
  # The specs write fixture rows into the dev database behind :5173; remove
  # them so the demo data stays usable for manual QA (backend/scripts/dev/cleanup-e2e-data.ts).
  # Only for the default dev stack: another BASE_URL means another database.
  if [ -z "${BASE_URL:-}" ] || [ "${BASE_URL}" = "http://localhost:5173" ]; then
    docker compose exec -T -e E2E_CLEANUP_CONFIRM=delete -e E2E_ADMIN_EMAIL="${ADMIN_EMAIL:-qa@solvro.test}" backend npx tsx scripts/dev/cleanup-e2e-data.ts \
      || echo "e2e data cleanup failed (the gate result is unchanged)"
  fi
  return "$rc"
}

if [ "$F_BACK" -eq 1 ]; then
  run_gate backend-typecheck docker compose exec -T backend npm run typecheck  # src, test, scripts
  run_gate backend-vitest backend_vitest
fi
if [ "$F_FRONT" -eq 1 ]; then
  run_gate frontend-typecheck docker compose exec -T frontend npm run typecheck
  run_gate frontend-lint docker compose exec -T frontend npm run lint  # react-hooks rules only (frontend/eslint.config.js)
  run_gate frontend-vitest docker compose exec -T frontend npm test
  # East-of-UTC run: pins the date-contract invariant (dateField.ts) — a reintroduced
  # local-midnight serialization is invisible under the container's default UTC clock.
  run_gate frontend-vitest-tz docker compose exec -T -e TZ=Asia/Jakarta frontend npm test
  # A frontend diff of test files only renders nothing new, so smoke has nothing
  # to prove; typecheck and both vitest runs above still cover it.
  FRONT_NON_TEST="$(echo "$DIFF_FILES" | grep -E '^frontend/' | grep -vE '\.test\.tsx?$' | sed '/^$/d')"
  if [ "$SKIP_SMOKE" -eq 1 ]; then echo "SKIP playwright-smoke (--skip-smoke)"
  elif touches '^frontend/' && [ -z "$FRONT_NON_TEST" ] && [ "${#CHANGED_SPECS[@]}" -eq 0 ]; then echo "SKIP playwright-smoke (test-only frontend diff)"
  else run_gate playwright-smoke smoke_gate; fi
fi
# Changed e2e specs run whatever the area flags say (e2e-only or backend+e2e diffs).
if [ "$F_FRONT" -eq 0 ] && [ "$SKIP_SMOKE" -eq 0 ] && [ "${#CHANGED_SPECS[@]}" -gt 0 ]; then
  run_gate "playwright-specs(${#CHANGED_SPECS[@]} changed)" smoke_gate
elif [ "$F_FRONT" -eq 0 ] && [ "$SKIP_SMOKE" -eq 1 ] && [ "${#CHANGED_SPECS[@]}" -gt 0 ]; then
  echo "SKIP playwright-specs (--skip-smoke; ${#CHANGED_SPECS[@]} changed spec(s) not run)"
fi

# ---------- changelog presence (always) ----------
# Any non-doc change requires CHANGELOG.md in the same diff. Entry *quality* is a
# reviewer concern; this gate only guarantees presence.
NON_DOC="$(echo "$DIFF_FILES" | grep -vE '^(docs/|\.claude/|\.git/)|(^|/)CLAUDE\.md$|^CHANGELOG\.md$|^README\.md$' | sed '/^$/d')"
if [ -n "$NON_DOC" ]; then
  if echo "$DIFF_FILES" | grep -qx 'CHANGELOG.md'; then pass changelog-presence
  else fail changelog-presence "code/config changed without a CHANGELOG.md entry"; fi
else pass "changelog-presence (no code changes in diff)"; fi

# ---------- plan-doc hygiene (always) ----------
# Plans are cited by their archive path from the start (root CLAUDE.md, Map), so a
# cited docs/archive/plans/<x> must exist there or still be live in docs/plans/.
# Code never cites a live docs/plans|docs/prompts path: it goes stale at archive time.
CITE_BAD=""
for p in $(git grep --untracked -ohE 'docs/archive/plans/[A-Za-z0-9._/-]+\.md' | sort -u); do
  [ -e "$p" ] || [ -e "docs/plans/${p#docs/archive/plans/}" ] || CITE_BAD="$CITE_BAD $p"
done
CODE_LIVE="$(git grep --untracked -nE 'docs/(plans|prompts)/' -- backend frontend e2e ':!*CLAUDE.md' | head -3)"
if [ -n "$CITE_BAD" ]; then fail docs-plan-citations "cited plan exists neither in docs/archive/plans/ nor docs/plans/:$CITE_BAD"
elif [ -n "$CODE_LIVE" ]; then fail docs-plan-citations "code cites a live docs/plans or docs/prompts path (cite docs/archive/...): $(echo "$CODE_LIVE" | cut -c1-120 | tr '\n' ' ')"
else pass docs-plan-citations; fi
# Every live plan states its status; a shipped one belongs in docs/archive/plans/.
STATUS_BAD=""
for f in docs/plans/*.md; do
  [ -f "$f" ] || continue
  s="$(grep -m1 -iE '^([>-]\s*)?\**status\**:' "$f")"
  if [ -z "$s" ]; then STATUS_BAD="$STATUS_BAD $f(no Status line)"
  elif echo "$s" | grep -qiE 'status\**:\**\s*\**(shipped|complete)'; then STATUS_BAD="$STATUS_BAD $f(shipped: git mv it to docs/archive/plans/)"; fi
done
if [ -n "$STATUS_BAD" ]; then fail docs-plans-status "$STATUS_BAD"; else pass docs-plans-status; fi

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
EXPECTED_KANBAN_PATCHES=3  # keyboard drag: attributes on the handle (ISS-078, 2026-11-19)
if [ -f frontend/src/components/reui/kanban.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/kanban.tsx)"
  if [ "$N" -eq "$EXPECTED_KANBAN_PATCHES" ]; then pass guardrail-kanban-vendor
  else fail guardrail-kanban-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_KANBAN_PATCHES"; fi
else fail guardrail-kanban-vendor "frontend/src/components/reui/kanban.tsx missing"; fi

# Same drift guard for the vendored Sortable (vendored 2026-07-30; 3 sanctioned patches 2026-11-19, ISS-079).
EXPECTED_SORTABLE_PATCHES=3  # drag attributes on the handle (ISS-079)
if [ -f frontend/src/components/reui/sortable.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/sortable.tsx)"
  if [ "$N" -eq "$EXPECTED_SORTABLE_PATCHES" ]; then pass guardrail-sortable-vendor
  else fail guardrail-sortable-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_SORTABLE_PATCHES"; fi
else fail guardrail-sortable-vendor "frontend/src/components/reui/sortable.tsx missing"; fi

# Same drift guard for the vendored Filters (vendored 2026-07-31; 19 sanctioned
# SOLVRO PATCH markers incl. comment-only ones — provenance header in the file;
# bumped from 13 for the duplicate-chip idempotence guard, 2026-08-02: a shared
# `findMatchingFilter` check (wrapping the module-level, unit-tested pure
# `findFilterMatch`) applied at all four unconditional chip-append call sites
# — the plain field add, the single-remaining-field direct list, and both
# branches of the field-then-value submenu flow (multiselect + single-select)
# — since only the last three are reachable for this app's actual filter
# fields (all `type: "select"` with populated options, so `addFilter` itself
# is a fallback path, not the one users hit in practice)); +1 lint-suppression
# marker, 2026-11-25.
EXPECTED_FILTERS_PATCHES=19
if [ -f frontend/src/components/reui/filters.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/filters.tsx)"
  if [ "$N" -eq "$EXPECTED_FILTERS_PATCHES" ]; then pass guardrail-filters-vendor
  else fail guardrail-filters-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_FILTERS_PATCHES"; fi
else fail guardrail-filters-vendor "frontend/src/components/reui/filters.tsx missing"; fi

# Same drift guards for the vendored Data Grid family (dir-total) and Badge
# (vendored 2026-08-01; counts include comment-only markers; data-grid +1
# lint-suppression marker, 2026-11-25).
EXPECTED_DATAGRID_PATCHES=43
if [ -d frontend/src/components/reui/data-grid ]; then
  N="$(grep -rc 'SOLVRO PATCH' frontend/src/components/reui/data-grid/ | awk -F: '{s+=$2} END {print s}')"
  if [ "$N" -eq "$EXPECTED_DATAGRID_PATCHES" ]; then pass guardrail-datagrid-vendor
  else fail guardrail-datagrid-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_DATAGRID_PATCHES"; fi
else fail guardrail-datagrid-vendor "frontend/src/components/reui/data-grid/ missing"; fi

# backend/scripts/dev/ holds dev-stack-only tools (e2e data cleanup). The build
# stage deletes it and the runtime stage copies scripts/ from the build stage
# only, so no runtime layer ever holds it.
DEV_SCRIPTS_CHECK="$(awk '
  /^FROM /{stage=$NF}
  stage=="build" && $0=="RUN rm -rf scripts/dev"{rm=1}
  stage=="runtime" && $0=="COPY --from=build /app/scripts ./scripts"{fromb=1}
  stage=="runtime" && /^COPY[[:space:]]+scripts/{direct=1}
  END{print (rm && fromb && !direct) ? "ok" : "bad"}' backend/Dockerfile)"
if [ "$DEV_SCRIPTS_CHECK" = ok ]; then pass guardrail-dev-scripts-excluded
else fail guardrail-dev-scripts-excluded "backend/Dockerfile must delete scripts/dev in the build stage and copy scripts/ into runtime only from build"; fi

EXPECTED_BADGE_PATCHES=6
if [ -f frontend/src/components/reui/badge.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/badge.tsx)"
  if [ "$N" -eq "$EXPECTED_BADGE_PATCHES" ]; then pass guardrail-badge-vendor
  else fail guardrail-badge-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_BADGE_PATCHES"; fi
else fail guardrail-badge-vendor "frontend/src/components/reui/badge.tsx missing"; fi

# Counts every match incl. the header line that states the count.
EXPECTED_AUTOCOMPLETE_PATCHES=7
if [ -f frontend/src/components/reui/autocomplete.tsx ]; then
  N="$(grep -c 'SOLVRO PATCH' frontend/src/components/reui/autocomplete.tsx)"
  if [ "$N" -eq "$EXPECTED_AUTOCOMPLETE_PATCHES" ]; then pass guardrail-autocomplete-vendor
  else fail guardrail-autocomplete-vendor "SOLVRO PATCH count $N != recorded $EXPECTED_AUTOCOMPLETE_PATCHES"; fi
else fail guardrail-autocomplete-vendor "frontend/src/components/reui/autocomplete.tsx missing"; fi

# The uncustomized section colour lives twice: Section.color's schema default and
# DEFAULT_SECTION_COLOR, which resolveSectionColors compares against to spot a
# section that never went through the picker. The two packages share no module,
# so this check keeps them equal (ISS-020).
SCHEMA_SECTION_COLOR="$(awk '/^model Section \{/{f=1} f&&/^}/{exit} f&&/^[[:space:]]+color[[:space:]]/' backend/prisma/schema.prisma | grep -o '#[0-9a-fA-F]\{6\}')"
FRONT_SECTION_COLOR="$(grep -o 'DEFAULT_SECTION_COLOR = "#[0-9a-fA-F]\{6\}"' frontend/src/lib/gantt/palette.ts | grep -o '#[0-9a-fA-F]\{6\}')"
if [ -n "$SCHEMA_SECTION_COLOR" ] && [ "$(printf %s "$SCHEMA_SECTION_COLOR" | tr A-F a-f)" = "$(printf %s "$FRONT_SECTION_COLOR" | tr A-F a-f)" ]; then
  pass section-default-color-parity
else fail section-default-color-parity "Section.color default '$SCHEMA_SECTION_COLOR' (schema.prisma) != DEFAULT_SECTION_COLOR '$FRONT_SECTION_COLOR' (frontend/src/lib/gantt/palette.ts)"; fi

# ---------- design guard checks (always) ----------
# antislop guards (2026-11-12, docs/archive/plans/antislop-port.md). App code
# only: vendored shadcn/ReUI (components/ui, components/reui) and tests are
# excluded. Each prints the first offending lines on failure.
design_grep() { # design_grep <ERE> [extra path-exclude ERE, relative to frontend/src/]
  # Excludes are anchored to the path prefix of grep's "path:line:content"
  # output, so a code line that merely mentions components/ui/ is still checked.
  local ex='^frontend/src/(components/(ui|reui)/|[^:]*\.test\.tsx?:)'
  [ -n "${2:-}" ] && ex="$ex|^frontend/src/$2"
  local out rc
  out="$(grep -rnE "$1" frontend/src --include='*.ts' --include='*.tsx')"; rc=$?
  # grep exits 2 on a bad pattern or unreadable tree: report it, never pass silently.
  if [ "$rc" -gt 1 ]; then echo "GREP-ERROR: grep exited $rc for pattern $1"; return; fi
  echo "$out" | grep -vE "$ex" | sed '/^$/d' || true
}
design_check() { # design_check <gate> <reason> <hits>
  if [ -n "$3" ]; then fail "$1" "$2: $(echo "$3" | head -3 | cut -c1-160 | tr '\n' ' ')"
  else pass "$1"; fi
}
# 1. Text on a solid primary fill uses its token pair — white on dark-theme
#    green is 2.86:1.
design_check design-on-primary "text-white on bg-primary (use text-on-primary)" \
  "$(design_grep "bg-primary([^/-]|\$)[^\"'\`]*text-white|text-white[^\"'\`]*bg-primary([^/-]|\$)")"
# 1b. The old focus form (border on :focus, not :focus-visible) is gone; the one
#     treatment is in docs/DESIGN.md. Vendored ui/ and reui/ are excluded.
design_check design-focus-border "focus:border-primary (use focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30)" \
  "$(design_grep "focus:border-primary")"
# 1c. A visible focus ring goes with outline-hidden, not outline-none: outline-none
#     removes the outline that forced-colours mode would show in place of the ring.
design_check design-outline-none "focus-visible:outline-none (use focus-visible:outline-hidden)" \
  "$(design_grep "focus-visible:outline-none|(^|[\"' \`])outline-none[^\"'\`]*focus-visible:ring-")"
# 2 and 3 read whole files (a tag or a comment can span lines), so they use
# perl rather than the line grep above.
design_perl() { # design_perl <perl -ne body run once per file, file in $_>
  find frontend/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -path 'frontend/src/components/ui/*' ! -path 'frontend/src/components/reui/*' \
    ! -name '*.test.ts' ! -name '*.test.tsx' -print0 \
    | xargs -0 perl -CSD -Mutf8 -0777 -ne "$1" 2>&1
}
# 2. No em dash in text a user reads. Comments are blanked first, so prose in
#    comments is free; the "no value" mark is EMPTY_VALUE (lib/emptyValue.ts).
design_check design-no-em-dash "em dash in user-facing text (rewrite the sentence; an empty value is EMPTY_VALUE)" \
  "$(design_perl 's{/\*.*?\*/}{ (my $c = $&) =~ s/[^\n]//g; $c }gse; s{(^|[^:"\x27`])//[^\n]*}{$1}gm; my $n = 0; for my $l (split /\n/) { $n++; print "$ARGV:$n: $l\n" if $l =~ /\x{2014}/ }')"
# 3. Icon ligatures are text: a material-symbols element is hidden from
#    assistive tech, or is itself a labelled control. Never both: aria-hidden
#    on an element that is a control (or carries the only name) hides it from
#    the people who need the name. The tag matcher steps over the ">" of "=>".
design_check design-icon-hidden "material-symbols-outlined element without aria-hidden (aria-label when it is the control), or aria-hidden on a control" \
  "$(design_perl 'while (/<(?:span|button|i)\b((?:[^>]|(?<==)>)*?material-symbols-outlined(?:[^>]|(?<==)>)*?)>/gs) { my $a = $1; my $n = (substr($_, 0, $-[0]) =~ tr/\n//) + 1; if ($a !~ /aria-hidden|aria-label/) { print "$ARGV:$n: icon element is neither hidden nor labelled\n" } elsif ($a =~ /aria-hidden/ && $a =~ /aria-label|\brole=|tabIndex|\{\.\.\.attributes\}|onClick/) { print "$ARGV:$n: aria-hidden on a control or a named icon\n" } }')"

# ---------- spine check (always) ----------
# Shared spine of the projects page + app-wide hot surfaces. Touching any of these
# requires an instant opus review of the task (--performed-review=opus).
SPINE='^backend/src/lib/taskOrdering\.ts$|^backend/src/routes/tasks\.ts$|^backend/src/routes/projects\.ts$|^backend/src/http/auth\.ts$|^backend/src/routes/admin\.ts$|^backend/src/lib/visibility\.ts$|^backend/prisma/schema\.prisma$|^backend/prisma/migrations/|^frontend/src/lib/dateField\.ts$|^frontend/src/components/DateField\.tsx$|^frontend/src/components/DateRangeField\.tsx$|^frontend/src/components/InlineDateRangeEditor\.tsx$|^frontend/src/lib/queries\.ts$|^frontend/src/components/kanban-v2/(adapter|commitMapper)\.ts$|^frontend/src/components/gantt-v2/|^frontend/src/components/reui/|^frontend/src/lib/export/|^frontend/src/lib/gantt/export(Excel|Pdf)\.ts$|^docker-compose\.yml$|^\.env|^setup\.sh$|^frontend/nginx[^/]*$|^frontend/Dockerfile$|^backend/Dockerfile$|^ci/docker-compose[^/]*\.yml$'
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
