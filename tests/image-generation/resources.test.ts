import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hasBundledImageSkill } from "../../apps/zcode-cli/packages/bootstrap/src/app/bundled-skills.js";
import { collectSeaBundledSkillAssets } from "../../apps/zcode-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs";
import { generateImageToolEntry } from "../../apps/zcode-cli/packages/core/src/tool/handlers/generate-image.js";
import { normalizeDevelopmentAppVersion } from "../../packages/desktop/src/main/desktopDevelopmentVersion.js";
import {
  getDefaultConfigPath,
  loadFileConfig,
} from "../../apps/zcode-cli/packages/adapters/src/config/file-config.adapter.js";

test("optional image skill gate and SEA resource collection use the shipped source", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "image-skill-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const roots = [
    { path: temporary, priority: 1, scope: "system" as const, source: "bundled" as const },
  ];
  assert.equal(await hasBundledImageSkill(roots), false);
  await mkdir(join(temporary, "image-generation"));
  await writeFile(join(temporary, "image-generation/SKILL.md"), "fixture");
  assert.equal(await hasBundledImageSkill(roots), true);
  const { manifest } = await collectSeaBundledSkillAssets({
    root: resolve("apps/zcode-cli"),
    stagingDirectory: join(temporary, "sea"),
  });
  assert.ok(
    manifest.files.some(
      (file: { path: string }) => file.path === "skills/image-generation/SKILL.md",
    ),
  );
  assert.ok(
    manifest.files.some(
      (file: { path: string }) => file.path === "skills/dynamic-workflows/SKILL.md",
    ),
  );
});

test("native image tool delegates its deadline and cancellation to the session owner", async () => {
  assert.deepEqual(generateImageToolEntry.timeout, { kind: "none" });
  assert.equal(generateImageToolEntry.cancellation.supported, true);
  assert.equal(generateImageToolEntry.permission?.needsApproval, true);
});

test("development version repair uses supported reads and leaves packaged metadata intact", () => {
  const missing = { isPackaged: false, getVersion: () => "0.0" };
  normalizeDevelopmentAppVersion(missing, "3.14.3");
  assert.equal(missing.getVersion(), "3.14.3");
  for (const isPackaged of [false, true]) {
    const app = { isPackaged, getVersion: () => "1.2.3" };
    const original = app.getVersion;
    normalizeDevelopmentAppVersion(app, "3.14.3");
    assert.equal(app.getVersion, original);
  }
  const packaged = { isPackaged: true, getVersion: () => "0.0" };
  normalizeDevelopmentAppVersion(packaged, "3.14.3");
  assert.equal(packaged.getVersion(), "0.0");
});

test("explicit profile isolates default CLI configuration while explicit file paths retain priority", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "image profile "));
  const previous = process.env.ZCODE_DATA_BASE_DIR;
  t.after(async () => {
    if (previous === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = previous;
    await rm(temporary, { recursive: true, force: true });
  });
  process.env.ZCODE_DATA_BASE_DIR = temporary;
  assert.equal(getDefaultConfigPath(), join(temporary, ".zcode/cli/config.json"));
  await mkdir(join(temporary, ".zcode/cli"), { recursive: true });
  await writeFile(getDefaultConfigPath(), JSON.stringify({ imageGeneration: { enabled: true } }));
  assert.equal(loadFileConfig().config?.imageGeneration?.enabled, true);
  const explicit = join(temporary, "explicit.json");
  await writeFile(explicit, JSON.stringify({ imageGeneration: { enabled: false } }));
  assert.equal(loadFileConfig(explicit).config?.imageGeneration?.enabled, false);
});
