import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fixtureImage } from "./fixtures.js";

for (const outcome of ["headroom", "missing-telemetry", "oom"] as const)
  test(`capacity qualification stops after ${outcome}, persists evidence and never retries`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "qwen-qualification-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const image = await fixtureImage();
    const reference = join(directory, "reference.png");
    await writeFile(reference, image.bytes);
    let posts = 0;
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* Consume the multipart request. */
      }
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/v1/models")
        response.end(JSON.stringify({ data: [{ id: "Qwen-Image-2.1" }] }));
      else if (request.url === "/server_info")
        response.end(JSON.stringify({ version: "test", model_path: "/private-model-path" }));
      else if (request.url === "/health") response.end(JSON.stringify({ status: "ok" }));
      else {
        posts++;
        if (outcome === "oom") {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "CUDA out of memory; private-error-data" }));
        } else
          response.end(
            JSON.stringify({
              data: [{ b64_json: Buffer.from(image.bytes).toString("base64") }],
              ...(outcome === "headroom" ? { peak_memory_mb: 47_000 } : {}),
            }),
          );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    const connection = join(directory, "connection.json");
    const plan = join(directory, "plan.json");
    await writeFile(connection, JSON.stringify({ baseUrl, apiKey: "private-test-key" }));
    await writeFile(
      plan,
      JSON.stringify({
        references: [reference],
        scenarios: [1, 2].map((n) => ({ name: `cell-${n}`, size: "512x512", count: 1, seed: n })),
      }),
    );
    const root = resolve(import.meta.dirname, "../..");
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/verify-qwen-capacity-live.ts",
        "--connection",
        connection,
        "--plan",
        plan,
        "--output",
        join(directory, "output"),
      ],
      { cwd: root, stdio: "pipe" },
    );
    t.after(() => child.kill());
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const [code] = await once(child, "exit");
    assert.equal(code, outcome === "oom" ? 1 : 0, output);
    assert.equal(posts, 1);
    const raw = await readFile(join(directory, "output/report.json"), "utf8");
    const report = JSON.parse(raw);
    assert.equal(report.cells.length, 1);
    assert.equal(report.plannedScenarios.length, 2);
    assert.equal(report.completed, false);
    assert.equal(report.cells[0].status, outcome === "oom" ? "failed" : "succeeded");
    assert.equal(report.cells[0].health, "ok");
    if (outcome === "oom") assert.equal(report.cells[0].failureKind, "oom");
    else
      assert.equal(
        report.stoppedBecause,
        outcome === "headroom" ? "memory_headroom" : "missing_memory_telemetry",
      );
    for (const privateText of [
      "private-test-key",
      "private-error-data",
      "/private-model-path",
      baseUrl,
    ])
      assert.equal(raw.includes(privateText), false);
  });
