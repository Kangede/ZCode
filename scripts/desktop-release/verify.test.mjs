import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyDesktopRelease } from "./verify.mjs";

const version = "3.14.3-qwen.1";
const commit = "a".repeat(40);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "qwen-release-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [platform, arch, suffixes] of [
    ["linux", "x64", ["linux-x64.AppImage", "linux-x64.deb"]],
    ["win32", "x64", ["windows-x64-Setup.exe"]],
    ["darwin", "arm64", ["macOS-arm64.dmg", "macOS-arm64.zip"]],
    ["darwin", "x64", ["macOS-x64.dmg", "macOS-x64.zip"]],
  ]) {
    const directory = join(root, `${platform}-${arch}`);
    await mkdir(directory);
    const files = [];
    for (const suffix of suffixes) {
      const name = `ZCode-Qwen-${version}-${suffix}`;
      const bytes = Buffer.from(`fixture installer ${name}`);
      await writeFile(join(directory, name), bytes);
      files.push({
        name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await writeFile(
      join(directory, `manifest-${platform}-${arch}.json`),
      JSON.stringify({
        platform,
        arch,
        version,
        commit,
        files,
        acceptance: { passed: true, scenarios: 2 },
      }),
    );
  }
  return root;
}

test("publishing gate requires all four platforms from one tested source commit", async (t) => {
  const root = await fixture(t);
  const report = await verifyDesktopRelease(root, { version, commit });
  assert.equal(report.files.length, 7);
  await assert.rejects(
    verifyDesktopRelease(root, { version, commit: "b".repeat(40) }),
    /commit mismatch/,
  );
  await rm(join(root, "darwin-arm64"), { recursive: true });
  await assert.rejects(verifyDesktopRelease(root, { version, commit }), /four native targets/);
});

test("publishing gate rejects corrupt installers and untested artifacts", async (t) => {
  const root = await fixture(t);
  const path = join(root, "win32-x64/manifest-win32-x64.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.acceptance.passed = false;
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(verifyDesktopRelease(root, { version, commit }), /acceptance is missing/);
  manifest.acceptance.passed = true;
  await writeFile(path, JSON.stringify(manifest));
  await writeFile(
    join(root, "win32-x64", manifest.files[0].name),
    Buffer.alloc(manifest.files[0].bytes, 0),
  );
  await assert.rejects(verifyDesktopRelease(root, { version, commit }), /checksum mismatch/);
});
