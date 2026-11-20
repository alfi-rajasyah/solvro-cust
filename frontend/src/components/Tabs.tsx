import { useEffect, useRef } from "react";

interface TabItem<K extends string> {
  key: K;
  label: string;
}

interface TabsProps<K extends string> {
  items: ReadonlyArray<TabItem<K>>;
  active: K;
  onChange: (key: K) => void;
}

export function Tabs<K extends string>({ items, active, onChange }: TabsProps<K>) {
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  // Centre the active tab inside the nav only; scrollIntoView would also
  // scroll the page on a deep link.
  useEffect(() => {
    const nav = navRef.current;
    const btn = activeRef.current;
    if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo?.({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2 });
  }, [active]);
  return (
    // Scrolls sideways when the tabs outgrow the row (5 tabs at 375px); the
    // scrollbar is hidden, the active tab is brought into view below.
    <nav ref={navRef} className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-outline-variant [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            ref={isActive ? activeRef : undefined}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => onChange(item.key)}
            className={[
              "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 -mb-px shrink-0 border-b-2 px-4 py-2 font-display text-sm font-semibold transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface",
            ].join(" ")}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
