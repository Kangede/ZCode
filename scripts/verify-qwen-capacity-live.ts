import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { NodeHttpClientAdapter } from "../apps/zcode-cli/packages/adapters/src/http/index.js";
import { inspectImage } from "../apps/zcode-cli/packages/adapters/src/image-generation/binary.js";
import { normalizeImagesBaseUrl } from "../apps/zcode-cli/packages/adapters/src/image-generation/qwen.js";
import {
  IMAGE_RESPONSE_MAX_BYTES,
  validateImageSize,
} from "../packages/shared/src/image-generation.js";

// Qualification deliberately calls the upstream directly, without the production
// capacity guard. Plans must be reviewed; it never retries an image request.
const { values } = parseArgs({
  options: {
    connection: { type: "string" },
    plan: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.connection || !values.plan || !values.output)
  throw new Error("Required: --connection PRIVATE.json --plan PLAN.json --output NEW_DIRECTORY");
const connection = JSON.parse(await readFile(resolve(values.connection), "utf8"));
const plan = JSON.parse(await readFile(resolve(values.plan), "utf8")) as {
  references: string[];
  memoryCeilingMb?: number;
  scenarios: Array<{
    name: string;
    size: string;
    count: number;
    seed: number;
    references?: string[];
    prompt?: string;
  }>;
};
if (
  plan.memoryCeilingMb !== undefined &&
  (!Number.isFinite(plan.memoryCeilingMb) || plan.memoryCeilingMb <= 0)
)
  throw new Error("memoryCeilingMb must be a positive finite number");
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const reportPath = join(directory, "report.json");
await writeFile(reportPath, "{}", { flag: "wx" });
const base = normalizeImagesBaseUrl(connection.baseUrl);
const root = base.replace(/\/v1$/, "");
const model = connection.model ?? "Qwen-Image-2.1";
const headers = connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
const http = new NodeHttpClientAdapter({
  env: process.env,
  noProxy: "*",
  requestDeadlineOnly: true,
});
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  model,
  memoryCeilingMb: plan.memoryCeilingMb ?? 46_000,
  concurrency: 1,
  plannedScenarios: plan.scenarios.map(({ name, size, count, seed }) => ({
    name,
    size,
    count,
    seed,
  })),
  cells: [],
};
async function save() {
  await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
  await rename(`${reportPath}.tmp`, reportPath);
}
async function get(path: string) {
  const result = await http.request({
    url: `${root}${path}`,
    method: "GET",
    headers,
    timeoutMs: 15_000,
    maxResponseBytes: 1024 * 1024,
    redirect: "manual",
  });
  if (result.status !== 200) throw new Error(`Preflight HTTP ${result.status}`);
  return JSON.parse(new TextDecoder().decode(result.body));
}
try {
  const catalog = await get("/v1/models");
  const advertised = catalog.data?.find((entry: any) => entry.id === model);
  if (!advertised) throw new Error("Requested model is not advertised");
  // Keep reproducibility metadata, never private endpoints or model filesystem paths.
  const info = await get("/server_info");
  report.environment = {
    version: info.version,
    tpSize: info.tp_size,
    dpSize: info.dp_size,
    pipeline: advertised.pipeline_name,
    gpus: advertised.num_gpus,
    ditPrecision: advertised.dit_precision,
    vaePrecision: advertised.vae_precision,
  };
  for (const scenario of plan.scenarios) {
    validateImageSize(scenario.size);
    if (!/^[a-zA-Z0-9_-]+$/.test(scenario.name)) throw new Error("Unsafe scenario name");
    if (!Number.isInteger(scenario.count) || scenario.count < 1 || scenario.count > 5)
      throw new Error("Reference count must be 1–5");
    const files = scenario.references ?? plan.references;
    if (files.length < scenario.count) throw new Error("Not enough distinct references");
    const references = await Promise.all(
      files
        .slice(0, scenario.count)
        .map(async (file) => inspectImage(await readFile(resolve(file)))),
    );
    const fields = {
      model,
      prompt:
        scenario.prompt ??
        "Picture 1 is the edit target. Change its teapot to cobalt blue. Keep the original scene, lighting and framing. Other pictures are only material references. No text.",
      n: 1,
      size: scenario.size,
      seed: scenario.seed,
      num_inference_steps: 40,
      guidance_scale: 1,
      generator_device: "cpu",
      response_format: "b64_json",
      output_format: "png",
      background: "auto",
      enable_cache_dit: false,
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    references.forEach((reference, index) =>
      form.append(
        "image[]",
        new Blob([Buffer.from(reference.bytes)], { type: reference.mimeType }),
        `reference-${index}.png`,
      ),
    );
    const encoded = new Request(base, { method: "POST", body: form });
    const cell: Record<string, any> = {
      name: scenario.name,
      size: scenario.size,
      count: scenario.count,
      seed: scenario.seed,
      fields,
      status: "running",
      startedAt: new Date().toISOString(),
      references: references.map((reference) => ({
        width: reference.width,
        height: reference.height,
        bytes: reference.bytes.length,
        mimeType: reference.mimeType,
        sha256: hash(reference.bytes),
      })),
    };
    report.cells.push(cell);
    await get("/health");
    await save();
    console.log(`START ${scenario.name}`);
    const started = Date.now();
    try {
      const response = await http.request({
        url: `${base}/images/edits`,
        method: "POST",
        headers: { ...headers, "Content-Type": encoded.headers.get("content-type")! },
        body: new Uint8Array(await encoded.arrayBuffer()),
        timeoutMs: 1_200_000,
        maxResponseBytes: IMAGE_RESPONSE_MAX_BYTES,
        redirect: "manual",
      });
      cell.httpStatus = response.status;
      const raw = new TextDecoder().decode(response.body);
      if (response.status !== 200) {
        cell.failureKind = /out of memory|cuda.*memory|\boom\b/i.test(raw) ? "oom" : "http_error";
        throw new Error(`Upstream HTTP ${response.status}; ${cell.failureKind}`);
      }
      const payload = JSON.parse(raw);
      if (payload.data?.length !== 1 || typeof payload.data[0]?.b64_json !== "string")
        throw new Error("Invalid image response");
      const image = await inspectImage(Buffer.from(payload.data[0].b64_json, "base64"));
      if (`${image.width}x${image.height}` !== scenario.size || image.mimeType !== "image/png")
        throw new Error("Output dimensions or format mismatch");
      const filename = `${scenario.name}.png`;
      await writeFile(join(directory, filename), image.bytes, { flag: "wx" });
      const peak = Number(payload.peak_memory_mb);
      Object.assign(cell, {
        status: "succeeded",
        durationMs: Date.now() - started,
        peakMemoryMb: Number.isFinite(peak) && peak > 0 ? peak : null,
        inferenceTimeS: payload.inference_time_s ?? null,
        output: {
          filename,
          width: image.width,
          height: image.height,
          bytes: image.bytes.length,
          sha256: hash(image.bytes),
        },
      });
      cell.health = (await get("/health")).status;
      await save();
      console.log(
        JSON.stringify({
          name: cell.name,
          status: cell.status,
          durationMs: cell.durationMs,
          peakMemoryMb: cell.peakMemoryMb,
          health: cell.health,
        }),
      );
      if (!cell.peakMemoryMb || cell.peakMemoryMb > report.memoryCeilingMb) {
        report.stoppedBecause = cell.peakMemoryMb ? "memory_headroom" : "missing_memory_telemetry";
        break;
      }
    } catch (error) {
      cell.status = "failed";
      cell.durationMs = Date.now() - started;
      // 不写原始错误正文：可能含私有服务地址或请求内容。
      cell.failureKind ??= "request_or_validation_error";
      try {
        cell.health = (await get("/health")).status;
      } catch {
        cell.health = "unavailable";
      }
      await save();
      throw new Error(`${scenario.name} failed; no retry (${cell.failureKind})`, { cause: error });
    }
  }
} finally {
  report.completed =
    report.cells.length === plan.scenarios.length &&
    report.cells.every((cell: any) => cell.status === "succeeded") &&
    !report.stoppedBecause;
  report.finishedAt = new Date().toISOString();
  await save();
}
