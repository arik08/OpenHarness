import { Fragment, useEffect, useMemo, useState } from "react";
import { readArtifact, resolveArtifact } from "../api/artifacts";
import { useAppState } from "../state/app-state";
import type { ArtifactSummary } from "../types/backend";
import type { AppSettings, ChatMessage } from "../types/ui";
import {
  artifactIcon,
  artifactLabelForPath,
  collectArtifactCandidates,
  collectArtifactReferences,
  dedupeArtifactsByResolvedPath,
  formatBytes,
  labelForArtifact,
  normalizeArtifactPath,
} from "../utils/artifacts";
import { MarkdownMessage } from "./MarkdownMessage";
import { StreamingAssistantMessage } from "./StreamingAssistantMessage";

type ResolvedArtifact = ArtifactSummary & {
  sourcePath: string;
};

function artifactKey(path: string) {
  return normalizeArtifactPath(path).toLowerCase();
}

function useMessageArtifacts(message: ChatMessage) {
  const { state, dispatch } = useAppState();
  const [artifacts, setArtifacts] = useState<ResolvedArtifact[]>([]);
  const [loadingPath, setLoadingPath] = useState("");
  const candidateSignature = useMemo(
    () => collectArtifactCandidates(message.isComplete ? message.text : "").map((artifact) => artifact.path).join("\n"),
    [message.isComplete, message.text],
  );

  useEffect(() => {
    let canceled = false;
    const candidates = collectArtifactCandidates(message.isComplete ? message.text : "");
    if (!candidates.length || (!state.sessionId && !state.workspacePath && !state.workspaceName)) {
      setArtifacts((current) => (current.length ? [] : current));
      return () => {
        canceled = true;
      };
    }

    async function resolveCandidates() {
      const resolved = await Promise.all(
        candidates.map(async (artifact) => {
          try {
            const payload = await resolveArtifact({
              sessionId: state.sessionId || undefined,
              clientId: state.clientId,
              workspacePath: state.workspacePath,
              workspaceName: state.workspaceName,
              path: artifact.path,
            });
            return {
              ...artifact,
              ...payload,
              sourcePath: artifact.path,
              path: payload.path || artifact.path,
              name: payload.name || artifact.name,
              kind: payload.kind || artifact.kind,
              label: payload.label || artifactLabelForPath(payload.path || artifact.path, payload.kind || artifact.kind),
            };
          } catch {
            return null;
          }
        }),
      );
      if (canceled) {
        return;
      }
      const nextArtifacts = resolved.filter(Boolean) as ResolvedArtifact[];
      setArtifacts(nextArtifacts);
      if (nextArtifacts.length) {
        dispatch({ type: "set_artifacts", artifacts: dedupeArtifactsByResolvedPath(nextArtifacts) });
      }
    }

    void resolveCandidates();
    return () => {
      canceled = true;
    };
  }, [candidateSignature, dispatch, message.isComplete, message.text, state.clientId, state.sessionId, state.workspaceName, state.workspacePath]);

  async function openArtifact(artifact: ArtifactSummary) {
    dispatch({ type: "open_artifact", artifact });
    setLoadingPath(artifact.path);
    try {
      const payload = await readArtifact({
        sessionId: state.sessionId || undefined,
        clientId: state.clientId,
        workspacePath: state.workspacePath,
        workspaceName: state.workspaceName,
        path: artifact.path,
      });
      dispatch({ type: "set_artifact_payload", payload });
    } catch (error) {
      dispatch({
        type: "open_modal",
        modal: { kind: "error", message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setLoadingPath("");
    }
  }

  const artifactBySourcePath = useMemo(() => {
    const map = new Map<string, ResolvedArtifact>();
    for (const artifact of artifacts) {
      map.set(artifactKey(artifact.sourcePath), artifact);
    }
    return map;
  }, [artifacts]);

  return {
    artifactBySourcePath,
    artifacts: dedupeArtifactsByResolvedPath(artifacts),
    loadingPath,
    openArtifact,
  };
}

function ArtifactCard({
  artifact,
  loadingPath,
  onOpen,
}: {
  artifact: ArtifactSummary;
  loadingPath: string;
  onOpen: (artifact: ArtifactSummary) => void;
}) {
  return (
    <button
      className="artifact-card"
      type="button"
      aria-label={`${artifact.name || artifact.path} 미리보기 열기`}
      data-artifact-path={artifact.path}
      onClick={() => onOpen(artifact)}
    >
      <span className="artifact-card-icon" aria-hidden="true">{artifactIcon(artifact.kind)}</span>
      <span className="artifact-card-copy">
        <strong>{artifact.name || artifact.path}</strong>
        <small>{loadingPath === artifact.path ? "불러오는 중" : [labelForArtifact(artifact), formatBytes(artifact.size)].filter(Boolean).join(" · ")}</small>
      </span>
    </button>
  );
}

export function AssistantArtifactCards({ message }: { message: ChatMessage }) {
  const { artifacts, loadingPath, openArtifact } = useMessageArtifacts(message);

  if (!message.isComplete || !artifacts.length) {
    return null;
  }

  return (
    <div className="artifact-cards" aria-label="답변 산출물">
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.path} artifact={artifact} loadingPath={loadingPath} onOpen={(nextArtifact) => void openArtifact(nextArtifact)} />
      ))}
    </div>
  );
}

export function AssistantArtifactContent({
  message,
  settings,
  active,
  onVisibleTextChange,
}: {
  message: ChatMessage;
  settings: AppSettings;
  active: boolean;
  onVisibleTextChange?: () => void;
}) {
  const { artifactBySourcePath, loadingPath, openArtifact } = useMessageArtifacts(message);
  const parts = useMemo(() => {
    if (!message.isComplete || !artifactBySourcePath.size) {
      return [];
    }
    const references = collectArtifactReferences(message.text)
      .map((reference) => ({
        reference,
        artifact: artifactBySourcePath.get(artifactKey(reference.path)),
      }))
      .filter((item): item is { reference: ReturnType<typeof collectArtifactReferences>[number]; artifact: ResolvedArtifact } => Boolean(item.artifact))
      .sort((left, right) => left.reference.start - right.reference.start);
    const nextParts: Array<{ type: "markdown"; text: string } | { type: "artifact"; artifact: ArtifactSummary }> = [];
    let cursor = 0;
    for (const { reference, artifact } of references) {
      if (reference.start < cursor) {
        continue;
      }
      const before = message.text.slice(cursor, reference.start);
      if (before.trim()) {
        nextParts.push({ type: "markdown", text: before });
      }
      nextParts.push({ type: "artifact", artifact });
      cursor = reference.end;
    }
    const after = message.text.slice(cursor);
    if (after.trim()) {
      nextParts.push({ type: "markdown", text: after });
    }
    return nextParts;
  }, [artifactBySourcePath, message.isComplete, message.text]);

  if (!parts.length) {
    return (
      <StreamingAssistantMessage
        message={message}
        settings={settings}
        active={active}
        onVisibleTextChange={onVisibleTextChange}
      />
    );
  }

  return (
    <div className="assistant-artifact-content">
      {parts.map((part, index) => (
        <Fragment key={part.type === "artifact" ? `${part.artifact.path}-${index}` : `markdown-${index}`}>
          {part.type === "markdown" ? (
            <MarkdownMessage text={part.text} />
          ) : (
            <div className="assistant-artifact-inline" aria-label="답변 산출물">
              <ArtifactCard artifact={part.artifact} loadingPath={loadingPath} onOpen={(artifact) => void openArtifact(artifact)} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
