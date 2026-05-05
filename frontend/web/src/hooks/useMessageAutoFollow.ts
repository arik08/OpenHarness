import { useEffect, useLayoutEffect, useRef } from "react";
import type { Dispatch } from "react";
import type { AppAction } from "../state/reducer";
import type { AppState, ChatMessage } from "../types/ui";

const nearBottomPx = 96;
const streamingRejoinBottomPx = 260;
const scrollStorageKey = "myharness:scrollPositions";
const maxStreamFollowLeadPx = 220;

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function readScrollPositions() {
  try {
    return JSON.parse(localStorage.getItem(scrollStorageKey) || sessionStorage.getItem(scrollStorageKey) || "{}") as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(sessionStorage.getItem(scrollStorageKey) || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function saveScrollPosition(sessionId: string | null | undefined, scrollTop: number) {
  if (!sessionId) {
    return;
  }
  const positions = readScrollPositions();
  positions[sessionId] = scrollTop;
  try {
    localStorage.setItem(scrollStorageKey, JSON.stringify(positions));
  } catch {
    // Embedded or private browsing contexts can block localStorage.
    try {
      sessionStorage.setItem(scrollStorageKey, JSON.stringify(positions));
    } catch {
      // Embedded or private browsing contexts can block all web storage.
    }
  }
}

function restoredScrollPosition(sessionId: string | null | undefined) {
  if (!sessionId) {
    return null;
  }
  const value = readScrollPositions()[sessionId];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function useMessageAutoFollow({
  state,
  dispatch,
  lastMessage,
  activeWorkflowFollowSignature,
}: {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  lastMessage?: ChatMessage;
  activeWorkflowFollowSignature: string;
}) {
  const messagesRef = useRef<HTMLElement | null>(null);
  const autoFollowRef = useRef(true);
  const animationFrameRef = useRef(0);
  const tailFollowActiveRef = useRef(false);
  const autoScrollUntilRef = useRef(0);
  const userScrollIntentUntilRef = useRef(0);
  const scrollSaveTimerRef = useRef(0);
  const isLastAssistantStreaming = state.busy && lastMessage?.role === "assistant" && !lastMessage.isComplete;
  const isActiveWorkflowGrowing = state.busy && Boolean(state.workflowAnchorMessageId && state.workflowEvents.length);
  const shouldFollowGrowingTail = isLastAssistantStreaming || isActiveWorkflowGrowing;
  const scrollSessionId = state.activeHistoryId || state.sessionId;
  const streamFollowLeadPx = Math.max(0, Math.min(maxStreamFollowLeadPx, state.appSettings.streamFollowLeadPx));

  function stopAutoFollow(container = messagesRef.current) {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
    tailFollowActiveRef.current = false;
    autoFollowRef.current = false;
    autoScrollUntilRef.current = 0;
    container?.classList.remove("streaming-follow");
  }

  function saveCurrentScrollPosition() {
    if (!state.restoringHistory) {
      saveScrollPosition(scrollSessionId, messagesRef.current?.scrollTop ?? 0);
    }
  }

  function scheduleScrollPositionSave() {
    window.clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = window.setTimeout(saveCurrentScrollPosition, 120);
  }

  function scrollMessagesToBottom(options: { smooth?: boolean; duration?: number; continuous?: boolean } = {}) {
    const container = messagesRef.current;
    if (!container) {
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const smooth = options.smooth && !reduceMotion;
    const continuous = Boolean(options.continuous);
    const duration = Math.max(0, Number(options.duration ?? state.appSettings.streamScrollDurationMs));

    if (!smooth || duration <= 0) {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = 0;
      }
      tailFollowActiveRef.current = false;
      container.scrollTop = container.scrollHeight;
      container.dataset.lastScrollTop = String(container.scrollTop);
      return;
    }

    if (continuous && tailFollowActiveRef.current && animationFrameRef.current) {
      autoScrollUntilRef.current = Date.now() + duration + 260;
      return;
    }

    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    tailFollowActiveRef.current = continuous;
    const start = container.scrollTop;
    const startedAt = performance.now();
    let previousFrameAt = startedAt;
    let bufferedTarget = continuous
      ? Math.max(start, container.scrollHeight - container.clientHeight)
      : start;
    let followVelocity = 0;
    autoScrollUntilRef.current = Date.now() + duration + 260;

    const step = (now: number) => {
      if (!messagesRef.current) {
        animationFrameRef.current = 0;
        return;
      }
      const liveContainer = messagesRef.current;
      if (continuous) {
        const rawTarget = Math.max(0, liveContainer.scrollHeight - liveContainer.clientHeight);
        const elapsed = Math.min(64, Math.max(0, now - previousFrameAt));
        previousFrameAt = now;
        const leadRatio = streamFollowLeadPx / maxStreamFollowLeadPx;
        const targetMs = Math.max(120, Math.min(460, duration * (0.2 - leadRatio * 0.06)));
        const targetBlend = elapsed > 0 ? 1 - Math.exp(-elapsed / targetMs) : 0;
        bufferedTarget += (Math.max(rawTarget, bufferedTarget, liveContainer.scrollTop) - bufferedTarget) * targetBlend;
        const dt = elapsed / 1000;
        const distance = bufferedTarget - liveContainer.scrollTop;
        const responseMs = Math.max(300, Math.min(900, duration * (0.3 - leadRatio * 0.08)));
        const omega = (1000 / responseMs) * 2.6;
        const acceleration = distance * omega * omega - followVelocity * 2 * omega;
        const maxAcceleration = Math.max(16000, Math.min(42000, liveContainer.clientHeight * (84 + leadRatio * 28)));
        const boundedAcceleration = Math.max(-maxAcceleration, Math.min(maxAcceleration, acceleration));
        followVelocity += boundedAcceleration * dt;
        const maxVelocity = Math.max(420, Math.min(4600, liveContainer.clientHeight * (4.6 + leadRatio * 1.1) + Math.abs(distance) * (4.8 + leadRatio)));
        followVelocity = Math.max(0, Math.min(maxVelocity, followVelocity));
        const nextTop = liveContainer.scrollTop + followVelocity * dt;
        liveContainer.scrollTop = Math.max(liveContainer.scrollTop, Math.min(rawTarget, nextTop));
        liveContainer.dataset.lastScrollTop = String(liveContainer.scrollTop);
        if (autoFollowRef.current && tailFollowActiveRef.current) {
          animationFrameRef.current = window.requestAnimationFrame(step);
        } else {
          tailFollowActiveRef.current = false;
          animationFrameRef.current = 0;
        }
        return;
      }

      const target = Math.max(0, liveContainer.scrollHeight - liveContainer.clientHeight);
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeInOutCubic(progress);
      liveContainer.scrollTop = start + (target - start) * eased;
      if (progress < 1 && autoFollowRef.current) {
        animationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        tailFollowActiveRef.current = false;
        animationFrameRef.current = 0;
        liveContainer.dataset.lastScrollTop = String(liveContainer.scrollTop);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(step);
  }

  function resumeAutoFollow(container = messagesRef.current) {
    autoFollowRef.current = true;
    if (!container || !shouldFollowGrowingTail) {
      return;
    }
    container.classList.add("streaming-follow");
    scrollMessagesToBottom({ smooth: true, duration: state.appSettings.streamScrollDurationMs, continuous: shouldFollowGrowingTail });
  }

  function updateAutoFollowFromScroll(container = messagesRef.current) {
    if (!container) {
      return;
    }
    const currentTop = container.scrollTop;
    const previousTop = Number(container.dataset.lastScrollTop);
    const movedUp = Number.isFinite(previousTop) && currentTop < previousTop - 2;
    const userScrolling = Date.now() <= userScrollIntentUntilRef.current;
    const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
    const threshold = shouldFollowGrowingTail ? Math.max(nearBottomPx, streamingRejoinBottomPx) : nearBottomPx;
    if (movedUp) {
      stopAutoFollow(container);
    } else if (remaining <= threshold) {
      resumeAutoFollow(container);
    } else if (userScrolling) {
      stopAutoFollow(container);
    } else if (Date.now() < autoScrollUntilRef.current) {
      autoFollowRef.current = true;
    } else {
      autoFollowRef.current = false;
    }
    container.dataset.lastScrollTop = String(currentTop);
  }

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !autoFollowRef.current || state.restoringHistory) {
      return;
    }
    container.style.setProperty("--stream-follow-lead", `${streamFollowLeadPx}px`);
    container.classList.toggle("streaming-follow", Boolean(shouldFollowGrowingTail));
    scrollMessagesToBottom({
      smooth: true,
      duration: state.appSettings.streamScrollDurationMs,
      continuous: shouldFollowGrowingTail,
    });
  }, [state.messages.length, lastMessage?.text, lastMessage?.isComplete, activeWorkflowFollowSignature, state.appSettings.streamScrollDurationMs, streamFollowLeadPx, isLastAssistantStreaming, shouldFollowGrowingTail, state.restoringHistory]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container || !state.restoringHistory || !state.activeHistoryId) {
      return;
    }
    stopAutoFollow(container);
    const savedPosition = restoredScrollPosition(state.activeHistoryId);
    container.scrollTop = savedPosition ?? 0;
    container.dataset.lastScrollTop = String(container.scrollTop);
    requestAnimationFrame(() => {
      dispatch({ type: "finish_history_restore" });
    });
  }, [dispatch, state.activeHistoryId, state.messages.length, state.restoringHistory]);

  useEffect(() => {
    function handleSaveMessageScroll() {
      saveCurrentScrollPosition();
    }
    window.addEventListener("myharness:saveMessageScroll", handleSaveMessageScroll);
    return () => window.removeEventListener("myharness:saveMessageScroll", handleSaveMessageScroll);
  });

  useEffect(() => () => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    window.clearTimeout(scrollSaveTimerRef.current);
  }, []);

  return {
    messagesRef,
    autoFollowRef,
    isLastAssistantStreaming,
    shouldFollowGrowingTail,
    handleScroll(container: HTMLElement) {
      updateAutoFollowFromScroll(container);
      scheduleScrollPositionSave();
    },
    handleWheel(container: HTMLElement, deltaY: number) {
      userScrollIntentUntilRef.current = Date.now() + 900;
      if (deltaY < 0) {
        stopAutoFollow(container);
      }
    },
    handlePointerIntent() {
      userScrollIntentUntilRef.current = Date.now() + 900;
    },
    handleVisibleTextChange() {
      if (!autoFollowRef.current || state.restoringHistory) {
        return;
      }
      scrollMessagesToBottom({
        smooth: true,
        duration: state.appSettings.streamScrollDurationMs,
        continuous: true,
      });
    },
    handleVisibleWorkflowProgressChange() {
      if (!autoFollowRef.current || state.restoringHistory || !shouldFollowGrowingTail) {
        return;
      }
      scrollMessagesToBottom({
        smooth: true,
        duration: state.appSettings.streamScrollDurationMs,
        continuous: true,
      });
    },
  };
}
