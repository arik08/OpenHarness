import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openPort() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const probe = createServer();
    try {
      await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", resolve);
      });
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch {
      if (probe.listening) {
        await new Promise((resolve) => probe.close(resolve));
      }
    }
  }
  throw new Error("Could not find an open test port");
}

async function startWebServer({ host = "127.0.0.1", env = {} } = {}) {
  const port = await openPort();
  const configDir = await mkdtemp(join(tmpdir(), "myharness-web-security-"));
  const childEnv = {
    ...process.env,
    PORT: String(port),
    HOST: host,
    MYHARNESS_CONFIG_DIR: configDir,
    MYHARNESS_DATA_DIR: join(configDir, "data"),
    MYHARNESS_LOGS_DIR: join(configDir, "logs"),
    MYHARNESS_HOME: configDir,
    ...env,
  };

  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) {
      delete childEnv[key];
    }
  }

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = [];
  const waitForReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for server startup:\n${output.join("")}`));
    }, 15_000);

    function onData(chunk) {
      const text = chunk.toString();
      output.push(text);
      if (text.includes("MyHarness web is ready")) {
        clearTimeout(timeout);
        resolve();
      }
    }

    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before startup with code ${code}:\n${output.join("")}`));
    });
  });

  await waitForReady;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    configDir,
    port,
    output,
    async stop() {
      if (!child.killed) {
        child.kill();
      }
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
      await rm(configDir, { recursive: true, force: true });
    },
  };
}

test("rejects shell command requests without an owned active session", async (t) => {
  const app = await startWebServer({
    env: { MYHARNESS_WORKSPACE_SCOPE: "ip" },
  });
  t.after(() => app.stop());

  const response = await fetch(`${app.baseUrl}/api/shell`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "echo should-not-run" }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.match(payload.error, /active session/i);
});

test("pins history snapshots and lists pinned chats first", async (t) => {
  const app = await startWebServer({
    env: { MYHARNESS_WORKSPACE_SCOPE: "shared" },
  });
  let workspacePath = "";
  t.after(async () => {
    await app.stop();
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  const workspaceName = `PinTest${Date.now().toString(36)}`;
  const workspaceResponse = await fetch(`${app.baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: workspaceName }),
  });
  const workspacePayload = await workspaceResponse.json();
  const workspace = workspacePayload.workspace;
  workspacePath = workspace?.path || "";
  assert.equal(workspaceResponse.status, 200);
  assert.ok(workspace?.path);

  const sessionDir = join(workspace.path, ".myharness", "sessions");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session-newer.json"),
    JSON.stringify({
      session_id: "newer",
      created_at: 200,
      summary: "최신 대화",
      messages: [],
      message_count: 1,
    }),
  );
  await writeFile(
    join(sessionDir, "session-older.json"),
    JSON.stringify({
      session_id: "older",
      created_at: 100,
      summary: "고정할 대화",
      messages: [],
      message_count: 1,
    }),
  );

  const pinResponse = await fetch(`${app.baseUrl}/api/history/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "older", pinned: true, workspacePath: workspace.path, workspaceName: workspace.name }),
  });
  const pinPayload = await pinResponse.json();
  assert.equal(pinResponse.status, 200);
  assert.equal(pinPayload.pinned, true);

  const historyResponse = await fetch(`${app.baseUrl}/api/history?workspacePath=${encodeURIComponent(workspace.path)}`);
  const historyPayload = await historyResponse.json();

  assert.equal(historyResponse.status, 200);
  assert.deepEqual(historyPayload.options.map((item) => item.value), ["older", "newer"]);
  assert.equal(historyPayload.options[0].pinned, true);
});

