import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";

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
