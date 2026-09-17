// Return navigation accepts only paths within the application.
export function getSafeReturnUrl(
  value: unknown,
  fallback = "/metrics",
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  const origin = "https://app.invalid";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname.startsWith("//")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
