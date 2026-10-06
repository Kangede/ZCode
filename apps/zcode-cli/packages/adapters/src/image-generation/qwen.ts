import {
  ImageGenerationError,
  type HttpClientPort,
  type ImageGenerationAdapter,
} from "@zcode/contracts";
import {
  IMAGE_BODY_MAX_BYTES,
  IMAGE_REFERENCE_MAX_BYTES,
  IMAGE_RESPONSE_MAX_BYTES,
  imageGenerationInputSchema,
  getImageReferenceCapacity,
  imageReferenceCapacityMessage,
} from "@zcode/shared/image-generation";
import { decodeImageBase64, inspectImage, encodeImageJpeg } from "./binary.js";
import { prepareRepaint } from "./repaint.js";

export function normalizeImagesBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ImageGenerationError(
      "invalid_provider",
      "Images provider requires an HTTP(S) base URL without credentials or query parameters",
    );
  }
  // URL.pathname 将空字符串还原为斜杠；先在普通字符串上拼接以免根地址生成 //v1。
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  return url.toString().replace(/\/$/, "");
}

function assertHttpSuccess(status: number): void {
  if (status >= 200 && status < 300) return;
  const code =
    (
      {
        401: "unauthorized",
        403: "forbidden",
        404: "model_not_found",
        429: "rate_limited",
      } as Record<number, string>
    )[status] ?? "upstream_error";
  // 上游响应可能回显鉴权头或上传数据；用户面只返回状态分类，不拼接任意错误正文。
  throw new ImageGenerationError(
    code,
    `Images API returned HTTP ${status}. The request was not retried.`,
    status,
  );
}

