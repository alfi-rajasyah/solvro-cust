// Pure prefill computation for the won-deal handoff form (M5.24,
// DealCard.tsx's `HandoffProjectModal`, PRD §2.10). Split out into its own
// React-free module so it gets a plain-function vitest file instead of a
// component-render test — this repo has no @testing-library/react (see
// queries.reorder.test.ts's doc comment for the same rationale applied to
// `reorderOpportunitiesLocally`).
import { formatIDR } from "./pipelineFormat";
import type { CustomerSummary, Opportunity, UserSummary } from "./queries";

export interface HandoffDefaults {
  name: string;
  description: string;
  saId: number | "";
  customerId: number | "";
}

// Mirrors the backend's own `description: z.string().max(2000)` bound on
// both `createProjectSchema` (backend/src/routes/projects.ts) and the
// handoff route that now reuses it verbatim (finding S6) — a prefill this
// module hands back must never exceed what the backend will actually
// accept on submit.
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * `name` comes straight from the deal. `description` composes the deal's
 * own free-text description (when it has one) above a provenance note in
 * PRD §2.10's format — `From pipeline deal: {title} — {product_solution} —
 * Rp {value}` — clamped to `MAX_DESCRIPTION_LENGTH` (finding S2): only the
 * deal's own description gets truncated to make room; the provenance note
 * is always kept intact, since it's the one part of this composed string
 * that actually says where the project came from. `saId` prefills to the
 * deal's PIC only when that user is actually eligible to be picked as an SA
 * on the project form — `ProjectFormModal.tsx`'s own SA `<select>` sources
 * its options from the plain `useUsers()` list with no role filter ("role
 * names no longer gate who's eligible to be assigned", per that file's
 * comment), so eligibility here means "is this PIC present in that same
 * user list" — otherwise the field is left blank rather than sending a
 * saId the project form's own dropdown wouldn't have offered. `customerId`
 * soft-matches `customerName` against the customers list by exact,
 * case-insensitive name; no match leaves it blank rather than guessing.
 */
export function computeHandoffDefaults(
  deal: Pick<
    Opportunity,
    "title" | "description" | "customerName" | "picId" | "dealValue" | "productSolution"
  >,
  customers: CustomerSummary[],
  users: UserSummary[],
): HandoffDefaults {
  const note = `From pipeline deal: ${deal.title} — ${deal.productSolution} — ${formatIDR(deal.dealValue)}`;
  const description = deal.description ? clampComposedDescription(deal.description, note) : note;

  const targetName = deal.customerName.trim().toLowerCase();
  const matchedCustomer = customers.find((c) => c.name.trim().toLowerCase() === targetName);

  const picIsEligibleSa = deal.picId != null && users.some((u) => u.id === deal.picId);

  return {
    name: deal.title,
    description,
    saId: picIsEligibleSa ? (deal.picId as number) : "",
    customerId: matchedCustomer ? matchedCustomer.id : "",
  };
}

/**
 * Composes `${dealDescription}\n\n${note}`, clamped to
 * `MAX_DESCRIPTION_LENGTH` (finding S2). Only `dealDescription` is ever
 * truncated (from the end) to make room — `note` is always kept intact. In
 * the (practically unreachable, given `title`/`productSolution`'s own
 * backend field bounds) case where `note` alone is already at or past the
 * limit, there's no room left for any of the deal's own description at
 * all, so it's dropped entirely rather than truncating the note.
 */
function clampComposedDescription(dealDescription: string, note: string): string {
  const separator = "\n\n";
  const available = MAX_DESCRIPTION_LENGTH - separator.length - note.length;
  if (available <= 0) return note;
  const truncatedDeal =
    dealDescription.length > available ? dealDescription.slice(0, available) : dealDescription;
  return `${truncatedDeal}${separator}${note}`;
}
