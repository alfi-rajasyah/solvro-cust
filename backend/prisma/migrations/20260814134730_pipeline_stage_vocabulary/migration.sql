-- Pipeline stage vocabulary correction (M1 review).
--
-- M1's initial migration (20260814125632_pipeline_models) shipped a
-- 6-value PipelineStage enum. The reference app's live schema
-- (VeloraApp/scripts/migrate.mjs) actually has 9 stages via a CHECK
-- constraint: assessment, rfp, poc, technical_clarification,
-- deliver_proposal, waiting_response, won, drop, hold. Only the automatic
-- nightly hold job was dropped from the port — manual hold stays, so all
-- 9 stages are ported.
--
-- Enum ORDER is load-bearing: the opportunity list route sorts by
-- `stage: "asc"`, and Postgres orders enum values by declaration order, so
-- this is also the board's column order. `poc` and `technical_clarification`
-- land between `rfp` and `deliver_proposal`; `hold` lands after `drop`.

-- AlterEnum
ALTER TYPE "PipelineStage" ADD VALUE 'poc' BEFORE 'deliver_proposal';
ALTER TYPE "PipelineStage" ADD VALUE 'technical_clarification' BEFORE 'deliver_proposal';
ALTER TYPE "PipelineStage" ADD VALUE 'hold';

-- AlterTable
-- request_date: manually-entered plain calendar day for when the
-- opportunity/request came in (same semantics as the existing `deadline`
-- column). pre_hold_stage: records which stage a deal was in immediately
-- before entering HOLD, so leaving HOLD can restore it — enum-typed here
-- (Velora's reference stores this as free TEXT) since HOLD can only be
-- entered from one of the 9 known PipelineStage values.
ALTER TABLE "opportunities" ADD COLUMN "request_date" DATE;
ALTER TABLE "opportunities" ADD COLUMN "pre_hold_stage" "PipelineStage";

-- AlterEnum
-- PipelineImportStatus is brand-new to Solvro — nothing has imported into
-- it yet, so renaming its labels to the house UPPERCASE enum-label
-- convention is safe; no existing row references the lowercase literals.
ALTER TYPE "PipelineImportStatus" RENAME VALUE 'ok' TO 'OK';
ALTER TYPE "PipelineImportStatus" RENAME VALUE 'error' TO 'ERROR';
