// Screen-reader announcements for keyboard drags on the boards. dnd-kit's
// defaults read "Picked up draggable item 57"; these name the card and the
// column instead. Pure: the boards pass lookups, nothing here touches React.
import type { Announcements, UniqueIdentifier } from "@dnd-kit/core";

export interface BoardAnnouncementSource {
  /** What a card is called aloud (task title, ticket ref), or null if the id is not a card. */
  cardLabel: (id: UniqueIdentifier) => string | null;
  /** Column an id names, or the column a card currently sits in. */
  columnLabelOf: (id: UniqueIdentifier) => string | null;
  /** Optional: true when dropping the card from `activeId` onto `overId`'s column is not allowed. */
  isForbiddenTarget?: (activeId: UniqueIdentifier, overId: UniqueIdentifier) => boolean;
  /** Optional: plain-text outcome of a drop that replaces the default "was dropped" sentence. */
  dropOutcome?: (activeId: UniqueIdentifier, overId: UniqueIdentifier) => string | null;
}

export function buildBoardAnnouncements(src: BoardAnnouncementSource): Announcements {
  // Column the card sits in right now. On the first announcement that is where the drag began.
  const origin = (activeId: UniqueIdentifier) => src.columnLabelOf(activeId);
  const name = (id: UniqueIdentifier) => src.cardLabel(id) ?? "card";

  const target = (activeId: UniqueIdentifier, overId: UniqueIdentifier): string => {
    const col = src.columnLabelOf(overId);
    const overCard = overId === activeId ? null : src.cardLabel(overId);
    let base: string;
    if (overCard) base = col ? `over ${overCard} in ${col}` : `over ${overCard}`;
    else base = col ? `over ${col}` : "over another card";
    return src.isForbiddenTarget?.(activeId, overId) ? `${base}. Not an allowed move` : base;
  };

  return {
    onDragStart({ active }) {
      const from = origin(active.id);
      return `Picked up ${name(active.id)}${from ? ` from ${from}` : ""}.`;
    },
    onDragOver({ active, over }) {
      if (!over) return `${name(active.id)} is not over a column.`;
      return `${name(active.id)} is ${target(active.id, over.id)}.`;
    },
    onDragEnd({ active, over }) {
      if (!over) return `${name(active.id)} was dropped. Nothing changed.`;
      const outcome = src.dropOutcome?.(active.id, over.id);
      if (outcome) return `${name(active.id)} ${outcome}`;
      if (src.isForbiddenTarget?.(active.id, over.id)) {
        return `${name(active.id)} was dropped ${target(active.id, over.id)}. Nothing changed.`;
      }
      return `${name(active.id)} was dropped ${target(active.id, over.id)}.`;
    },
    onDragCancel({ active }) {
      return `Move cancelled. ${name(active.id)} stays where it was.`;
    },
  };
}
