/** Preserve non-image payloads and object identity when a legacy projection is unchanged. */
export function withoutImageGenerationDisplay<T>(value: T): T {
  if (Array.isArray(value)) {
    const next = value.map(withoutImageGenerationDisplay);
    return (next.some((child, index) => child !== value[index]) ? next : value) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "display" &&
      child &&
      typeof child === "object" &&
      "kind" in child &&
      child.kind === "image_generation"
    ) {
      changed = true;
      continue;
    }
    result[key] = withoutImageGenerationDisplay(child);
    changed ||= result[key] !== child;
  }
  return changed ? (result as T) : value;
}
