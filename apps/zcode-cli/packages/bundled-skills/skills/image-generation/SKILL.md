---
name: image-generation
description: Generate or edit images using ZCode's native GenerateImage tool and image workbench. Use for new illustrations, photos, diagrams, transparent assets and iterative image adjustments when the tool is enabled.
---

# Native image generation

Use `GenerateImage` when available. Do not write a separate HTTP client or run a
shell image-generation script. Desktop/Web show the result and controls in the native workbench. In CLI/TUI,
report the returned image ID and local artifact path; never claim a workbench
was opened in a terminal session.

- New picture: `operation: generate`. Existing picture or references: `edit`.
- Describe subject, composition, style and requested text clearly. Keep exact
  user-provided text. For edits state both the change and what must stay unchanged.
- Reference up to five images in order as Picture 1 through Picture 5. Use returned
  image IDs or readable workspace files. The edit target counts as one image.
- Respect the output-size safety limit, including an automatically inserted parent:
  at most 5 references up to 2,359,296 pixels (1536x1536); 3 up to 3,211,264
  (1792x1792); 2 at larger supported sizes, including 2048x2048
  and the maximum non-square dimensions. These limits qualify
  the current A40/offload deployment; the API maximum is not a VRAM guarantee.
  If over the limit, ask the user to select fewer references or a lower output size;
  never silently discard images, lower the requested size, or bypass the native tool.
- For a narrow change, prefer only the target image. Add further references only
  when the user needs them, and describe each reference role. More references can
  change composition or object counts; inspect the result before claiming preservation.
- For a follow-up edit, pass the preceding result's `jobId` as `parentId`. Omit it
  from `references` unless explicitly setting the full reference order. The tool
  inserts a missing parent first. Never send a different conversation's image ID.
- Default to 1024x1024. Use smaller sizes for drafts and a supported aspect ratio
  when composition requires it. Hardware safety is not implied by a maximum size.
- One image per call, 40 steps. Request multiple finished pictures sequentially.
- Transparent assets require PNG and explicit transparency wording. The tool
  uploads original reference bytes and Alpha. Explicit transparent output is inherited
  by subsequent edits.
- Omit `seed` for an edit to obtain a new seed; specify it only for an intentional
  reproducibility request. Reusing a generation seed may degrade an edit.
- Do not read Base64 into context. Do not claim you saw or inspected the result
  unless a vision-capable tool actually inspected it. Explain only verified facts.
- Report the result path and refer the user to the workbench. If disabled or a
  provider is unavailable, explain the configuration needed; never silently switch
  providers or repeat a failed generation request.

The tool is enabled in the image workbench or with `imageGeneration.enabled` in
the CLI configuration. Set `imageGeneration.providerId` to an independently configured API-key provider.
The conversation provider is never used as a fallback. Keys remain private.

For regional repainting, use `mask` with a session artifact ID or a workspace PNG
path. Transparent mask pixels are edited; opaque pixels are preserved. The mask
must match Picture 1 and the output dimensions; output must be PNG. Keep the
parent target first when specifying references. The workbench supports painting,
erasing, undo and selecting other generated images from the current session.
Qwen uses visual selection guidance and Host compositing, not a native diffusion
mask API. Pixels outside the selection are preserved; inspect the generated area
before claiming that it matches the requested change.
