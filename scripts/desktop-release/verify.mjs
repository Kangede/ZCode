import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const targets = new Map([
  ["linux-x64", ["linux-x64.AppImage", "linux-x64.deb"]],
  ["win32-x64", ["windows-x64-Setup.exe"]],
  ["darwin-arm64", ["macOS-arm64.dmg", "macOS-arm64.zip"]],
  ["darwin-x64", ["macOS-x64.dmg", "macOS-x64.zip"]],
]);

async function findManifests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findManifests(path)));
    else if (entry.isFile() && /^manifest-[\w-]+\.json$/.test(entry.name)) files.push(path);
  }
  return files;
}

export async function verifyDesktopRelease(directory, { version, commit }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Expected a full Git commit SHA");
  const manifests = await findManifests(directory);
  if (manifests.length !== targets.size) throw new Error("All four native targets are required");
  const seen = new Set();
  const files = [];
  for (const path of manifests) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const target = `${manifest.platform}-${manifest.arch}`;
    const suffixes = targets.get(target);
    if (!suffixes || seen.has(target)) throw new Error(`Unexpected or duplicate target: ${target}`);
    seen.add(target);
    if (manifest.version !== version || manifest.commit !== commit)
      throw new Error(`Version or source commit mismatch: ${target}`);
    if (!manifest.acceptance?.passed || manifest.acceptance.scenarios !== 2)
      throw new Error(`Native installed-app acceptance is missing: ${target}`);
    const names = suffixes.map((suffix) => `ZCode-Qwen-${version}-${suffix}`);
    if (manifest.files.length !== names.length) throw new Error(`Missing installer: ${target}`);
    for (const name of names) {
      const entry = manifest.files.find((file) => file.name === name);
      if (!entry) throw new Error(`Missing installer: ${name}`);
      const source = join(dirname(path), name);
      const stat = await lstat(source);
      if (!stat.isFile() || stat.size === 0 || stat.size !== entry.bytes)
        throw new Error(`Installer size/type mismatch: ${name}`);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(source)) hash.update(chunk);
      const sha256 = hash.digest("hex");
      if (sha256 !== entry.sha256) throw new Error(`Installer checksum mismatch: ${name}`);
      files.push({ name, source, bytes: stat.size, sha256 });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { version, commit, targets: [...seen].sort(), files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { directory: { type: "string" }, commit: { type: "string" } },
  });
  if (!values.directory || !values.commit)
    throw new Error("Required: --directory ARTIFACTS --commit SHA");
  const release = JSON.parse(await readFile(new URL("./release.json", import.meta.url), "utf8"));
  const report = await verifyDesktopRelease(resolve(values.directory), {
    version: release.version,
    commit: values.commit,
  });
  await writeFile(
    join(values.directory, "SHA256SUMS.txt"),
    report.files.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n",
  );
  await writeFile(
    join(values.directory, "verified-release.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `Verified ${report.files.length} installers across ${report.targets.length} targets at ${report.commit}`,
  );
}
