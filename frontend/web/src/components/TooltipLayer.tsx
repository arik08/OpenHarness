import { useEffect, useLayoutEffect, useRef, useState } from "react";

const gap = 8;
const edgePadding = 8;
const showDelayMs = 260;

type TooltipState = {
  text: string;
  target: HTMLElement;
  x: number;
  y: number;
  placement: "top" | "bottom" | "right";
};

function findTooltipTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }
  const tooltipTarget = target.closest<HTMLElement>("[data-tooltip]");
  const text = tooltipTarget?.dataset.tooltip?.trim();
  if (!tooltipTarget || !text || tooltipTarget.getAttribute("aria-disabled") === "true") {
    return null;
  }
  return tooltipTarget;
}

function getTooltipState(target: HTMLElement): TooltipState | null {
  const text = target.dataset.tooltip?.trim();
  if (!text) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  if (target.dataset.tooltipPlacement === "right") {
    return {
      text,
      target,
      x: rect.right + gap,
      y: rect.top + rect.height / 2,
      placement: "right",
    };
  }
  const yBelow = rect.bottom + gap;
  const yAbove = rect.top - gap;
  const placement = yBelow + 36 <= window.innerHeight ? "bottom" : "top";
  return {
    text,
    target,
    x: rect.left + rect.width / 2,
    y: placement === "bottom" ? yBelow : yAbove,
    placement,
  };
}

export function TooltipLayer() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function clearShowTimer() {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    }

    function showForTarget(target: HTMLElement | null, immediate = false) {
      clearShowTimer();
      targetRef.current = target;
      if (!target) {
        setTooltip(null);
        return;
      }
      if (immediate) {
        setTooltip(getTooltipState(target));
        return;
      }
      setTooltip(null);
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        if (targetRef.current === target) {
          setTooltip(getTooltipState(target));
        }
      }, showDelayMs);
    }

    function hideTooltip() {
      clearShowTimer();
      targetRef.current = null;
      setTooltip(null);
    }

    function refreshTooltip() {
      const target = targetRef.current;
      if (!target?.isConnected) {
        hideTooltip();
        return;
      }
      setTooltip(getTooltipState(target));
    }

    function handlePointerOver(event: PointerEvent) {
      showForTarget(findTooltipTarget(event.target));
    }

    function handlePointerOut(event: PointerEvent) {
      const target = targetRef.current;
      if (!target) {
        return;
      }
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!related || !target.contains(related)) {
        hideTooltip();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      showForTarget(findTooltipTarget(event.target), true);
    }

    function handleFocusOut(event: FocusEvent) {
      const target = targetRef.current;
      if (!target) {
        return;
      }
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!related || !target.contains(related)) {
        hideTooltip();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        hideTooltip();
      }
    }

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", refreshTooltip);
    window.addEventListener("scroll", refreshTooltip, true);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", refreshTooltip);
      window.removeEventListener("scroll", refreshTooltip, true);
      clearShowTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) {
      return;
    }
    const rect = tooltipRef.current.getBoundingClientRect();
    const nextX = tooltip.placement === "right"
      ? Math.min(Math.max(tooltip.x, edgePadding), window.innerWidth - edgePadding - rect.width)
      : Math.min(
        Math.max(tooltip.x, edgePadding + rect.width / 2),
        window.innerWidth - edgePadding - rect.width / 2,
      );
    const nextY = tooltip.placement === "right"
      ? Math.min(
        Math.max(tooltip.y, edgePadding + rect.height / 2),
        window.innerHeight - edgePadding - rect.height / 2,
      )
      : tooltip.placement === "top"
        ? Math.max(edgePadding, tooltip.y - rect.height)
        : Math.min(tooltip.y, window.innerHeight - edgePadding - rect.height);
    if (Math.abs(nextX - tooltip.x) > 0.5 || Math.abs(nextY - tooltip.y) > 0.5) {
      setTooltip({ ...tooltip, x: nextX, y: nextY });
    }
  }, [tooltip]);

  if (!tooltip) {
    return null;
  }

  return (
    <div
      ref={tooltipRef}
      className="tooltip-layer"
      role="tooltip"
      style={{
        left: tooltip.x,
        position: "fixed",
        top: tooltip.y,
        transform: tooltip.placement === "right"
          ? "translate(0, -50%)"
          : tooltip.placement === "top"
            ? "translateX(-50%)"
            : "translate(-50%, 0)",
      }}
    >
      {tooltip.text}
    </div>
  );
}
