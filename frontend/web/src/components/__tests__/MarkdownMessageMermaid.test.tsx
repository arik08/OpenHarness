import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactPreview } from "../ArtifactPreview";
import { MarkdownMessage } from "../MarkdownMessage";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, source: string) => ({
      svg: `<svg data-render-id="${id}" role="img"><text>${source.includes("Ready") ? "Ready" : "chart"}</text></svg>`,
    })),
  },
}));

describe("MarkdownMessage Mermaid rendering", () => {
  it("renders mermaid code fences as charts in chat markdown", async () => {
    render(
      <MarkdownMessage
        text={[
          "흐름은 다음과 같습니다.",
          "",
          "```mermaid",
          "flowchart LR",
          "  Start --> Ready",
          "```",
        ].join("\n")}
      />,
    );

    await waitFor(() => expect(document.querySelector(".mermaid-chart svg")).toBeTruthy());
    expect(document.querySelector(".markdown-body pre")).toBeNull();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("renders mermaid code fences inside markdown artifact previews", async () => {
    render(
      <ArtifactPreview
        artifact={{ path: "outputs/flow.md", name: "flow.md", kind: "markdown", size: 64 }}
        payload={{
          kind: "markdown",
          content: [
            "# 처리 흐름",
            "",
            "```mermaid",
            "sequenceDiagram",
            "  Agent->>User: Ready",
            "```",
          ].join("\n"),
        }}
        draftContent=""
        sourceMode={false}
        downloadUrl="/api/artifact/download?path=outputs%2Fflow.md"
        onDraftContentChange={() => {}}
      />,
    );

    await waitFor(() => expect(document.querySelector(".artifact-markdown .mermaid-chart svg")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "처리 흐름" })).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });
});
