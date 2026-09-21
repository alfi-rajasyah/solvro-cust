// Vendored from ReUI: https://reui.io/r/data-grid.json
// (redirects to https://reui.io/r/styles/base-nova/data-grid.json)
// Retrieved: 2026-08-01
// Multi-file registry item (10 files) — landed as
// frontend/src/components/reui/data-grid/, mirroring the payload's own
// internal import paths (its files already import each other via
// `@/components/reui/data-grid/data-grid` / `.../data-grid-table`, which
// presuppose this directory layout) rather than flattening to
// `reui/data-grid-*.tsx` — this way none of the registry's own internal
// imports needed rewriting.
// Content below is the registry item's file content verbatim except for the
// marked SOLVRO PATCH hand-edits, plus one mechanical, file-wide
// substitution not individually marked at every call site: every
// `<IconPlaceholder lucide="X" tabler="..." hugeicons="..." phosphor="..."
// remixicon="..." .../>` (the registry's icon-library-agnostic placeholder,
// importing from the nonexistent `@/app/(create)/components/icon-placeholder`
// — a registry-build artifact, not something ever meant to ship) was
// replaced with the concrete `<X .../>` from `lucide-react` (this repo's
// icon library for vendored files per frontend/CLAUDE.md), keeping only the
// non-icon-library props (className, aria-hidden, etc.).
"use client"
"use no memo"

import { memo, useMemo } from "react"
import type { HTMLAttributes, ReactNode } from "react"
import {
  getColumnHeaderLabel,
  useDataGrid,
} from "@/components/reui/data-grid/data-grid"
import type { Column } from "@tanstack/react-table"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ArrowDownIcon, ArrowLeftIcon, ArrowLeftToLineIcon, ArrowRightIcon, ArrowRightToLineIcon, ArrowUpIcon, CheckIcon, ChevronsUpDownIcon, PinOffIcon, Settings2Icon } from "lucide-react"

interface DataGridColumnHeaderProps<
  TData,
  TValue,
> extends HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>
  /** When omitted, uses `column.columnDef.meta.headerTitle`, then a string `columnDef.header`, then `column.id`. */
  title?: string
  icon?: ReactNode
  /** Reserved; pin controls are gated by tableLayout.columnsPinnable + column.getCanPin(). */
  pinnable?: boolean
  filter?: ReactNode
  visibility?: boolean
}

