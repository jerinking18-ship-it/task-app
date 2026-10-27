/** Test the built app locally; no production credentials, login or task writes. */
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { once } from "node:events";
import { checkSecurityHeaders } from "./check-security-headers.mjs";

const port = Number(process.env.SECURITY_CHECK_PORT ?? "3064");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid test port");
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (chunk) => { log = (log + chunk).slice(-4000); });
server.stderr.on("data", (chunk) => { log = (log + chunk).slice(-4000); });
const stopped = once(server, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${log}`);
    try {
      if (/Ready in/.test(log)) {
        const response = await fetch(`${base}/sign-in`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200) { ready = true; break; }
      }
    } catch { /* Wait for this owned server to start. */ }
    await pause(250);
  }
  if (!ready) throw new Error(`Test server was not ready: ${log}`);
  await checkSecurityHeaders(base);
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await stopped;
}
