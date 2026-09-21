import { describe, expect, it } from "vitest";
import { computeHandoffDefaults } from "./handoffDefaults";
import { formatIDR } from "./pipelineFormat";
import type { CustomerSummary, UserSummary } from "./queries";

function makeCustomer(overrides: Partial<CustomerSummary> & Pick<CustomerSummary, "id" | "name">): CustomerSummary {
  return {
    accountManager: null,
    solutionArchitect: null,
    description: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    tamId: null,
    tam: null,
    _count: { projects: 0 },
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserSummary> & Pick<UserSummary, "id" | "username">): UserSummary {
  return {
    email: "user@example.com",
    role: "SA",
    permissions: [],
    ...overrides,
  };
}

const BASE_DEAL = {
  title: "Acme Rollout",
  description: null as string | null,
  customerName: "Acme Corp",
  picId: null as number | null,
  dealValue: 150_000_000,
  productSolution: "Data Platform",
};

// PRD §2.10's exact format: "From pipeline deal: {title} — {product_solution}
// — Rp {value}" (finding N8).
const NOTE = `From pipeline deal: ${BASE_DEAL.title} — ${BASE_DEAL.productSolution} — ${formatIDR(BASE_DEAL.dealValue)}`;

describe("computeHandoffDefaults", () => {
  it("prefills name verbatim and description as just the provenance note when the deal has none", () => {
    const result = computeHandoffDefaults(BASE_DEAL, [], []);
    expect(result.name).toBe("Acme Rollout");
    expect(result.description).toBe(NOTE);
  });

  it("appends the provenance note after the deal's own description", () => {
    const result = computeHandoffDefaults(
      { ...BASE_DEAL, description: "Multi-region rollout, phase 2." },
      [],
      [],
    );
    expect(result.description).toBe(`Multi-region rollout, phase 2.\n\n${NOTE}`);
  });

  it("clamps the composed description to 2000 chars, keeping the note fully intact, once past the limit (S2)", () => {
    const available = 2000 - 2 - NOTE.length;
    const longDescription = "x".repeat(available + 500);
    const result = computeHandoffDefaults({ ...BASE_DEAL, description: longDescription }, [], []);
    expect(result.description).toHaveLength(2000);
    expect(result.description.endsWith(`\n\n${NOTE}`)).toBe(true);
    expect(result.description.startsWith("x".repeat(available))).toBe(true);
  });

  it("leaves the composed description unclamped right at the 2000-char boundary (S2)", () => {
    const available = 2000 - 2 - NOTE.length;
    const boundaryDescription = "x".repeat(available);
    const result = computeHandoffDefaults(
      { ...BASE_DEAL, description: boundaryDescription },
      [],
      [],
    );
    expect(result.description).toBe(`${boundaryDescription}\n\n${NOTE}`);
    expect(result.description).toHaveLength(2000);
  });

  it("soft-matches the customer by exact case-insensitive name", () => {
    const customers = [
      makeCustomer({ id: 1, name: "Other Co" }),
      makeCustomer({ id: 2, name: "ACME corp" }),
    ];
    const result = computeHandoffDefaults(BASE_DEAL, customers, []);
    expect(result.customerId).toBe(2);
  });

  it("leaves customerId blank when no customer name matches", () => {
    const customers = [makeCustomer({ id: 1, name: "Other Co" })];
    const result = computeHandoffDefaults(BASE_DEAL, customers, []);
    expect(result.customerId).toBe("");
  });

  it("does not match on a partial/substring name", () => {
    const customers = [makeCustomer({ id: 1, name: "Acme Corp International" })];
    const result = computeHandoffDefaults(BASE_DEAL, customers, []);
    expect(result.customerId).toBe("");
  });

  it("prefills saId from the deal's PIC when that user is in the eligible-SA list", () => {
    const users = [makeUser({ id: 7, username: "sofia" })];
    const result = computeHandoffDefaults({ ...BASE_DEAL, picId: 7 }, [], users);
    expect(result.saId).toBe(7);
  });

  it("leaves saId blank when the PIC isn't in the users list", () => {
    const users = [makeUser({ id: 9, username: "someone-else" })];
    const result = computeHandoffDefaults({ ...BASE_DEAL, picId: 7 }, [], users);
    expect(result.saId).toBe("");
  });

  it("leaves saId blank when the deal has no PIC", () => {
    const users = [makeUser({ id: 7, username: "sofia" })];
    const result = computeHandoffDefaults({ ...BASE_DEAL, picId: null }, [], users);
    expect(result.saId).toBe("");
  });
});
