/** Public settings retain their shape, while only the Host owns saved credentials. */
export const SAVED_PROVIDER_SECRET = "********";

function secretField(key: string): boolean {
  return /^(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|authorization|proxy-authorization|x-api-key|x-auth-token|cookie|set-cookie)$/i.test(
    key,
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

export function publicProviderView<T>(value: T): T {
  if (Array.isArray(value)) return value.map(publicProviderView) as T;
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretField(key) && typeof item === "string" && item.length > 0
        ? SAVED_PROVIDER_SECRET
        : publicProviderView(item),
    ]),
  ) as T;
}

/** A round-tripped marker means keep this Provider's existing field, never another Provider's. */
export function preserveProviderSecrets<T>(draft: T, current: unknown): T {
  if (Array.isArray(draft))
    return draft.map((item, index) =>
      preserveProviderSecrets(item, Array.isArray(current) ? current[index] : undefined),
    ) as T;
  if (!record(draft)) return draft;
  return Object.fromEntries(
    Object.entries(draft).map(([key, value]) => {
      const existing = record(current)
        ? (current[key] ??
          Object.entries(current).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1])
        : undefined;
      if (secretField(key) && value === SAVED_PROVIDER_SECRET) {
        if (typeof existing !== "string" || !existing || existing === SAVED_PROVIDER_SECRET)
          throw new Error("No saved credential exists for this provider; enter a new value.");
        return [key, existing];
      }
      return [key, preserveProviderSecrets(value, existing)];
    }),
  ) as T;
}
