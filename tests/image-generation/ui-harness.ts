import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { chromium, _electron, type Page } from "playwright-core";
import { mockImageProvider } from "./mock-provider.js";

export async function uiHarness(surface: "web" | "desktop") {
  const root = resolve(import.meta.dirname, "../..");
  const directory = join(root, ".evidence", "automated", `${surface}-${Date.now()}`);
  const home = join(directory, "home");
  const settings = join(home, ".zcode/v2");
  const workspace = join(directory, "workspace");
  await mkdir(settings, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const provider = await mockImageProvider();
  const providerFile = join(settings, "provider_config.json");
  await writeFile(
    providerFile,
    JSON.stringify({
      schemaVersion: 1,
      config: {
        providerOrder: ["image-fixture"],
        providerConfigRules: {
          providerRules: [
            {
              providerId: "image-fixture",
              providerName: "Image fixture",
              enabled: true,
              config: {
                group: "standard-personal",
                access: { type: "api-key", apiKey: "fixture-only-secret" },
                api: {
                  type: "openai-chat-completions",
                  baseUrl: `http://127.0.0.1:${provider.port}/v1`,
                },
                personalModelIds: ["fixture-chat"],
              },
            },
          ],
        },
        modelConfigRules: {
          providerModelRules: [
            { providerId: "image-fixture", modelId: "fixture-chat", config: { enabled: true } },
          ],
          manualProviderModelRules: [],
        },
        defaultModelSelection: {
          providerId: "image-fixture",
          modelId: "fixture-chat",
          options: {},
        },
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(settings, "setting.json"),
    JSON.stringify({
      recentProjects: [workspace],
      locale: "en-US",
      localePreference: "en-US",
      onboardingOccupation: "developer",
      providerFamilyDomain: "bigmodel",
      providerFamilyDomainMigrated: true,
    }),
  );
  await writeFile(
    join(settings, "onboarding-record.json"),
    JSON.stringify({
      version: 2,
      deviceMid: "fixture",
      entries: [
        {
          userId: null,
          occupation: "developer",
          interfaceMode: "coding",
          memoryEnabled: false,
          proactiveSuggestionsEnabled: false,
          completedAt: new Date().toISOString(),
          uploadState: "pending",
        },
      ],
      decisions: [],
    }),
  );
  const env: Record<string, string | undefined> = {
    ...process.env,
    ZCODE_DATA_BASE_DIR: home,
    ZCODE_STORAGE_DIR: join(directory, "data"),
    ZCODE_SESSION_DB_PATH: join(directory, "data/sessions.sqlite"),
    ZCODE_LOG_DIR: join(directory, "logs"),
    ZCODE_DESKTOP_HOME_DIR: home,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: providerFile,
    ZCODE_NO_PROXY: "*",
    ZCODE_DESKTOP_USER_DATA_DIR: join(directory, "chromium"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(directory, "chromium-session"),
    ZCODE_DESKTOP_APPLICATION_NAME: "ZCode Image Tests",
    ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const consoleErrors: string[] = [];
  const browserRequests: string[] = [];
  const leakedCredentials: string[] = [];
  const observePage = (target: Page) => {
    target.on("pageerror", (error) => consoleErrors.push(error.message));
    target.on("request", (request) => browserRequests.push(request.url()));
    target.on("websocket", (socket) => {
      socket.on("framereceived", (event) => {
        if (String(event.payload).includes("fixture-only-secret"))
          leakedCredentials.push("received upstream secret");
      });
    });
  };
  let child: ChildProcess | undefined;
  let closeBrowser: (() => Promise<void>) | undefined;
  let desktopDownload: (() => Promise<Buffer>) | undefined;
  let page: Page;
  try {
    if (surface === "desktop") {
      const executablePath =
        process.env.ZCODE_IMAGE_TEST_ELECTRON ??
        join(
          root,
          "node_modules/electron/dist",
          process.platform === "win32"
            ? "electron.exe"
            : process.platform === "darwin"
              ? "Electron.app/Contents/MacOS/Electron"
              : "electron",
        );
      const packaged = Boolean(process.env.ZCODE_IMAGE_TEST_ELECTRON);
      const app = await _electron.launch({
        executablePath,
        args: [
          ...(packaged ? [] : [join(root, "packages/desktop")]),
          ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        ],
        env,
        cwd: workspace,
        timeout: 60_000,
      });
      page = await app.firstWindow();
      observePage(page);
      closeBrowser = () => app.close();
      desktopDownload = async () => {
        const file = join(directory, `download-${Date.now()}.png`);
        await app.evaluate(({ session }, output) => {
          (globalThis as any).__imageDownload = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Electron download did not complete")),
              15_000,
            );
            session.defaultSession.once("will-download", (_event, item) => {
              item.setSavePath(output);
              item.once("done", (_event, state) => {
                clearTimeout(timer);
                if (state === "completed") resolve();
                else reject(new Error(state));
              });
            });
          });
        }, file);
        await page.getByRole("link", { name: "Download", exact: true }).click();
        await app.evaluate(() => (globalThis as any).__imageDownload);
        return readFile(file);
      };
      await page.evaluate(() => localStorage.setItem("zcode-theme", "system"));
      await page.reload();
      await writeFile(
        join(directory, "electron.json"),
        JSON.stringify(
          await app.evaluate(({ app }) => ({
            version: app.getVersion(),
            packaged: app.isPackaged,
            name: app.name,
          })),
          null,
          2,
        ),
      );
    } else {
      const server = createServer().listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = (server.address() as { port: number }).port;
      await new Promise<void>((r) => server.close(() => r()));
      const dist = process.env.ZCODE_IMAGE_TEST_DISTRIBUTION;
      const args = dist
        ? [
            join(dist, "bin/zcode.mjs"),
            "--web",
            "--port",
            String(port),
            "--no-open",
            "--no-token",
            "--workspace",
            workspace,
          ]
        : [join(root, "packages/server/dist/entry-http.js")];
      child = spawn(process.execPath, args, {
        env: {
          ...env,
          PORT: String(port),
          ZCODE_SERVER_HOST: "127.0.0.1",
          ZCODE_SERVER_WORKSPACE: workspace,
          ZCODE_WEB_STATIC_ROOT: join(root, "packages/web/dist"),
        },
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const { createWriteStream } = await import("node:fs");
      const log = createWriteStream(join(directory, "server.log"));
      child.stdout?.pipe(log);
      child.stderr?.pipe(log);
      const url = `http://127.0.0.1:${port}`;
      for (let attempt = 0; ; attempt++) {
        try {
          if ((await fetch(url)).ok) break;
        } catch {
          /* startup */
        }
        if (attempt > 60 || child.exitCode !== null)
          throw new Error(`Web server failed; inspect ${directory}/server.log`);
        await new Promise((r) => setTimeout(r, 500));
      }
      const browser = await chromium.launch({
        channel: process.env.ZCODE_IMAGE_TEST_BROWSER ?? "chrome",
        headless: true,
      });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true,
      });
      await context.addInitScript(() => localStorage.setItem("zcode-theme", "system"));
      page = await context.newPage();
      observePage(page);
      closeBrowser = () => browser.close();
      await page.goto(url);
    }
    page.setDefaultTimeout(30_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    return {
      page,
      directory,
      workspace,
      provider,
      consoleErrors,
      leakedCredentials,
      browserRequests,
      async close() {
        await page
          .screenshot({ path: join(directory, "final-state.png"), fullPage: true })
          .catch(() => {});
        await writeFile(
          join(directory, "final-dom.txt"),
          await page
            .locator("body")
            .innerText()
            .catch(() => "page closed"),
        );
        await writeFile(
          join(directory, "requests.json"),
          JSON.stringify(provider.requests, null, 2),
        );
        await writeFile(
          join(directory, "browser.json"),
          JSON.stringify({ consoleErrors, leakedCredentials, browserRequests }, null, 2),
        );
        await closeBrowser?.();
        child?.kill();
        await provider.close();
      },
      async screenshot(name: string) {
        await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
      },
      async downloadedBytes() {
        if (desktopDownload) return desktopDownload();
        const promise = page.waitForEvent("download");
        await page.getByRole("link", { name: "Download", exact: true }).click();
        const download = await promise;
        const file = join(directory, download.suggestedFilename());
        await download.saveAs(file);
        return readFile(file);
      },
    };
  } catch (error) {
    child?.kill();
    await closeBrowser?.();
    await provider.close();
    throw error;
  }
}
