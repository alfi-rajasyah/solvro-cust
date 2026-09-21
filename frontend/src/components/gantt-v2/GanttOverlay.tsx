import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import type { GanttEvent } from "@/components/reui/gantt/gantt-types";
import type { CreateDependencyInput, Task, TaskDependency } from "@/lib/queries";
import { buildConnectorRoute, type ConnectorRoute } from "./connector-paths";

// Plan B Task 6 — chart-space SVG overlay: dependency connectors (with
// drag-create + delete) and baseline ghosts, all driven by real DOM
// measurement rather than analytical geometry (the old engine's approach —
// see connector-paths.ts's file header for why).
//
// Mount point: `[data-slot="gantt-timeline-pane"]`
// (frontend/src/components/reui/gantt/gantt-view.tsx:2310-2313) — the
// `relative h-full min-w-0 flex-1` div that directly wraps the scroll area.
// It's already `position: relative`, so an `inset-0` absolutely-positioned
// child lands exactly over the visible timeline viewport with no manual
// rect math — the same technique the vendored engine's own
// `GanttOffscreenChips` uses (gantt-view.tsx:3568-3757), except that
// component is baked into the vendored render tree itself; this one reaches
// the same DOM node from OUTSIDE it via `createPortal`, so the vendored file
// stays untouched.
//
// The actual SCROLLING element is one level down:
// `[data-slot="scroll-area-viewport"]` (gantt-view.tsx:2209/2425, and
// Base UI's own `ScrollAreaPrimitive.Viewport` in customScrollbars mode —
// `frontend/src/components/ui/scroll-area.tsx`). `getPaneViewport()`
// (gantt-view.tsx:294-298) is the vendored file's own helper for this exact
// lookup; it isn't exported, so it's re-derived here as `resolveViewport`.

const PANE_SELECTOR = '[data-slot="gantt-timeline-pane"]';
const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';
const BAR_SELECTOR = '[data-slot="gantt-bar"]';

// Muted gray, ported VERBATIM from the old engine
// (frontend/src/components/gantt/GanttBar.tsx:291,369) — a raw literal, not
// a semantic CSS custom property (no `--x` token in index.css matches this
// exact shade), so there is nothing to substitute; kept as-is per the task's
// "if raw values port verbatim and note it" instruction.
const BASELINE_COLOR = "rgb(136, 135, 128)";

export interface GanttOverlayProps {
  /** Wraps the mounted `<Gantt>` tree; used to locate the timeline pane. */
  containerRef: RefObject<HTMLElement | null>;
  dependencies: TaskDependency[];
  events: GanttEvent<Task>[];
  showBaseline: boolean;
  canEdit: boolean;
  onCreate: (input: CreateDependencyInput) => void;
  onDelete: (id: number) => void;
}

interface Measurement {
  bars: Map<number, DOMRect>;
  contentWidth: number;
  contentHeight: number;
  scrollLeft: number;
  scrollTop: number;
}

interface ConnectDragState {
  sourceTaskId: number;
  side: "left" | "right";
  startX: number;
  startY: number;
  cursorX: number;
  cursorY: number;
}

function resolvePane(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>(PANE_SELECTOR) ?? null;
}

function resolveViewport(pane: HTMLElement | null): HTMLElement | null {
  return pane?.querySelector<HTMLElement>(VIEWPORT_SELECTOR) ?? null;
}

/**
 * Rects of every bar keyed by taskId, in the scroll-content coordinate
 * space (i.e. as if unscrolled). Ported verbatim from the task-6 brief's
 * measurement core. `scrollEl` is the actual scrolling node
 * (`[data-slot="scroll-area-viewport"]`), not the outer relatively-
 * positioned pane.
 */
function measureBars(scrollEl: HTMLElement): Map<number, DOMRect> {
  const originRect = scrollEl.getBoundingClientRect();
  const out = new Map<number, DOMRect>();
  scrollEl.querySelectorAll<HTMLElement>("[data-task-id]").forEach((el) => {
    const bar = el.closest<HTMLElement>(BAR_SELECTOR);
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    out.set(
      Number(el.dataset.taskId),
      new DOMRect(
        r.left - originRect.left + scrollEl.scrollLeft,
        r.top - originRect.top + scrollEl.scrollTop,
        r.width,
        r.height,
      ),
    );
  });
  return out;
}

