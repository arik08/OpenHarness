import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipLayer } from "../TooltipLayer";

describe("TooltipLayer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders data-tooltip text in a fixed overlay instead of inside the button", () => {
    vi.useFakeTimers();
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
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(260);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("미리보기 확대");
    expect(tooltip.parentElement).not.toBe(button);
    expect(tooltip.className).toBe("tooltip-layer");
    expect(tooltip.style.position).toBe("fixed");
  });

  it("places right-positioned tooltips beside the target", () => {
    vi.useFakeTimers();
    render(
      <div>
        <button
          type="button"
          data-tooltip="프로젝트 폴더 선택"
          data-tooltip-placement="right"
          ref={(node) => {
            if (!node) {
              return;
            }
            node.getBoundingClientRect = () => ({
              bottom: 126,
              height: 52,
              left: 10,
              right: 314,
              top: 74,
              width: 304,
              x: 10,
              y: 74,
              toJSON: () => ({}),
            });
          }}
        >
          Default
        </button>
        <TooltipLayer />
      </div>,
    );

    fireEvent.pointerOver(screen.getByRole("button", { name: "Default" }));
    act(() => {
      vi.advanceTimersByTime(260);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("프로젝트 폴더 선택");
    expect(tooltip.style.left).toBe("322px");
    expect(tooltip.style.top).toBe("100px");
    expect(tooltip.style.transform).toBe("translate(0, -50%)");
  });

  it("shows focus tooltips immediately", () => {
    render(
      <div>
        <button type="button" data-tooltip="전체 설명">
          Help
        </button>
        <TooltipLayer />
      </div>,
    );

    fireEvent.focusIn(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("tooltip").textContent).toBe("전체 설명");
  });
});