test("deletes a project after stopping active backend sessions in that project", async (t) => {
  const app = await startWebServer({
    env: { MYHARNESS_WORKSPACE_SCOPE: "shared" },
  });
  let workspacePath = "";
  t.after(async () => {
    await app.stop();
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  const workspaceName = `DeleteLiveTest${Date.now().toString(36)}`;
  const workspaceResponse = await fetch(`${app.baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: workspaceName }),
  });
  const workspacePayload = await workspaceResponse.json();
  const workspace = workspacePayload.workspace;
  workspacePath = workspace?.path || "";
  assert.equal(workspaceResponse.status, 200);
  assert.ok(workspacePath);

  const sessionResponse = await fetch(`${app.baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: "stale-client", cwd: workspacePath }),
  });
  assert.equal(sessionResponse.status, 200);

  const deleteResponse = await fetch(`${app.baseUrl}/api/workspaces`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: workspaceName }),
  });
  const deletePayload = await deleteResponse.json();

  assert.equal(deleteResponse.status, 200);
  assert.equal(deletePayload.deleted.name, workspaceName);
  assert.equal(deletePayload.workspaces.some((item) => item.name === workspaceName), false);
});

test("lists and reclaims live sessions from the same browser address", async (t) => {
  const app = await startWebServer({
    env: { MYHARNESS_WORKSPACE_SCOPE: "ip" },
  });
  t.after(() => app.stop());

  const createdResponse = await fetch(`${app.baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: "client-old" }),
  });
  const created = await createdResponse.json();

  assert.equal(createdResponse.status, 200);
  assert.ok(created.sessionId);

  const liveResponse = await fetch(`${app.baseUrl}/api/live-sessions?clientId=client-new`);
  const live = await liveResponse.json();

  assert.equal(liveResponse.status, 200);
  assert.equal(live.sessions.some((session) => session.sessionId === created.sessionId), true);

  const shutdownResponse = await fetch(`${app.baseUrl}/api/shutdown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: created.sessionId, clientId: "client-new" }),
  });

  assert.equal(shutdownResponse.status, 200);
});

test("shuts down idle backend sessions after the event stream closes", async (t) => {
  const app = await startWebServer({
    env: {
      MYHARNESS_WORKSPACE_SCOPE: "ip",
      MYHARNESS_BACKEND_IDLE_CLIENT_CLOSE_MS: "50",
    },
  });
  t.after(() => app.stop());

  const createdResponse = await fetch(`${app.baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: "client-idle" }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200);

  const controller = new AbortController();
  const eventsResponse = await fetch(
    `${app.baseUrl}/api/events?session=${created.sessionId}&clientId=client-idle`,
    { signal: controller.signal },
  );
  assert.equal(eventsResponse.status, 200);
  controller.abort();
  await eventsResponse.body?.cancel().catch(() => {});
  await sleep(200);

  const liveResponse = await fetch(`${app.baseUrl}/api/live-sessions?clientId=client-idle`);
  const live = await liveResponse.json();

  assert.equal(liveResponse.status, 200);
  assert.equal(live.sessions.some((session) => session.sessionId === created.sessionId), false);
});

test("defaults to shared workspaces when listening on LAN interfaces", async (t) => {
  const app = await startWebServer({
    host: "0.0.0.0",
    env: { MYHARNESS_WORKSPACE_SCOPE: undefined },
  });
  t.after(() => app.stop());

  const response = await fetch(`${app.baseUrl}/api/settings/workspace-scope`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "shared");
  assert.equal(payload.scope.mode, "shared");
});

test("can still use IP-scoped workspaces when explicitly configured", async (t) => {
  const app = await startWebServer({
    host: "0.0.0.0",
    env: { MYHARNESS_WORKSPACE_SCOPE: "ip" },
  });
  t.after(() => app.stop());

  const response = await fetch(`${app.baseUrl}/api/settings/workspace-scope`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.mode, "ip");
  assert.equal(payload.scope.mode, "ip");
});

test("rejects global settings writes from forwarded remote clients", async (t) => {
  const app = await startWebServer({
    env: { MYHARNESS_WORKSPACE_SCOPE: "ip" },
  });
  t.after(() => app.stop());

  const response = await fetch(`${app.baseUrl}/api/settings/workspace-scope`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify({ mode: "shared" }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.match(payload.error, /local/i);
});
