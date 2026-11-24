import { referencedWebhookSecrets } from "shared/validators";

export function parseHeaders(headers: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(headers);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    // Not JSON yet.
  }
  return {};
}

// Header names are case-insensitive.
function findHeader(headers: Record<string, string>, name: string) {
  return Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
}

// The secret a header is set to, when it is exactly one `{{ KEY }}` reference.
export function headerSecretKey(
  headers: Record<string, string>,
  name: string,
): string {
  const value = headers[findHeader(headers, name) ?? ""] ?? "";
  const keys = referencedWebhookSecrets(value);
  return keys.length === 1 && value.replace(/\s/g, "") === `{{${keys[0]}}}`
    ? keys[0]
    : "";
}

export function withHeaderSecret(
  headers: string,
  name: string,
  secretKey: string,
): string {
  const parsed = parseHeaders(headers);
  const existing = findHeader(parsed, name);
  if (existing) delete parsed[existing];
  return JSON.stringify({ ...parsed, [name]: `{{ ${secretKey} }}` });
}
