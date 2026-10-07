import { mkdtemp, mkdir, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../spawn-command.mjs";

function run(command, args) {
  const result = runCommand(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Installer validation failed: ${command} (${result.status})`);
}

export async function installedApplication(output, manifest) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-qwen-install-"));
  const artifact = (extension) => {
    const file = manifest.files.find((entry) => entry.name.endsWith(extension));
    if (!file) throw new Error(`Installer is missing: ${extension}`);
    return join(output, "artifacts", file.name);
  };
  let executable;
  if (process.platform === "darwin") {
    const mount = join(directory, "volume");
    await mkdir(mount);
    run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, artifact(".dmg")]);
    try {
      const name = (await readdir(mount)).find((name) => name.endsWith(".app"));
      if (!name) throw new Error("The DMG does not contain an application");
      // 用系统复制器保留 framework 的相对符号链接，卸载磁盘映像后再启动，避免依赖挂载路径。
      run("ditto", [join(mount, name), join(directory, name)]);
      run("codesign", ["--verify", "--deep", "--strict", join(directory, name)]);
      executable = join(directory, name, "Contents/MacOS/ZCode Preview");
    } finally {
      run("hdiutil", ["detach", mount]);
    }
  } else if (process.platform === "win32") {
    run(artifact(".exe"), ["/S", `/D=${directory}`]);
    executable = join(directory, "ZCode Preview.exe");
  } else {
    run("dpkg-deb", ["--extract", artifact(".deb"), directory]);
    const candidates = await readdir(join(directory, "opt"));
    if (candidates.length !== 1) throw new Error("Unexpected application layout in deb");
    executable = join(directory, "opt", candidates[0], "zcode-preview");
  }
  await access(executable);
  const resources =
    process.platform === "darwin"
      ? join(dirname(executable), "../Resources")
      : join(dirname(executable), "resources");
  await access(join(resources, "glm/packages/bundled-skills/skills/image-generation/SKILL.md"));
  return { executable, resources, directory };
}
