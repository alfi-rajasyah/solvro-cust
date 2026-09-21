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

import type { ReactElement } from "react"
import { getColumnHeaderLabel } from "@/components/reui/data-grid/data-grid"
import type { Table } from "@tanstack/react-table"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function DataGridColumnVisibility<TData>({
  table,
  trigger,
}: {
  table: Table<TData>
  trigger: ReactElement<Record<string, unknown>>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="min-w-[150px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-medium">
            Toggle Columns
          </DropdownMenuLabel>
          {table
            .getAllColumns()
            .filter((column) => column.getCanHide())
            .map((column) => {
              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {getColumnHeaderLabel(column)}
                </DropdownMenuCheckboxItem>
              )
            })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { DataGridColumnVisibility }
