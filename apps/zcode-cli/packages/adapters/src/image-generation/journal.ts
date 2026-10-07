import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ImageGenerationError, type ImageJournalPort } from "@zcode/contracts";
import {
  IMAGE_REFERENCE_MAX_BYTES,
  imageArtifactSchema,
  imageGenerationSettingsSchema,
  imageJobSchema,
} from "@zcode/shared/image-generation";

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function createImageJournal(options: {
  rootDir: string;
  sessionId: string;
  workspace: string;
}): ImageJournalPort {
  const sessionKey = createHash("sha256").update(options.sessionId).digest("hex");
  const directory = join(options.rootDir, "sessions", sessionKey);
  const settingsPath = join(options.rootDir, "settings.json");
  const uploadPath = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new ImageGenerationError("invalid_id", "Invalid image upload identifier");
    return join(directory, "uploads", `${id}.part`);
  };
  const queues = new Map<string, Promise<unknown>>();
  const serialize = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(key, next);
    try {
      return await next;
    } finally {
      if (queues.get(key) === next) queues.delete(key);
    }
  };
  return {
    async load() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const jobs = [];
      const references = [];
      for (const file of await readdir(directory)) {
        if (!file.endsWith(".json")) continue;
        const value = JSON.parse(await readFile(join(directory, file), "utf8"));
        if (file.startsWith("job-")) jobs.push(imageJobSchema.parse(value));
        if (file.startsWith("ref-")) references.push(imageArtifactSchema.parse(value));
      }
      let settings;
      try {
        settings = imageGenerationSettingsSchema.parse(
          JSON.parse(await readFile(settingsPath, "utf8")),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return { jobs, references, settings };
    },
    writeJob(job) {
      const key = createHash("sha256").update(job.id).digest("hex");
      return serialize(key, () =>
        atomicJson(join(directory, `job-${key}.json`), imageJobSchema.parse(job)),
      );
    },
    writeReference(artifact) {
      const key = createHash("sha256").update(artifact.id).digest("hex");
      return serialize(key, () =>
        atomicJson(join(directory, `ref-${key}.json`), imageArtifactSchema.parse(artifact)),
      );
    },
    writeSettings(settings) {
      return serialize("settings", () =>
        atomicJson(settingsPath, imageGenerationSettingsSchema.parse(settings)),
      );
    },
    async readWorkspaceImage(path) {
      const root = await realpath(options.workspace);
      const target = await realpath(resolve(root, path));
      if (!within(root, target))
        throw new ImageGenerationError(
          "path_denied",
          "Import external images through the workbench before using them as references",
        );
      const handle = await open(target, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > IMAGE_REFERENCE_MAX_BYTES)
          throw new ImageGenerationError(
            "reference_too_large",
            "Reference must be a file of at most 50 MiB",
          );
        const bytes = await handle.readFile();
        if (bytes.length > IMAGE_REFERENCE_MAX_BYTES)
          throw new ImageGenerationError("reference_too_large", "Reference exceeds 50 MiB");
        return bytes;
      } finally {
        await handle.close();
      }
    },
    uploadChunk(id, offset, bytes, final) {
      return serialize(`upload-${id}`, async () => {
        const path = uploadPath(id);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        let size = 0;
        try {
          size = (await stat(path)).size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (offset + bytes.length > IMAGE_REFERENCE_MAX_BYTES)
          throw new ImageGenerationError("reference_too_large", "Reference exceeds 50 MiB");
        if (offset < size) {
          const existing = await readFile(path);
          if (!Buffer.from(bytes).equals(existing.subarray(offset, offset + bytes.length)))
            throw new ImageGenerationError(
              "upload_conflict",
              "Upload chunk differs from the accepted bytes",
            );
        } else {
          if (offset !== size)
            throw new ImageGenerationError(
              "upload_offset",
              "Upload offset does not match the accepted bytes",
            );
          const handle = await open(path, "a", 0o600);
          try {
            await handle.writeFile(bytes);
          } finally {
            await handle.close();
          }
        }
        return final ? new Uint8Array(await readFile(path)) : undefined;
      });
    },
    async removeUpload(id) {
      await rm(uploadPath(id), { force: true });
    },
    async exportImage(artifact, bytes) {
      const root = await realpath(options.workspace);
      let directory = root;
      for (const segment of ["output", "qwen-image"]) {
        const target = join(directory, segment);
        try {
          await mkdir(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        directory = await realpath(target);
        if (!within(root, directory))
          throw new ImageGenerationError(
            "path_denied",
            "Image export directory must remain within the workspace",
          );
      }
      const extension = artifact.mimeType === "image/png" ? "png" : "jpg";
      const path = join(
        directory,
        `qwen-${basename(artifact.id)}-${randomUUID().slice(0, 8)}.${extension}`,
      );
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      return path;
    },
  };
}