export function createQwenImageAdapter(http: HttpClientPort): ImageGenerationAdapter {
  return {
    async generate(options) {
      const request = imageGenerationInputSchema.parse(options.request);
      const capacity = getImageReferenceCapacity(request);
      // 五图是协议上限，不是任意分辨率下的显存安全上限；独立调用适配器也必须拦截。
      if (capacity.exceeded)
        throw new ImageGenerationError(
          "reference_capacity_exceeded",
          imageReferenceCapacityMessage(request.size, capacity.limit!),
        );
      if (!options.connection.apiKey)
        throw new ImageGenerationError(
          "missing_credentials",
          "Configure an API-key provider for image generation",
        );
      if (
        options.references.length !== request.references.length ||
        options.references.length > 5
      ) {
        throw new ImageGenerationError(
          "invalid_references",
          "Reference images must match the ordered request",
        );
      }
      const baseUrl = normalizeImagesBaseUrl(options.connection.baseUrl);
      if (Boolean(request.mask) !== Boolean(options.mask))
        throw new ImageGenerationError("invalid_mask", "The edit mask is missing or unexpected");
      const repaint = options.mask
        ? await prepareRepaint(options.references[0], options.mask, request.size)
        : undefined;
      const prompt = repaint ? repaint.instruction + request.prompt : request.prompt;
      const authorization = `Bearer ${options.connection.apiKey}`;
      const fields = {
        model: options.model,
        prompt:
          request.background === "transparent"
            ? `This is an RGBA image with transparency. ${prompt}\nThe image has an alpha channel and a transparent background.`
            : // 普通 PNG 的边缘 Alpha 不代表抠图意图；提及 transparency 会误导上游移除背景。
              prompt,
        n: 1,
        size: request.size,
        num_inference_steps: 40,
        seed: request.seed ?? 42,
        generator_device: "cpu",
        response_format: "b64_json",
        // 上游 RGBA 路径的 JPEG 请求实测返回 500；一次取 PNG 后在 Host 编码。
        output_format: "png",
        background: request.background ?? "auto",
        guidance_scale: request.guidanceScale,
        negative_prompt: request.negativePrompt,

        enable_cache_dit: false,
      };
      let body: Uint8Array;
      let contentType = "application/json";
      if (request.operation === "edit") {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) {
          if (value !== undefined) form.append(name, String(value));
        }
        for (const [index, originalReference] of options.references.entries()) {
          const reference = index === 0 && repaint ? repaint.reference : originalReference;
          if (reference.bytes.length > IMAGE_REFERENCE_MAX_BYTES)
            throw new ImageGenerationError("reference_too_large", "Reference image exceeds 50 MiB");
          form.append(
            "image[]",
            new Blob([Buffer.from(reference.bytes)], { type: reference.mimeType }),
            `reference-${index + 1}.${reference.mimeType === "image/png" ? "png" : "jpg"}`,
          );
        }
        const encoded = new Request(baseUrl, { method: "POST", body: form });
        contentType = encoded.headers.get("content-type")!;
        body = new Uint8Array(await encoded.arrayBuffer());
        if (body.length > IMAGE_BODY_MAX_BYTES)
          throw new ImageGenerationError("request_too_large", "Image request exceeds 256 MiB");
      } else {
        body = new TextEncoder().encode(JSON.stringify(fields));
        if (body.length > 256 * 1024)
          throw new ImageGenerationError("request_too_large", "Generation JSON exceeds 256 KiB");
      }
      const models = await http.request(
        {
          url: `${baseUrl}/models`,
          method: "GET",
          headers: { Authorization: authorization },
          timeoutMs: Math.min(15_000, options.timeoutMs),
          maxResponseBytes: 2 * 1024 * 1024,
          redirect: "manual",
          trace: options.trace,
        },
        { signal: options.signal },
      );
      assertHttpSuccess(models.status);
      let catalog: { data?: Array<{ id?: string }> };
      try {
        catalog = JSON.parse(new TextDecoder().decode(models.body));
      } catch {
        throw new ImageGenerationError("invalid_response", "Model catalog returned invalid JSON");
      }
      if (!catalog || !Array.isArray(catalog.data))
        throw new ImageGenerationError("invalid_response", "Model catalog must contain an array");
      if (!catalog.data.some((model) => model?.id === options.model)) {
        throw new ImageGenerationError(
          "model_not_found",
          "The configured image model is not advertised by this provider",
        );
      }
      const response = await http.request(
        {
          url: `${baseUrl}/images/${request.operation === "edit" ? "edits" : "generations"}`,
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": contentType },
          body,
          timeoutMs: options.timeoutMs,
          maxResponseBytes: IMAGE_RESPONSE_MAX_BYTES,
          redirect: "manual",
          trace: options.trace,
        },
        { signal: options.signal },
      );
      assertHttpSuccess(response.status);
      let payload: { data?: Array<{ b64_json?: string }> };
      try {
        payload = JSON.parse(new TextDecoder().decode(response.body));
      } catch {
        throw new ImageGenerationError("invalid_response", "Images API returned invalid JSON");
      }
      if (
        !payload ||
        !Array.isArray(payload.data) ||
        payload.data.length !== 1 ||
        typeof payload.data[0]?.b64_json !== "string"
      ) {
        throw new ImageGenerationError(
          "invalid_response",
          "Images API must return exactly one base64 image",
        );
      }
      const image = await inspectImage(
        decodeImageBase64(payload.data[0].b64_json, IMAGE_RESPONSE_MAX_BYTES),
      );
      const [width, height] = request.size.split("x").map(Number);
      if (image.width !== width || image.height !== height || image.mimeType !== "image/png") {
        throw new ImageGenerationError(
          "invalid_response",
          "Generated image dimensions or format do not match the request",
        );
      }
      const result = repaint ? await repaint.composite(image) : image;
      if (request.background === "transparent" && !result.transparent) {
        throw new ImageGenerationError(
          "missing_transparency",
          "The generated image has no transparent pixels; retry explicitly or adjust the prompt",
        );
      }
      return request.outputFormat === "jpeg"
        ? encodeImageJpeg(result, request.outputCompression ?? 90)
        : result;
    },
  };
}
