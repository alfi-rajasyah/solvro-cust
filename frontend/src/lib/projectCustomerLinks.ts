import type { ProjectCustomerLink } from "@/lib/queries";

// Editing a project's customer link set in the form
// (docs/archive/plans/multi-customer-projects.md): at least one link while any
// exist, exactly one primary.

/** The `customers` request body. */
export function linkBody(links: readonly ProjectCustomerLink[]): { id: number; isPrimary: boolean }[] {
  return links.map((l) => ({ id: l.id, isPrimary: l.isPrimary }));
}

/** Adds a customer (the first one becomes primary). */
export function addLink(links: readonly ProjectCustomerLink[], c: { id: number; name: string }): ProjectCustomerLink[] {
  if (links.some((l) => l.id === c.id)) return [...links];
  return [...links, { id: c.id, name: c.name, isPrimary: links.length === 0 }];
}

/** Removes a customer; when it was the primary the first remaining one takes over. */
export function removeLink(links: readonly ProjectCustomerLink[], id: number): ProjectCustomerLink[] {
  const rest = links.filter((l) => l.id !== id);
  if (rest.length > 0 && !rest.some((l) => l.isPrimary)) rest[0] = { ...rest[0], isPrimary: true };
  return rest;
}

export function setPrimaryLink(links: readonly ProjectCustomerLink[], id: number): ProjectCustomerLink[] {
  return links.map((l) => ({ ...l, isPrimary: l.id === id }));
}
