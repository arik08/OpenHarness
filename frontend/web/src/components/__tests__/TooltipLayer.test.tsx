import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipLayer } from "../TooltipLayer";

describe("TooltipLayer", () => {
  it("renders data-tooltip text in a fixed overlay instead of inside the button", () => {
    render(
      <div>
        <button
          type="button"
          data-tooltip="미리보기 확대"
          ref={(node) => {
            if (!node) {
              return;
            }
            node.getBoundingClientRect = () => ({
              bottom: 46,
              height: 34,
              left: 894,
              right: 928,
              top: 12,
              width: 34,
              x: 894,
              y: 12,
              toJSON: () => ({}),
            });
          }}
        >
          expand
        </button>
        <TooltipLayer />
      </div>,
    );

    const button = screen.getByRole("button", { name: "expand" });
    fireEvent.pointerOver(button);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("미리보기 확대");
    expect(tooltip.parentElement).not.toBe(button);
    expect(tooltip.className).toBe("tooltip-layer");
    expect(tooltip.style.position).toBe("fixed");
  });
});
