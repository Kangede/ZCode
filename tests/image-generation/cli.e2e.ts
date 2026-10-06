import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Jimp } from "jimp";
import { mockImageProvider } from "./mock-provider.js";

for (const capacity of [false, true])
  test(
    capacity
      ? "real headless CLI rejects excess high-resolution references before HTTP"
      : "real headless CLI executes regional editing through an independent provider",
    { timeout: 120_000 },
    async (t) => {
      const root = resolve(import.meta.dirname, "../..");
      const directory = join(root, ".evidence", "automated", `cli-repaint-${Date.now()}`);
      const home = join(directory, "home"),
        workspace = join(directory, "workspace"),
        storage = join(directory, "data");
      await mkdir(join(home, ".zcode/cli"), { recursive: true });
      await mkdir(workspace, { recursive: true });
      const chat = await mockImageProvider();
      const images = await mockImageProvider("fixture-image-secret");
      t.after(async () => {
        await chat.close();
        await images.close();
      });
      const providerFile = join(directory, "providers.json");
      await writeFile(
        providerFile,
        JSON.stringify({
          schemaVersion: 1,
          config: {
            providerOrder: ["chat", "images"],
            providerConfigRules: {
              providerRules: [
                {
                  providerId: "chat",
                  providerName: "Chat",
                  enabled: true,
                  config: {
                    group: "standard-personal",
                    access: { type: "api-key", apiKey: "fixture-only-secret" },
                    api: {
                      type: "openai-chat-completions",
                      baseUrl: `http://127.0.0.1:${chat.port}/v1`,
                    },
                    personalModelIds: ["fixture-chat"],
                  },
                },
                {
                  providerId: "images",
                  providerName: "Images",
                  enabled: true,
                  config: {
                    group: "standard-personal",
                    access: { type: "api-key", apiKey: "fixture-image-secret" },
                    api: {
                      type: "openai-chat-completions",
                      baseUrl: `http://127.0.0.1:${images.port}/v1`,
                    },
                  },
                },
              ],
            },
            modelConfigRules: {
              providerModelRules: [
                { providerId: "chat", modelId: "fixture-chat", config: { enabled: true } },
              ],
              manualProviderModelRules: [],
            },
            defaultModelSelection: { providerId: "chat", modelId: "fixture-chat", options: {} },
          },
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(home, ".zcode/cli/config.json"),
        JSON.stringify({ imageGeneration: { enabled: true, providerId: "images" } }),
      );
      const original = new Jimp({ width: 512, height: 512, color: 0xdd4422ff });
      const mask = new Jimp({ width: 512, height: 512, color: 0xffffffff });
      for (let y = 220; y < 292; y++)
        for (let x = 220; x < 292; x++) mask.setPixelColor(0xffffff00, x, y);
      await writeFile(join(workspace, "source.png"), await original.getBuffer("image/png"));
      await writeFile(join(workspace, "mask.png"), await mask.getBuffer("image/png"));
      const args = [
        join(root, "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
        "--cwd",
        workspace,
        "--locale",
        "en-US",
        "-p",
        capacity
          ? "[native-capacity] Edit source.png at 2048x2048 with multiple references."
          : "[native-repaint] Use the image tool to repaint the selected part of source.png blue with mask.png. Keep original size.",
      ];
      const child = spawn(process.execPath, args, {
        cwd: workspace,
        env: {
          ...process.env,
          ZCODE_DATA_BASE_DIR: home,
          ZCODE_STORAGE_DIR: storage,
          ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: providerFile,
          ZCODE_SESSION_DB_PATH: join(storage, "sessions.sqlite"),
          ZCODE_LOG_DIR: join(directory, "logs"),
          ZCODE_NO_PROXY: "*",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => child.kill());
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      const code = await new Promise((resolveExit, reject) => {
        child.on("error", reject);
        child.on("exit", resolveExit);
      });
      await writeFile(join(directory, "terminal.txt"), output);
      assert.equal(code, 0, output);
      assert.equal(images.requests.length, capacity ? 0 : 1, output);
      assert.equal(chat.requests.length, 0);
      assert.equal(output.includes("fixture-image-secret"), false);
      if (capacity) {
        assert.match(output, /2048x2048 supports at most/);
        t.diagnostic(`Evidence: ${directory}`);
        return;
      }
      const journals = join(storage, "cli/image-generation/sessions");
      const jobs = [];
      for (const session of await readdir(journals))
        for (const file of await readdir(join(journals, session)))
          if (file.startsWith("job-"))
            jobs.push(JSON.parse(await readFile(join(journals, session, file), "utf8")));
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, "succeeded");
      assert.equal(jobs[0].input.mask, "mask.png");
      const result = await Jimp.read(jobs[0].artifact.path);
      assert.equal(result.getPixelColor(256, 256), 0x2255ddff);
      assert.equal(result.getPixelColor(150, 256), original.getPixelColor(150, 256));
      t.diagnostic(`Evidence: ${directory}`);
    },
  );
