import semver from "semver";

export function normalizeDevelopmentAppVersion(
  app: { isPackaged: boolean; getVersion(): string },
  buildVersion: string,
): void {
  if (app.isPackaged || semver.valid(app.getVersion())) return;
  // Electron 没有 setVersion；在开发壳缺少合法版本时适配读取方法，
  // 避免 electron-updater 构造时崩溃，同时不修改发行包版本或磁盘元数据。
  const version = semver.valid(buildVersion) ? buildVersion : "0.0.0-dev";
  app.getVersion = () => version;
}
