import { app } from "electron";
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 必须先于 services 的环境路径快照执行；Preview 身份本身不隔离业务数据。
// 仅定制包元数据开启，不改变官方构建，也不修改用户的真实 HOME。
if (app.isPackaged) {
  const metadata = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
  if (metadata.zcodeImageWorkbench === true) {
    const profile = join(homedir(), ".zcode-profiles", "qwen-image");
    process.env.ZCODE_DATA_BASE_DIR ||= profile;
    process.env.ZCODE_DESKTOP_HOME_DIR ||= profile;
    process.env.ZCODE_STORAGE_DIR ||= join(profile, ".zcode");
    process.env.ZCODE_SESSION_DB_PATH ||= join(process.env.ZCODE_STORAGE_DIR, "sessions.sqlite");
    process.env.ZCODE_LOG_DIR ||= join(process.env.ZCODE_STORAGE_DIR, "cli", "log");
    mkdirSync(process.env.ZCODE_DESKTOP_HOME_DIR, { recursive: true });
  }
}
