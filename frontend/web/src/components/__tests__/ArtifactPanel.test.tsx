import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactPanel, clampArtifactPanelWidth } from "../ArtifactPanel";
import { AppStateProvider, useAppState } from "../../state/app-state";
import { initialAppState } from "../../state/reducer";
import { deleteArtifact, listProjectFiles, organizeProjectFiles, readArtifact } from "../../api/artifacts";

vi.mock("../../api/artifacts", () => ({
  deleteArtifact: vi.fn(async () => ({ deleted: true })),
  listProjectFiles: vi.fn(async () => ({ scope: "default", files: [] })),
  organizeProjectFiles: vi.fn(async () => ({ files: [] })),
  readArtifact: vi.fn(async () => ({ kind: "html", content: "<html><body>Preview</body></html>" })),
}));

describe("ArtifactPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(deleteArtifact).mockResolvedValue({ deleted: true });
    vi.mocked(listProjectFiles).mockResolvedValue({ scope: "default", files: [] });
    vi.mocked(organizeProjectFiles).mockResolvedValue({ files: [] });
    localStorage.removeItem("myharness:projectFileFilter");
    history.replaceState(null, "", window.location.href);
  });

  it("can open from the closed initial state without changing hook order", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function OpenPanel() {
      const { dispatch } = useAppState();
      useEffect(() => {
        dispatch({ type: "open_artifact_list" });
      }, [dispatch]);
      return <ArtifactPanel />;
    }

    render(
      <AppStateProvider initialState={{ ...initialAppState, artifactPanelOpen: false }}>
        <OpenPanel />
      </AppStateProvider>,
    );

    await screen.findByText("표시할 프로젝트 파일이 아직 없습니다.");
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("loads the default project file scope when the panel opens", async () => {
    function OpenPanel() {
      const { dispatch } = useAppState();
      useEffect(() => {
        dispatch({ type: "open_artifact_list" });
      }, [dispatch]);
      return <ArtifactPanel />;
    }

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: false,
          clientId: "client-a",
          sessionId: "session-a",
          workspacePath: "C:/repo",
        }}
      >
        <OpenPanel />
      </AppStateProvider>,
    );

    await waitFor(() => expect(listProjectFiles).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-a",
      scope: "default",
      sessionId: "session-a",
      workspacePath: "C:/repo",
    })));
  });

  it("uses browser history for list, detail, and closing the panel", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByText("report.html");
    expect(history.state).toMatchObject({ myharnessArtifactPanel: true, view: "list" });

    await userEvent.click(screen.getByRole("button", { name: "report.html 열기" }));
    await screen.findByTitle("report.html");
    expect(history.state).toMatchObject({ myharnessArtifactPanel: true, view: "detail", path: "outputs/report.html" });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: { myharnessArtifactPanel: true, view: "list" },
      }));
    });
    await screen.findByText("report.html");
    expect(screen.queryByTitle("report.html")).toBeNull();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    await waitFor(() => expect(screen.queryByText("report.html")).toBeNull());
  });

  it("treats fullscreen preview as its own back-navigation step", async () => {
    vi.mocked(listProjectFiles).mockResolvedValue({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "report.html 열기" }));
    await screen.findByTitle("report.html");

    await userEvent.click(screen.getByRole("button", { name: "미리보기 확대" }));
    await waitFor(() => expect(history.state).toMatchObject({
      myharnessArtifactPanel: true,
      view: "fullscreen",
      path: "outputs/report.html",
    }));
    expect(document.querySelector(".artifact-panel")?.classList.contains("fullscreen")).toBe(true);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: {
          myharnessArtifactPanel: true,
          view: "detail",
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
        },
      }));
    });

    await screen.findByTitle("report.html");
    await waitFor(() => expect(document.querySelector(".artifact-panel")?.classList.contains("fullscreen")).toBe(false));
    expect(screen.queryByRole("button", { name: "report.html 열기" })).toBeNull();
  });

  it("uses the close button as detail-to-list, then list-to-closed", async () => {
    const backSpy = vi.spyOn(history, "back");
    vi.mocked(listProjectFiles).mockResolvedValue({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "report.html 열기" }));
    await screen.findByTitle("report.html");

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await screen.findByRole("button", { name: "report.html 열기" });
    expect(screen.queryByTitle("report.html")).toBeNull();
    expect(backSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "report.html 열기" })).toBeNull());
    expect(history.state).toBeNull();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it("does not reopen a previous artifact when closing from the list", async () => {
    vi.mocked(listProjectFiles).mockResolvedValue({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });
    history.replaceState({
      myharnessArtifactPanel: true,
      view: "detail",
      path: "outputs/previous.html",
      name: "previous.html",
      kind: "html",
    }, "", window.location.href);

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          activeArtifact: null,
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByRole("button", { name: "report.html 열기" });
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "report.html 열기" })).toBeNull());
    expect(readArtifact).not.toHaveBeenCalledWith(expect.objectContaining({ path: "outputs/previous.html" }));
    expect(history.state).toBeNull();
  });

  it("renders markdown artifacts by default and shows raw markdown only in source mode", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/report.md",
          name: "report.md",
          kind: "markdown",
          size: 42,
        },
      ],
    });
    vi.mocked(readArtifact).mockResolvedValueOnce({
      kind: "markdown",
      content: "# 분석 결과\n\n- 첫 항목\n- 둘째 항목",
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/report.md",
              name: "report.md",
              kind: "markdown",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "report.md 열기" }));

    expect(await screen.findByRole("heading", { name: "분석 결과" })).toBeTruthy();
    expect(screen.queryByLabelText("report.md 원문")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "원문보기" }));

    const source = await screen.findByLabelText("report.md 원문");
    expect(source).toBeInstanceOf(HTMLTextAreaElement);
    expect((source as HTMLTextAreaElement).value).toContain("# 분석 결과");
  });

  it("highlights HTML source mode and omits the redundant back action", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });
    vi.mocked(readArtifact).mockResolvedValueOnce({
      kind: "html",
      assetBaseUrl: "/api/artifact/asset/outputs/",
      content: "<!doctype html>\n<html><body><h1>Hello</h1></body></html>",
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "report.html 열기" }));
    const frame = await screen.findByTitle("report.html");
    expect(frame.classList.contains("artifact-html-frame")).toBe(true);
    expect(frame.getAttribute("srcdoc")).toContain('<base href="/api/artifact/asset/outputs/">');
    expect(screen.queryByRole("button", { name: "목록으로" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "원문보기" }));

    expect(screen.queryByLabelText("report.html 원문")).toBeNull();
    const code = document.querySelector(".artifact-source code.language-html");
    expect(code?.classList.contains("hljs")).toBe(true);
    expect(code?.querySelector(".hljs-tag")?.textContent).toContain("<html>");
    expect(code?.textContent).toContain("<!doctype html>");
    expect(code?.textContent).toContain("<h1>Hello</h1>");
  });

  it("selects the highlighted artifact source instead of the whole page on Ctrl+A", async () => {
    const source = "<!doctype html>\n<html><body><h1>Hello</h1></body></html>";
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });
    vi.mocked(readArtifact).mockResolvedValueOnce({
      kind: "html",
      content: source,
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <p>페이지의 다른 텍스트</p>
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "report.html 열기" }));
    await screen.findByTitle("report.html");
    await userEvent.click(screen.getByRole("button", { name: "원문보기" }));

    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe(source);
  });

  it("highlights Python project files in the preview", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/example.py",
          name: "example.py",
          kind: "text",
          size: 42,
        },
      ],
    });
    vi.mocked(readArtifact).mockResolvedValueOnce({
      kind: "text",
      content: "def greet(name: str) -> str:\n    return f\"Hello, {name}\"\n",
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/example.py",
              name: "example.py",
              kind: "text",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "example.py 열기" }));

    expect(screen.queryByLabelText("example.py 내용")).toBeNull();
    const code = document.querySelector(".artifact-source code.language-python");
    expect(code?.classList.contains("hljs")).toBe(true);
    expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("def");
    expect(code?.textContent).toContain("return");
  });

  it("shows a visible download button for unsupported document previews", () => {
    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          clientId: "client-a",
          sessionId: "session-a",
          workspacePath: "C:/repo",
          workspaceName: "repo",
          activeArtifact: {
            path: "outputs/namuwiki-history-report.pptx",
            name: "namuwiki-history-report.pptx",
            kind: "file",
            label: "PPTX",
            size: 42,
          },
          activeArtifactPayload: { kind: "file" },
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    expect(screen.getByText("이 파일 형식은 미리보기 대신 다운로드로 열 수 있습니다.")).toBeTruthy();
    const download = screen.getByRole("link", { name: "namuwiki-history-report.pptx 다운로드" });
    expect(download).toBeTruthy();
    expect(download.getAttribute("download")).toBe("namuwiki-history-report.pptx");
    expect(decodeURIComponent(download.getAttribute("href") || "")).toContain("path=outputs/namuwiki-history-report.pptx");
  });

  it("requires a second click before deleting a project file from the list", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/report.html",
          name: "report.html",
          kind: "html",
          size: 42,
        },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          clientId: "client-a",
          sessionId: "session-a",
          workspacePath: "C:/repo",
          workspaceName: "repo",
          artifacts: [
            {
              path: "outputs/report.html",
              name: "report.html",
              kind: "html",
              size: 42,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByText("report.html");
    const actions = document.querySelector(".project-file-actions");
    expect(actions?.children[0]?.getAttribute("aria-label")).toBe("report.html 삭제");
    expect(actions?.children[1]?.textContent).toBe("42 B");
    expect(actions?.children[2]?.getAttribute("aria-label")).toBe("report.html 다운로드");

    await userEvent.click(screen.getByRole("button", { name: "report.html 삭제" }));
    expect(deleteArtifact).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "report.html 삭제 확인" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "report.html 삭제 확인" }));

    await waitFor(() => expect(deleteArtifact).toHaveBeenCalledWith({
      path: "outputs/report.html",
      sessionId: "session-a",
      clientId: "client-a",
      workspacePath: "C:/repo",
      workspaceName: "repo",
    }));
    await waitFor(() => expect(screen.queryByText("report.html")).toBeNull());
  });

  it("shows extension-specific colored badges for project files", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        { path: "outputs/report.html", name: "report.html", kind: "file", label: "HTML", size: 42 },
        { path: "outputs/notes.md", name: "notes.md", kind: "markdown", size: 30 },
        { path: "outputs/deck.pptx", name: "deck.pptx", kind: "file", label: "PPTX", size: 26 },
        { path: "outputs/data.csv", name: "data.csv", kind: "file", label: "CSV", size: 24 },
        { path: "outputs/script.py", name: "script.py", kind: "text", size: 18 },
        { path: "outputs/chart.png", name: "chart.png", kind: "image", size: 12 },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            { path: "outputs/report.html", name: "report.html", kind: "file", label: "HTML", size: 42 },
            { path: "outputs/notes.md", name: "notes.md", kind: "markdown", size: 30 },
            { path: "outputs/deck.pptx", name: "deck.pptx", kind: "file", label: "PPTX", size: 26 },
            { path: "outputs/data.csv", name: "data.csv", kind: "file", label: "CSV", size: 24 },
            { path: "outputs/script.py", name: "script.py", kind: "text", size: 18 },
            { path: "outputs/chart.png", name: "chart.png", kind: "image", size: 12 },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByText("report.html");
    const badgeByFileName = new Map(
      [...document.querySelectorAll(".project-file-item")].map((item) => [
        item.querySelector("strong")?.textContent,
        item.querySelector(".artifact-card-icon"),
      ]),
    );
    expect(badgeByFileName.get("report.html")?.textContent).toBe("HTML");
    expect(badgeByFileName.get("report.html")?.classList.contains("artifact-card-icon-web")).toBe(true);
    expect(badgeByFileName.get("notes.md")?.textContent).toBe("MD");
    expect(badgeByFileName.get("notes.md")?.classList.contains("artifact-card-icon-markdown")).toBe(true);
    expect(badgeByFileName.get("deck.pptx")?.textContent).toBe("PPTX");
    expect(badgeByFileName.get("deck.pptx")?.classList.contains("artifact-card-icon-docs")).toBe(true);
    expect(badgeByFileName.get("data.csv")?.textContent).toBe("CSV");
    expect(badgeByFileName.get("data.csv")?.classList.contains("artifact-card-icon-data")).toBe(true);
    expect(badgeByFileName.get("script.py")?.textContent).toBe("PY");
    expect(badgeByFileName.get("script.py")?.classList.contains("artifact-card-icon-code")).toBe(true);
    expect(badgeByFileName.get("chart.png")?.textContent).toBe("PNG");
    expect(badgeByFileName.get("chart.png")?.classList.contains("artifact-card-icon-image")).toBe(true);
  });

  it("separates markdown files from document files in the project file filter", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        { path: "outputs/summary.md", name: "summary.md", kind: "markdown", size: 42 },
        { path: "outputs/deck.pptx", name: "deck.pptx", kind: "file", label: "PPTX", size: 24 },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            { path: "outputs/summary.md", name: "summary.md", kind: "markdown", size: 42 },
            { path: "outputs/deck.pptx", name: "deck.pptx", kind: "file", label: "PPTX", size: 24 },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByText("summary.md");
    const filter = screen.getByLabelText("프로젝트 파일 유형 필터");
    const filterLabels = [...filter.querySelectorAll("option")].map((option) => option.textContent);
    expect(filterLabels).toContain("웹페이지");
    expect(filterLabels).toContain("마크다운");

    await userEvent.selectOptions(filter, "markdown");
    expect(screen.getByText("summary.md")).toBeTruthy();
    expect(screen.queryByText("deck.pptx")).toBeNull();

    await userEvent.selectOptions(filter, "docs");
    expect(screen.getByText("deck.pptx")).toBeTruthy();
    expect(screen.queryByText("summary.md")).toBeNull();
  });

  it("shows project file size without repeating the file type label", async () => {
    vi.mocked(listProjectFiles).mockResolvedValueOnce({
      scope: "default",
      files: [
        {
          path: "outputs/evangelion-story-analysis-report.html",
          name: "evangelion-story-analysis-report.html",
          kind: "html",
          size: 21504,
        },
      ],
    });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          artifacts: [
            {
              path: "outputs/evangelion-story-analysis-report.html",
              name: "evangelion-story-analysis-report.html",
              kind: "html",
              size: 21504,
            },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByText("evangelion-story-analysis-report.html");
    const item = document.querySelector(".project-file-item");
    expect(item?.querySelector(".artifact-card-icon")?.textContent).toBe("HTML");
    expect(item?.querySelector(".artifact-card-size")?.textContent).toBe("21.0 KB");
    expect(item?.querySelector(".artifact-card-copy")?.textContent).not.toContain("HTML");
    expect(item?.querySelector(".project-file-open")?.getAttribute("data-tooltip")).toBe("evangelion-story-analysis-report.html");
  });

  it("organizes root project files into outputs", async () => {
    vi.mocked(listProjectFiles)
      .mockResolvedValueOnce({
        scope: "default",
        files: [
          { path: "root-report.html", name: "root-report.html", kind: "html", size: 42 },
          { path: "outputs/kept.html", name: "kept.html", kind: "html", size: 24 },
        ],
      })
      .mockResolvedValueOnce({
        scope: "default",
        files: [
          { path: "outputs/root-report.html", name: "root-report.html", kind: "html", size: 42 },
          { path: "outputs/kept.html", name: "kept.html", kind: "html", size: 24 },
        ],
      });

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          clientId: "client-a",
          sessionId: "session-a",
          workspacePath: "C:/repo",
          workspaceName: "repo",
          artifacts: [
            { path: "root-report.html", name: "root-report.html", kind: "html", size: 42 },
            { path: "outputs/kept.html", name: "kept.html", kind: "html", size: 24 },
          ],
        }}
      >
        <ArtifactPanel />
      </AppStateProvider>,
    );

    await screen.findByText("root-report.html");
    await userEvent.click(screen.getByRole("button", { name: "정리" }));
    expect(await screen.findByRole("dialog", { name: "루트 산출물 정리" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "선택 파일 이동" }));

    await waitFor(() => expect(organizeProjectFiles).toHaveBeenCalledWith({
      paths: ["root-report.html"],
      sessionId: "session-a",
      clientId: "client-a",
      workspacePath: "C:/repo",
      workspaceName: "repo",
    }));
    await waitFor(() => expect(listProjectFiles).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "default" })));
  });

  it("stops resizing when a move event shows the mouse button is no longer pressed", async () => {
    function ResizeState() {
      const { state } = useAppState();
      return <output aria-label="resize state">{`${state.artifactResizing}:${state.artifactPanelWidth}`}</output>;
    }

    render(
      <AppStateProvider
        initialState={{
          ...initialAppState,
          artifactPanelOpen: true,
          activeArtifact: { path: "outputs/report.html", name: "report.html", kind: "html" },
          activeArtifactPayload: { kind: "html", content: "<html><body>Preview</body></html>" },
          artifactPanelWidth: 520,
        }}
      >
        <ArtifactPanel />
        <ResizeState />
      </AppStateProvider>,
    );

    const handle = screen.getByRole("button", { name: "패널 너비 조절" });
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 900, buttons: 1 });
    });
    expect(screen.getByLabelText("resize state").textContent).toBe("true:520");

    act(() => {
      const move = new MouseEvent("pointermove", { bubbles: true, clientX: 850 });
      Object.defineProperty(move, "buttons", { value: 0 });
      window.dispatchEvent(move);
    });

    expect(screen.getByLabelText("resize state").textContent).toBe("false:520");
  });

  it("keeps enough chat width visible when the artifact panel is resized wide", () => {
    expect(clampArtifactPanelWidth(1420, { windowWidth: 1200, sidebarCollapsed: false })).toBe(632);
  });
});
