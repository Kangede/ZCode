import base from "../../packages/desktop/electron-builder.config.js";

// 此入口只服务个人 fork 的 Qwen 发行，不改变上游的签名/产品配置。
export default {
  ...base,
  extraMetadata: { ...base.extraMetadata, zcodeImageWorkbench: true },
  publish: null,
  linux: {
    ...base.linux,
    target: ["AppImage", "deb"],
    artifactName: "ZCode-Qwen-${version}-linux-${arch}.${ext}",
  },
  win: {
    ...base.win,
    artifactName: "ZCode-Qwen-${version}-windows-${arch}-Setup.${ext}",
  },
  mac: {
    ...base.mac,
    artifactName: "ZCode-Qwen-${version}-macOS-${arch}.${ext}",
    // Apple Silicon 需要有效代码签名；ad-hoc 不提供开发者身份或公证信任。
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
    signIgnore: [],
  },
};
