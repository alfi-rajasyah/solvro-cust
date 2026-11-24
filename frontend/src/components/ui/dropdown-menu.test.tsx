// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

function renderOpenSubmenu(positionerClassName?: string) {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub defaultOpen>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent positionerClassName={positionerClassName}>
            <DropdownMenuItem>Inner</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const popup = document.querySelector('[data-slot="dropdown-menu-sub-content"]');
  expect(popup).not.toBeNull();
  return popup!.parentElement!;
}

describe("DropdownMenuSubContent positionerClassName", () => {
  it("puts the class on the submenu's Positioner, so it can outrank a modal host", () => {
    expect(renderOpenSubmenu("z-[60]").className).toContain("z-[60]");
  });

  it("leaves the Positioner without a class when unset", () => {
    expect(renderOpenSubmenu().className).toBe("");
  });
});
