<!--
Target develop. A PR into main is a release from develop, or a hotfix.
Leave out customer data, tokens, and passwords: the repository can be public.
Delete any line that does not apply.
-->

Lane: <!-- D (docs only), S (small fix), or P (phase) -->

## What

<!-- What changed for a user or an operator, and where. One short list. -->

-

## Why

<!-- The problem this solves. Link the issue: "Closes #123". Cite an ISS-NNN id from docs/ISSUES.md if one applies. -->

## Checks

- [ ] `gates.sh`: all gates pass
- [ ] e2e: the touched specs and smoke pass, then `cleanup-e2e-data.ts` ran
- [ ] Spine review: no spine files touched, or the review found nothing open
- [ ] `CHANGELOG.md` entry under `[Unreleased]` (not needed for docs-only changes)
- [ ] Exports and notes: INTERNAL notes still never reach an export (only if the diff touches them)

## Delivery Gate

<!-- PASS or FAIL, checked in both themes and at 375px. Write "not applicable, no visible change" if nothing a user sees changed. -->

## Notes for the merge

<!-- Migrations, new env vars, rollback limits, or a required merge order. Delete this section if there is nothing. -->