/** date-only ISO parse, matching adapter.ts's `taskToEvent` convention. */
function parseDateOnly(iso: string): Date {
  return parseISO(iso.slice(0, 10));
}

export function GanttOverlay({
  containerRef,
  dependencies,
  events,
  showBaseline,
  canEdit,
  onCreate,
  onDelete,
}: GanttOverlayProps) {
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [connectDrag, setConnectDrag] = useState<ConnectDragState | null>(null);

  // "Latest ref" for the mutation callbacks so the pointerdown-capture effect
  // below doesn't need to re-register on every SolvroGantt render (onCreate/
  // onDelete are typically fresh closures each render there).
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  // Resolve the pane/viewport on every render — cheap (two querySelector
  // calls) and necessary because <Gantt> itself mounts/unmounts based on
  // `resources.length > 0` in SolvroGantt.tsx, so the target DOM node can
  // change identity across renders. State assignment bails out via
  // Object.is when the resolved node is unchanged, so this doesn't cause
  // extra re-renders in the steady state.
  useEffect(() => {
    const pane = resolvePane(containerRef.current);
    setPaneEl(pane);
    setViewportEl(resolveViewport(pane));
  });

  // ---- Measurement: re-run on pane scroll, pane resize, content resize
  // (scale/collapse changes resize the scrollable content without
  // necessarily resizing the pane itself — collapse state lives inside
  // GanttView and isn't exposed upward, so observing the content root is
  // how both are caught without threading that state through), and
  // whenever `events` changes identity (task dates changed — e.g. a drag
  // commit landed and the tasks query refetched). Batched through one
  // requestAnimationFrame so any burst of triggers in the same frame
  // collapses into a single querySelectorAll + getBoundingClientRect pass. ----
  useEffect(() => {
    const pane = paneEl;
    const viewport = viewportEl;
    if (!pane || !viewport) {
      setMeasurement(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      setMeasurement({
        bars: measureBars(viewport),
        contentWidth: viewport.scrollWidth,
        contentHeight: viewport.scrollHeight,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    viewport.addEventListener("scroll", schedule, { passive: true });
    const paneObserver = new ResizeObserver(schedule);
    paneObserver.observe(pane);
    const contentEl = viewport.firstElementChild as HTMLElement | null;
    const contentObserver = contentEl ? new ResizeObserver(schedule) : null;
    if (contentEl) contentObserver?.observe(contentEl);
    return () => {
      viewport.removeEventListener("scroll", schedule);
      paneObserver.disconnect();
      contentObserver?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [paneEl, viewportEl, events]);

  // ---- Drag-create: a capture-phase pointerdown listener catches presses
  // on SolvroBar's connect dots (`data-connect-dot`) BEFORE the dot's own
  // bubble-phase handler calls stopPropagation() to block ReUI's bar-move
  // gesture — capture runs top-down before the target/bubble phases, so it
  // fires regardless. This is what lets SolvroBar stay a thin, prop-free
  // affordance (just the dot + a stopPropagation no-op) while all of the
  // drag lifecycle lives here, matching the old engine's handleConnectStart
  // (frontend/src/components/gantt/GanttFrame.tsx:215-306) one-to-one. ----
  useEffect(() => {
    if (!canEdit || !viewportEl) return;
    const viewport = viewportEl;
    // Fix pass (post-review): tracks the in-flight drag's window-listener
    // teardown so an effect re-run (canEdit/viewportEl changing) or an
    // overlay unmount WHILE a drag is active also removes pointermove/
    // pointerup/keydown — not just the delegated pointerdown listener below.
    // Without this, starting a drag and then having this effect re-run (or
    // GanttOverlay unmount, e.g. the project's resources emptying out) would
    // leak those three window listeners for good — their own internal
    // `cleanup()` only ever runs on a normal pointerup/Escape, never on
    // teardown from outside.
    let teardownActiveDrag: (() => void) | null = null;

    const toContent = (clientX: number, clientY: number) => {
      const r = viewport.getBoundingClientRect();
      return {
        x: clientX - r.left + viewport.scrollLeft,
        y: clientY - r.top + viewport.scrollTop,
      };
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const dot = target?.closest<HTMLElement>("[data-connect-dot]");
      if (!dot) return;
      const side: "left" | "right" =
        dot.dataset.connectSide === "left" ? "left" : "right";
      const barEl = dot.closest<HTMLElement>("[data-task-id]");
      const sourceTaskId = barEl ? Number(barEl.dataset.taskId) : Number.NaN;
      if (!Number.isFinite(sourceTaskId)) return;

      const start = toContent(e.clientX, e.clientY);
      setConnectDrag({
        sourceTaskId,
        side,
        startX: start.x,
        startY: start.y,
        cursorX: start.x,
        cursorY: start.y,
      });

      const onMove = (ev: PointerEvent) => {
        const c = toContent(ev.clientX, ev.clientY);
        setConnectDrag((prev) => (prev ? { ...prev, cursorX: c.x, cursorY: c.y } : null));
      };
      const onUp = (ev: PointerEvent) => {
        endDrag();
        // Walk up from elementFromPoint until we find a [data-task-id].
        // The release target is the successor (or predecessor — see below).
        let node: Element | null = document.elementFromPoint(ev.clientX, ev.clientY);
        let targetTaskId: number | null = null;
        while (node) {
          const id = (node as HTMLElement).dataset?.taskId;
          if (id) {
            targetTaskId = Number(id);
            break;
          }
          node = node.parentElement;
        }
        setConnectDrag(null);
        if (targetTaskId === null || targetTaskId === sourceTaskId) return;
        // Right dot: this task is the predecessor, the drop target the
        // successor. Left dot: reversed — this task depends on the drop
        // target, so the drop target is the predecessor. Ported verbatim
        // from GanttFrame.tsx:265-278.
        const predecessorTaskId = side === "left" ? targetTaskId : sourceTaskId;
        const successorTaskId = side === "left" ? sourceTaskId : targetTaskId;
        onCreateRef.current({
          predecessorTaskId,
          successorTaskId,
          type: "HARD",
          // Gantt-created deps always render right→left regardless of which
          // dot started the drag; persist that orientation so a future
          // consumer (e.g. a reintroduced Network Diagram) routes them the
          // same way. Matches GanttFrame.tsx:274-276.
          sourceHandle: "right-source",
          targetHandle: "left-target",
        });
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          endDrag();
          setConnectDrag(null);
        }
      };
      function endDrag() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKey);
        teardownActiveDrag = null;
      }
      teardownActiveDrag = endDrag;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey);
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      teardownActiveDrag?.();
      setConnectDrag(null);
    };
  }, [canEdit, viewportEl]);

  // ---- Connectors: route predecessor-right → successor-left for every
  // dependency with BOTH endpoints currently measured. A collapsed-away
  // endpoint (its section collapsed, or virtualized out of range) simply
  // isn't in `bars` — the connector is skipped for that render, accepted
  // per the task brief. ----
  const connectors = useMemo(() => {
    if (!measurement) return [];
    const out: Array<ConnectorRoute & { id: number; type: TaskDependency["type"] }> = [];
    for (const dep of dependencies) {
      const predRect = measurement.bars.get(dep.predecessorTaskId);
      const succRect = measurement.bars.get(dep.successorTaskId);
      if (!predRect || !succRect) continue;
      out.push({ id: dep.id, type: dep.type, ...buildConnectorRoute(predRect, succRect) });
    }
    return out;
  }, [measurement, dependencies]);

  const eventByTaskId = useMemo(() => {
    const map = new Map<number, GanttEvent<Task>>();
    for (const e of events) {
      if (e.data) map.set(e.data.id, e);
    }
    return map;
  }, [events]);

  // ---- Baselines: derive one px-per-day scale from any single measured
  // bar + its live event dates, then place a ghost rect per task that has
  // both baseline dates AND a currently-measured live bar (its row's Y —
  // the scale itself is row-independent). ----
  const baselineRects = useMemo(() => {
    if (!measurement || !showBaseline) return [];
    const { bars } = measurement;

    let donor: { originX: number; start: Date; pxPerDay: number } | null = null;
    for (const [taskId, rect] of bars) {
      const ev = eventByTaskId.get(taskId);
      if (!ev || rect.width <= 0) continue;
      const days = differenceInCalendarDays(ev.end, ev.start);
      if (days <= 0) continue;
      donor = { originX: rect.x, start: ev.start, pxPerDay: rect.width / days };
      break;
    }
    if (!donor) return [];
    const x = (d: Date) =>
      donor.originX + differenceInCalendarDays(d, donor.start) * donor.pxPerDay;

    const out: Array<{ taskId: number; x: number; width: number; y: number }> = [];
    for (const [taskId, rect] of bars) {
      const task = eventByTaskId.get(taskId)?.data;
      if (!task?.baselineStartDate || !task?.baselineDueDate) continue;
      const bStart = parseDateOnly(task.baselineStartDate);
      // +1 day exclusive-end padding, matching how live bars render
      // (adapter.ts's taskToEvent: `end = addDays(dueDate, 1)`).
      const bEndExclusive = addDays(parseDateOnly(task.baselineDueDate), 1);
      const x1 = x(bStart);
      const x2 = x(bEndExclusive);
      out.push({ taskId, x: x1, width: Math.max(0, x2 - x1), y: rect.y + rect.height + 2 });
    }
    return out;
  }, [measurement, showBaseline, eventByTaskId]);

  if (!paneEl) return null;

  const content = (
    <div
      data-slot="gantt-overlay"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 15 }}
    >
      <svg
        width={measurement?.contentWidth ?? 0}
        height={measurement?.contentHeight ?? 0}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "visible",
          transform: `translate(${-(measurement?.scrollLeft ?? 0)}px, ${-(measurement?.scrollTop ?? 0)}px)`,
        }}
      >
        <defs>
          <marker
            id="gantt-v2-conn-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {showBaseline &&
          baselineRects.map((b) => (
            <rect
              key={`baseline-${b.taskId}`}
              data-baseline-rect=""
              data-baseline-task-id={b.taskId}
              x={b.x}
              y={b.y}
              width={b.width}
              height={3}
              rx={1.5}
              fill={BASELINE_COLOR}
              opacity={0.6}
            />
          ))}

        {/* Semantic tokens, ported verbatim from GanttConnectors.tsx:253/268
            (--on-surface-variant default, --primary on hover) — same raw
            `rgb(var(--x))` syntax as the old engine, not translated to
            Tailwind className utilities, to keep this a literal port. */}
        <g style={{ color: "rgb(var(--on-surface-variant))" }}>
          {connectors.map((c) => {
            const hovered = canEdit && hoveredId === c.id;
            return (
              <g
                key={c.id}
                data-connector-id={c.id}
                data-connector-type={c.type}
                onMouseEnter={canEdit ? () => setHoveredId(c.id) : undefined}
                onMouseLeave={
                  canEdit ? () => setHoveredId((prev) => (prev === c.id ? null : prev)) : undefined
                }
                style={hovered ? { color: "rgb(var(--primary))" } : undefined}
              >
                <path
                  d={c.d}
                  stroke="currentColor"
                  strokeWidth={hovered ? 2 : 1.25}
                  strokeDasharray={c.type === "SOFT" ? "5 4" : undefined}
                  fill="none"
                  opacity={hovered ? 1 : 0.75}
                  markerEnd="url(#gantt-v2-conn-arrow)"
                />
                {canEdit && (
                  <path
                    d={c.dHit ?? c.d}
                    stroke="transparent"
                    strokeWidth={14}
                    fill="none"
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  />
                )}
                {hovered && (
                  <g
                    role="button"
                    aria-label="Delete dependency"
                    tabIndex={0}
                    style={{ pointerEvents: "all", cursor: "pointer" }}
                    onClick={() => onDeleteRef.current(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDeleteRef.current(c.id);
                      }
                    }}
                  >
                    <title>Delete dependency</title>
                    <circle
                      cx={c.ax}
                      cy={c.ay}
                      r={8}
                      fill="rgb(var(--primary))"
                      stroke="white"
                      strokeWidth={1.5}
                    />
                    <path
                      d={`M ${c.ax - 3} ${c.ay - 3} L ${c.ax + 3} ${c.ay + 3} M ${c.ax - 3} ${c.ay + 3} L ${c.ax + 3} ${c.ay - 3}`}
                      stroke="white"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      fill="none"
                    />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {connectDrag && (
          <path
            d={`M ${connectDrag.startX} ${connectDrag.startY} L ${connectDrag.cursorX} ${connectDrag.cursorY}`}
            stroke="rgb(var(--primary))"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="none"
            markerEnd="url(#gantt-v2-conn-arrow)"
          />
        )}
      </svg>
    </div>
  );

  return createPortal(content, paneEl);
}
