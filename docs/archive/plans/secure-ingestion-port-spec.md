# Secure Ingestion Port (Blueprint → Tasks) — spec

**Status: planned, not built.** Extracted verbatim from CLAUDE.md during the 2026-07-28 docs restructure; the auth invariant remains a CLAUDE.md Guardrail.

**Route**: `POST /webhook/blueprint`. The SA-to-TAM handoff that differentiates Solvro from a generic PM tool. Priority feature.

## Requirements

- API-key auth only — bypasses `requireAuth` entirely and must reject user JWTs (Guardrail).
- Creates `Blueprint` + child `Task` rows in a single transaction.
- Preserves `projectId ↔ blueprint` linkage so the AI Breakdown amber glow attaches correctly to generated tasks.
- Blueprint-generated tasks flagged via a `blueprintId` foreign key on `Task` so the UI can distinguish them from manually created tasks.

## Implementation notes (from the 2026-07-28 codebase audit)

- The `Blueprint` model already exists in `schema.prisma` (`projectId`/`payload`/`version`/`receivedAt`) and is surfaced in `projects.ts`'s `_count` select; `Task.blueprintId` does **not** exist yet — add via migration.
- `app.ts` sets `express.json({ limit: "1mb" })` — large blueprint payloads may need a per-route body-limit override.