function DataGridColumnHeaderInner<TData, TValue>({
  column,
  title,
  icon,
  className,
  filter,
  visibility = false,
}: DataGridColumnHeaderProps<TData, TValue>) {
  const { isLoading, table, props } = useDataGrid()
  const resolvedTitle = title ?? getColumnHeaderLabel(column)

  // TanStack's columnOrder defaults to [] until a consumer seeds it; fall
  // back to the definition order so Move Left/Right work out of the box.
  const columnOrderState = table.getState().columnOrder
  const columnOrder =
    columnOrderState.length > 0
      ? columnOrderState
      : table.getAllLeafColumns().map((leafColumn) => leafColumn.id)
  const columnVisibilityKey =
    props.tableLayout?.columnsVisibility && visibility
      ? JSON.stringify(table.getState().columnVisibility)
      : ""
  const isSorted = column.getIsSorted()
  const isPinned = column.getIsPinned()
  const canSort = column.getCanSort()
  const canPin = column.getCanPin()
  const canResize = column.getCanResize()

  const columnIndex = columnOrder.indexOf(column.id)
  const canMoveLeft = columnIndex > 0
  const canMoveRight = columnIndex < columnOrder.length - 1

  // SOLVRO PATCH — contract (phase review S1, reui-data-grid.md): a column
  // declaring `meta.headerClassName: "text-right"` right-aligns BOTH the
  // `<th>`'s own text (already true for free — `data-grid-table.tsx`'s
  // `DataGridTableHeadRowCell` spreads `meta.headerClassName` straight onto
  // the `<th>`) AND this component's own header row. Reused rather than
  // inventing a new meta flag, so pages keep one right-align convention for
  // both numeric-column headers and the non-sortable label path below
  // (which already honors the `<th>`'s `text-align` for free, being
  // `inline-flex` — an inline-level box lays out like text and follows its
  // container's `text-align`). See `alignEnd`'s two call sites for why the
  // SORTABLE path needed this and the plain-label path didn't.
  const headerClassNameMeta = column.columnDef.meta?.headerClassName
  const alignEnd =
    typeof headerClassNameMeta === "string" && headerClassNameMeta.includes("text-right")

  const handleSort = () => {
    if (isSorted === "asc") {
      column.toggleSorting(true)
    } else if (isSorted === "desc") {
      column.clearSorting()
    } else {
      column.toggleSorting(false)
    }
  }

  // SOLVRO PATCH — `text-secondary-foreground` has no background pair in
  // this codebase's theme bridge (`--color-secondary-foreground` routes to
  // `on-secondary`, calibrated for text on a solid `bg-secondary` fill, not
  // as a standalone muted-text color): rendered at ≈1.05:1 contrast against
  // the surrounding surface in both themes — a `-foreground` token used
  // without its background pair is the same class of bug as a bare border
  // without a color class. Replaced with `text-muted-foreground` (the
  // app-wide muted-text token) at every site in this file.
  //
  // Superseding SOLVRO PATCH (Tasks.tsx DataGrid pilot, reui-data-grid.md
  // Checkpoint B, fix round): the Task-1 vendoring fix that landed here
  // normalized upstream's arbitrary `text-[0.8125rem]` to `text-xs` (13px)
  // — the pilot replaced that with DESIGN.md §2's `text-label-caps`
  // (12px/700/0.05em-tracking, uppercase paired explicitly per the token's
  // own contract — `uppercase` alone, no extra `tracking-widest`: the
  // token's own 0.05em is DESIGN.md's binding value, the pre-DataGrid
  // Tasks table's `tracking-widest` (0.1em) does not carry over), matching
  // the pre-DataGrid Tasks table's column-header style and resolving two
  // open nits in one move: the 13px-label/15px-button mixed row this file
  // shipped with (see headerButtonClassName below), and DESIGN.md §5's
  // "compact data-grid mode" ask. Phase-wide decision, not Tasks-only —
  // every DataGrid table across the app inherits this header typography.
  // Dropped `font-normal`: text-label-caps bakes in its own font-weight
  // (700), and stacking `font-normal` alongside it just races two
  // font-weight declarations for no benefit.
  //
  // The fix round's root-fix lives in `lib/utils.ts`'s `extendTailwindMerge`
  // call, not here: `text-label-caps` is a project-defined `@theme` key
  // plain `twMerge` has no knowledge of, so before that fix it fell through
  // `font-size`'s validator to `text-color`'s permissive default validator
  // and got misfiled as a color — silently evicting THIS SAME `cn()` call's
  // `text-muted-foreground` (a real color class) via twMerge's own conflict
  // resolution. Registering the six named `@theme` text roles in
  // `lib/utils.ts`'s `theme.text` extension fixes that at the source for
  // every consumer, not just this file, so no `!important` workaround is
  // needed here anymore (an earlier revision of this patch used
  // `text-label-caps!`, matching DESIGN.md's `shadow-overlay!` precedent —
  // superseded once the classifier itself was fixed).
  const headerLabelClassName = cn(
    "text-muted-foreground inline-flex h-full items-center gap-1.5 font-display text-label-caps font-bold uppercase [&_svg]:opacity-60 [&_svg]:size-3.5",
    className
  )

  // SOLVRO PATCH — same `-foreground`-without-background-pair fix as above.
  // `hover:bg-secondary`/`data-[state=open]:bg-secondary` also swapped to
  // `hover:bg-accent`/`data-[state=open]:bg-accent`: DESIGN.md §1's hover
  // surface, matching `ui/button.tsx`'s ghost variant
  // (`hover:bg-accent hover:text-accent-foreground`).
  //
  // Superseding SOLVRO PATCH (Tasks.tsx DataGrid pilot, reui-data-grid.md
  // Checkpoint B, fix round): identical typography treatment as
  // headerLabelClassName above — see that comment for the full history and
  // the `lib/utils.ts` root-fix. This className renders as a
  // `<Button variant="ghost">` child, whose own `buttonVariants` base
  // carries `text-sm font-medium`; with the classifier fixed,
  // `text-label-caps` now dedupes cleanly against `text-sm` via the same
  // proven mechanism as the Task-1 `text-xs` override (both stock and named
  // font-size classes now live in twMerge's `font-size` group).
  //
  // `font-bold` is still listed as its own class, not left to
  // `text-label-caps` alone — Tailwind v4 threads named-text-size
  // font-weight through the SAME `--tw-font-weight` custom property that
  // `font-{weight}` utilities set (`.text-label-caps{font-weight:var(--tw-
  // font-weight,700)}` — confirmed by reading the built CSS), and custom
  // properties cascade independently of the property that reads them: even
  // with `font-size`-group deduping now correctly dropping `text-sm`,
  // `font-medium` is a SEPARATE class in a separate `font-weight` group, so
  // it survives deduping on its own and would still poison
  // `--tw-font-weight` to 500 before `text-label-caps`'s `var(--tw-font-
  // weight, 700)` fallback ever gets read. `font-bold` (recognized by
  // twMerge as the same `font-weight` group as `font-medium`) evicts it
  // outright, so the variable is never poisoned to begin with.
  const headerButtonClassName = cn(
    "text-muted-foreground hover:bg-accent data-[state=open]:bg-accent hover:text-foreground data-[state=open]:text-foreground px-2 h-6 rounded-lg font-display text-label-caps font-bold uppercase",
    className
  )

  const sortIcon =
    canSort &&
    (isSorted === "desc" ? (
      <ArrowDownIcon
        className="size-3.25"
        aria-hidden="true"
      />
    ) : isSorted === "asc" ? (
      <ArrowUpIcon
        className="size-3.25"
        aria-hidden="true"
      />
    ) : (
      <ChevronsUpDownIcon
        className="mt-px size-3.25"
        aria-hidden="true"
      />
    ))

  const hasControls =
    props.tableLayout?.columnsMovable ||
    (props.tableLayout?.columnsVisibility && visibility) ||
    (props.tableLayout?.columnsPinnable && canPin) ||
    filter

  const menuItems = useMemo(() => {
    const items: ReactNode[] = []
    let hasPreviousSection = false

    // Filter section
    if (filter) {
      items.push(
        <DropdownMenuGroup key="group-filter">
          <DropdownMenuLabel key="filter">{filter}</DropdownMenuLabel>
        </DropdownMenuGroup>
      )
      hasPreviousSection = true
    }

    // Sort section
    if (canSort) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-sort" />)
      }
      items.push(
        <DropdownMenuItem
          key="sort-asc"
          onClick={() => {
            if (isSorted === "asc") {
              column.clearSorting()
            } else {
              column.toggleSorting(false)
            }
          }}
          disabled={!canSort}
        >
          <ArrowUpIcon
            className="size-3.5!"
          />
          <span className="grow">Asc</span>
          {isSorted === "asc" && (
            <CheckIcon
              className="text-primary size-4 opacity-100!"
            />
          )}
        </DropdownMenuItem>,
        <DropdownMenuItem
          key="sort-desc"
          onClick={() => {
            if (isSorted === "desc") {
              column.clearSorting()
            } else {
              column.toggleSorting(true)
            }
          }}
          disabled={!canSort}
        >
          <ArrowDownIcon
            className="size-3.5!"
          />
          <span className="grow">Desc</span>
          {isSorted === "desc" && (
            <CheckIcon
              className="text-primary size-4 opacity-100!"
            />
          )}
        </DropdownMenuItem>
      )
      hasPreviousSection = true
    }

    // Pin section
    if (props.tableLayout?.columnsPinnable && canPin) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-pin" />)
      }
      items.push(
        <DropdownMenuItem
          key="pin-left"
          onClick={() => column.pin(isPinned === "left" ? false : "left")}
        >
          <ArrowLeftToLineIcon
            className="size-3.5!"
            aria-hidden="true"
          />
          <span className="grow">Pin to left</span>
          {isPinned === "left" && (
            <CheckIcon
              className="text-primary size-4 opacity-100!"
            />
          )}
        </DropdownMenuItem>,
        <DropdownMenuItem
          key="pin-right"
          onClick={() => column.pin(isPinned === "right" ? false : "right")}
        >
          <ArrowRightToLineIcon
            className="size-3.5!"
            aria-hidden="true"
          />
          <span className="grow">Pin to right</span>
          {isPinned === "right" && (
            <CheckIcon
              className="text-primary size-4 opacity-100!"
            />
          )}
        </DropdownMenuItem>
      )
      hasPreviousSection = true
    }

    // Move section
    if (props.tableLayout?.columnsMovable) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-move" />)
      }
      items.push(
        <DropdownMenuItem
          key="move-left"
          onClick={() => {
            if (columnIndex > 0) {
              const newOrder = [...columnOrder]
              const [movedColumn] = newOrder.splice(columnIndex, 1)
              newOrder.splice(columnIndex - 1, 0, movedColumn)
              table.setColumnOrder(newOrder)
            }
          }}
          disabled={!canMoveLeft || isPinned !== false}
        >
          <ArrowLeftIcon
            className="size-3.5!"
            aria-hidden="true"
          />
          <span>Move to Left</span>
        </DropdownMenuItem>,
        <DropdownMenuItem
          key="move-right"
          onClick={() => {
            if (columnIndex < columnOrder.length - 1) {
              const newOrder = [...columnOrder]
              const [movedColumn] = newOrder.splice(columnIndex, 1)
              newOrder.splice(columnIndex + 1, 0, movedColumn)
              table.setColumnOrder(newOrder)
            }
          }}
          disabled={!canMoveRight || isPinned !== false}
        >
          <ArrowRightIcon
            className="size-3.5!"
            aria-hidden="true"
          />
          <span>Move to Right</span>
        </DropdownMenuItem>
      )
      hasPreviousSection = true
    }

    // Visibility section
    if (props.tableLayout?.columnsVisibility && visibility) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-visibility" />)
      }
      items.push(
        <DropdownMenuSub key="visibility">
          <DropdownMenuSubTrigger>
            <Settings2Icon
              className="size-3.5!"
            />
            <span>Columns</span>
          </DropdownMenuSubTrigger>
          {/* SOLVRO PATCH — dropped `side="right"`: this repo's
              ui/dropdown-menu.tsx (pre-existing, out of this task's scope)
              types DropdownMenuSubContent's props off Base UI's Popup, which
              has no `side` prop (unlike upstream's Positioner-forwarding
              version) — same signature reui/filters.tsx's own
              DropdownMenuSubContent usage already lives with. */}
          <DropdownMenuSubContent>
            {table
              .getAllColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(value) => col.toggleVisibility(!!value)}
                  className="capitalize"
                >
                  {getColumnHeaderLabel(col)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }

    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filter,
    canSort,
    isSorted,
    column,
    props.tableLayout?.columnsPinnable,
    props.tableLayout?.columnsMovable,
    props.tableLayout?.columnsVisibility,
    canPin,
    isPinned,
    canMoveLeft,
    canMoveRight,
    visibility,
    table,
    columnIndex,
    columnOrder,
    columnVisibilityKey, // Needed to update checkbox states when visibility changes
  ])

  if (hasControls) {
    // SOLVRO PATCH note — KNOWN GAP: this branch ignores the `alignEnd`
    // right-align convention (see `alignEnd` above). Unreachable today
    // (no page enables column filters/move/visibility/pin), but the first
    // column that pairs `hasControls` with meta.headerClassName
    // "text-right" needs this branch taught the same trick.
    return (
      <div className="-ms-2 flex h-full items-center justify-between gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className={headerButtonClassName}
                disabled={isLoading}
              >
                {icon && icon}
                {resolvedTitle}
                {sortIcon}
              </Button>
            }
          />
          <DropdownMenuContent className="w-40" align="start">
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
        {props.tableLayout?.columnsPinnable && canPin && isPinned && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-lg -me-1 size-7"
            onClick={() => column.pin(false)}
            aria-label={`Unpin ${resolvedTitle} column`}
            title={`Unpin ${resolvedTitle} column`}
          >
            <PinOffIcon
              className="size-3.5! opacity-50!"
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
    )
  }

  if (canSort || (props.tableLayout?.columnsResizable && canResize)) {
    // SOLVRO PATCH — see `alignEnd` above. This wrapper is `flex` (a
    // block-level box that fills the `<th>`), not `inline-flex` like the
    // plain-label path below — so unlike that path, its single-child
    // layout is governed by `justify-content`, and the `<th>`'s own
    // `text-align: right` (from `meta.headerClassName`) has no effect on
    // it at all. `justify-end` reproduces the intent explicitly; `-me-2`
    // (was unconditionally `-ms-2`) mirrors the Button's own negative
    // margin to the trailing edge so it hugs the `<th>`'s right edge
    // instead of fighting it from the left.
    return (
      <div className={cn("flex h-full items-center", alignEnd ? "-me-2 justify-end" : "-ms-2")}>
        <Button
          variant="ghost"
          className={headerButtonClassName}
          disabled={isLoading}
          onClick={handleSort}
        >
          {icon && icon}
          {resolvedTitle}
          {sortIcon}
        </Button>
      </div>
    )
  }

  return (
    <div className={headerLabelClassName}>
      {icon && icon}
      {resolvedTitle}
    </div>
  )
}

const DataGridColumnHeader = memo(
  DataGridColumnHeaderInner
) as typeof DataGridColumnHeaderInner

export { DataGridColumnHeader, type DataGridColumnHeaderProps }
