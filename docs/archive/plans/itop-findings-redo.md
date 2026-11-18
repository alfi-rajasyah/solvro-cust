# iTop findings redo

Status: shipped 2026-11-18
Archive path: `docs/archive/plans/itop-findings-redo.md`
Lane: P (seven defects in one batch, user decision 2026-11-18)

## Goal

Land the iTop fixes from the deleted `fix/svc-8-itop-findings` branch (last commit `18f17ce`), minus the Gantt Excel ticket column (ISS-135, the user decided customer exports do not show iTop ticket refs).

| Task | Issue | Change |
|---|---|---|
| 1 | ISS-009 | pino `redact` in `backend/src/logger.ts` for every secret field, top level and two levels down |
| 2 | ISS-005, ISS-128 | `PATCH /admin/itop/settings`: setting or changing the address probes the stored application token and refuses a rejected one (`itop_token_rejected`); `appTokenUnverified` in the settings response and a one-line notice in `ItopTab.tsx` |
| 3 | ISS-129 | `requestSync` in `lib/itop/scheduler.ts` re-queues a full Refresh sync every 30 s, for up to 30 min, while `syncTickets` reports `busy` |
| 4 | ISS-075 | `Utilization.tsx` shows an error Alert when Refresh fails |
| 5 | ISS-115 | `GET /itop/services` returns only services of iTop organisations mapped to customers the caller can see (provider org or customer contract); view-all holders keep the full list |
| 6 | ISS-064 | `CustomerDetail.tsx` gates the Tickets tab on `itopOrgId` / `itopOrgName` |

## Source

The code is a port of `18f17ce` (diff against its merge base `6dd7592`), excluding `frontend/src/lib/gantt/exportExcel.ts` and its test. That branch had a phase review whose nits it fixed, but it never merged. This phase re-verifies it on current `develop`.

Tasks share files (`routes/itop.ts`, `fakeItop.ts`), so they run in order as one implementor, not in waves.

## Close

- `gates.sh` green, one phase review (spine: `frontend/src/lib/queries.ts`).
- Delivery Gate: tasks 2, 4 and 6 are visible.
- ISSUES.md: close the six issues above.

## Result

- Phase review: 1 blocker. The ported address-change check sent the stored application token to the new address before saving (the ISS-005 leak). Fixed: an address change now needs the token in the same save, and only that token is probed. 3 nits fixed; the retry-cap nit is ISS-173.
- `gates.sh --performed-review=opus`: all gates passed.
- Delivery Gate: PASS. Admin > iTop (unverified notice under the token field; "Enter the token again to save a new URL." with Save disabled), Utilization (Refresh error Alert), customer page (Tickets tab and iTop org shown for a mapped customer, hidden otherwise), each in light and dark at 1280 px and 375 px. Run with Playwright screenshots on the dev stack.
