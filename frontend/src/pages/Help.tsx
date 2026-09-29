import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { hasPermission, useAuth } from "@/lib/auth";
import { filterHelpTopics, type HelpTopic } from "@/lib/helpContent";

// Help page — a how-to guide for every feature the signed-in user can reach.
// Content lives in lib/helpContent.ts; topics gated by a permission (Executive,
// Admin) are hidden with the same rule the sidebar uses. Reached from the
// TopBar's help button only (no sidebar or ⌘K entry, by user decision).
export function Help() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  const topics = filterHelpTopics((p) => hasPermission(user, p), query);

  // /help#<topic> deep link: the sections render after the route mounts, so
  // the browser's own hash scroll finds nothing — scroll once they exist.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface">Help</h1>
          <p className="text-sm text-on-surface-variant">
            How to use Solvro — every page and feature available to you.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help…"
          aria-label="Search help"
          className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:w-80"
        />
      </header>

      {topics.length === 0 ? (
        <EmptyState icon="search_off" message={`No help topics match "${query.trim()}".`} />
      ) : (
        <div className="flex gap-8">
          <nav aria-label="Help topics" className="hidden w-48 shrink-0 md:block">
            <ul className="sticky top-4 space-y-0.5">
              {topics.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-on-surface-variant hover:bg-surface-container hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                    {t.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 space-y-4">
            {topics.map((t) => (
              <HelpSection key={t.id} topic={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HelpSection({ topic }: { topic: HelpTopic }) {
  return (
    <section
      id={topic.id}
      aria-labelledby={`${topic.id}-title`}
      className="scroll-mt-4 space-y-4 rounded-sm border border-outline-variant bg-surface-container-low p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">{topic.icon}</span>
          <h2 id={`${topic.id}-title`} className="text-lg font-semibold text-on-surface">
            {topic.title}
          </h2>
        </div>
        {topic.route && (
          <Link
            to={topic.route}
            className="text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Open {topic.title} →
          </Link>
        )}
      </div>
      <p className="text-sm text-on-surface-variant">{topic.summary}</p>

      {topic.entries.map((e) => (
        <div key={e.title} className="space-y-1.5">
          <h3 className="text-label-caps uppercase text-on-surface-variant">{e.title}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-on-surface marker:text-on-surface-variant">
            {e.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ))}

      {topic.shortcuts && (
        <dl className="divide-y divide-outline-variant rounded-sm border border-outline-variant">
          {topic.shortcuts.map((s) => (
            <div key={s.action} className="flex items-center justify-between gap-4 px-3 py-2">
              <dt className="text-sm text-on-surface">{s.action}</dt>
              <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 font-mono text-meta text-on-surface-variant"
                  >
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
