import { useEffect, useRef, useState } from "react";
import type { ImageGenerationSettings } from "@zcode/shared/image-generation";
import { Button } from "@/components/ui/button.js";
import { useImageProviders } from "@/hooks/useImageProviders.js";
import { imageControlClass } from "./ImageControls.js";

export function ImageProviderSettings({
  settings,
  configure,
  disabled,
  zh,
}: {
  settings: ImageGenerationSettings;
  configure(settings: ImageGenerationSettings): Promise<unknown>;
  disabled: boolean;
  zh: boolean;
}) {
  const providers = useImageProviders();
  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const [editing, setEditing] = useState<"new" | "existing">();
  const [name, setName] = useState("Qwen Image");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(settings.model);
  const selected = providers.providers.find(
    (provider) => provider.providerId === settings.providerId,
  );
  useEffect(() => setModel(settings.model), [settings.model]);
  const edit = (mode: "new" | "existing") => {
    setEditing(mode);
    setName(mode === "existing" ? selected?.providerName || "Qwen Image" : "Qwen Image");
    setBaseUrl(mode === "existing" ? selected?.effectiveConfig.api?.baseUrl || "" : "");
    setKey("");
  };
  return (
    <div className="min-w-0 space-y-4">
      <fieldset
        disabled={disabled || providers.saving}
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        <select
          className={imageControlClass}
          aria-label={zh ? "生图服务" : "Image provider"}
          value={settings.providerId ?? ""}
          onChange={(event) => {
            setEditing(undefined);
            void configure({ ...settings, providerId: event.target.value || undefined });
          }}
        >
          <option value="">{zh ? "选择独立生图服务" : "Select image provider"}</option>
          {settings.providerId && !selected && (
            <option value={settings.providerId}>
              {providers.state.status === "loading"
                ? zh
                  ? "正在加载服务…"
                  : "Loading provider…"
                : zh
                  ? "服务不可用，请重新选择"
                  : "Provider unavailable — select another"}
            </option>
          )}
          {providers.providers.map((provider) => (
            <option
              key={provider.providerId}
              value={provider.providerId}
              disabled={!provider.enabled || provider.issues.length > 0}
            >
              {provider.providerName || provider.providerId}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => edit("new")}>
          {zh ? "添加生图服务" : "Add image provider"}
        </Button>
        {selected?.personalConfig && (
          <Button size="sm" variant="ghost" onClick={() => edit("existing")}>
            {zh ? "配置服务" : "Configure provider"}
          </Button>
        )}
        <input
          className={imageControlClass}
          aria-label={zh ? "生图模型" : "Image model"}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => {
            if (model.trim() && model.trim() !== settings.model)
              void configure({ ...settings, model: model.trim() });
          }}
        />
      </fieldset>
      {editing && (
        <fieldset
          disabled={disabled || providers.saving}
          className="flex min-w-0 flex-col items-stretch gap-3 border-t border-border pt-4"
          data-testid="image-provider-form"
        >
          <label className="min-w-0 text-ui-caption">
            {zh ? "名称" : "Name"}
            <input
              className={`${imageControlClass} mt-1 block w-full`}
              aria-label={zh ? "生图服务名称" : "Image provider name"}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="min-w-0 text-ui-caption">
            {zh ? "服务地址" : "Base URL"}
            <input
              className={`${imageControlClass} mt-1 block w-full`}
              aria-label={zh ? "生图服务地址" : "Image provider URL"}
              placeholder="https://images.example/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="min-w-0 text-ui-caption">
            API key
            <input
              type="password"
              autoComplete="off"
              className={`${imageControlClass} mt-1 block w-full`}
              aria-label={zh ? "生图服务 API key" : "Image provider API key"}
              placeholder={
                editing === "existing"
                  ? zh
                    ? "留空保留已保存密钥"
                    : "Leave blank to keep saved key"
                  : ""
              }
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={!baseUrl.trim() || (editing === "new" && !key.trim())}
            onClick={async () => {
              const id = await providers.save({
                providerId: editing === "existing" ? selected?.providerId : undefined,
                name,
                baseUrl,
                apiKey: key,
              });
              if (id) {
                setKey("");
                setEditing(undefined);
                await configure({ ...latestSettings.current, providerId: id });
              }
            }}
          >
            {zh ? "保存生图服务" : "Save image provider"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(undefined);
              setKey("");
            }}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
        </fieldset>
      )}
      {(!settings.providerId || providers.state.status === "error") && (
        <p className="text-ui-caption text-foreground-subtle">
          {zh
            ? "生图使用独立服务配置。请选择或添加服务。"
            : "Images use an independent connection. Select or add a provider."}
        </p>
      )}
      {providers.error && (
        <p role="alert" className="text-ui-caption text-destructive">
          {providers.error}
        </p>
      )}
    </div>
  );
}
