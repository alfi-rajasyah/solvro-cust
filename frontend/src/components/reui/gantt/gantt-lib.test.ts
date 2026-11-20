import { describe, expect, it } from "vitest"
import { nameColumnWidthCss, treeShrinkPx } from "./gantt-lib"

describe("treeShrinkPx", () => {
  it("is how far the rendered pane sits below the configured width", () => {
    expect(treeShrinkPx(498, 400)).toBe(98)
  })
  it("is zero at the configured width and negative when dragged wider", () => {
    expect(treeShrinkPx(400, 400)).toBe(0)
    expect(treeShrinkPx(400, 450)).toBe(-50)
  })
})

describe("nameColumnWidthCss", () => {
  it("subtracts the live shrink from the configured name width, floored", () => {
    expect(nameColumnWidthCss(242, 100)).toBe(
      "max(100px, calc(242px - var(--gantt-tree-shrink, 0px)))"
    )
  })
})
