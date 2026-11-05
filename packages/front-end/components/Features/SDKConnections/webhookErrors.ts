// A webhook's last error is the endpoint's response body (often JSON, sometimes
// HTML) or a short failure message. Pull out something readable, and keep the
// body when it says more than the message.
export function describeWebhookError(error: string): {
  message: string;
  body: string | null;
} {
  const text = error.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object") {
    const message = findMessage(parsed as Record<string, unknown>);
    return {
      message: message ?? "The endpoint returned an error.",
      body: JSON.stringify(parsed, null, 2),
    };
  }
  if (/^<(!doctype|html)/i.test(text)) {
    return { message: "The endpoint returned an HTML page.", body: text };
  }
  return { message: text, body: null };
}

function findMessage(body: Record<string, unknown>): string | null {
  const nested = body.error;
  const candidates = [
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).message
      : nested,
    body.message,
    Array.isArray(body.errors)
      ? (body.errors[0] as Record<string, unknown> | undefined)?.message
      : undefined,
    body.detail,
    body.title,
  ];
  const found = candidates.find((c) => typeof c === "string" && c.trim());
  return typeof found === "string" ? found : null;
}
