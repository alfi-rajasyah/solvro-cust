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
  return (
    <nav className="flex gap-1 whitespace-nowrap border-b border-outline-variant">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => onChange(item.key)}
            className={[
              "-mb-px border-b-2 px-4 py-2 font-display text-sm font-semibold transition-colors",
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
