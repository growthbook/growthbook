export const PUBLIC_STREAM_ERROR =
  "The assistant ran into an unexpected error. Please try again.";

// The AI SDK's APICallError carries the provider's HTTP status; a RetryError
// wraps the last one.
function getProviderStatus(err: unknown): number | undefined {
  const cause =
    err && typeof err === "object" && "lastError" in err ? err.lastError : err;
  if (!cause || typeof cause !== "object" || !("statusCode" in cause)) {
    return undefined;
  }
  return typeof cause.statusCode === "number" ? cause.statusCode : undefined;
}

// Provider failures an admin can fix get a specific message; anything else
// stays generic so internal details don't leak into the chat. The fix may be in
// settings or env vars, and the reader may not be an admin, so don't name one.
export function getPublicAIErrorMessage(err: unknown): string {
  const status = getProviderStatus(err);
  if (status === 401 || status === 403) {
    return "The AI provider rejected the API key. Ask an admin to check it.";
  }
  if (status === 404) {
    return "The AI provider couldn't find this model. Ask an admin to check the AI model settings.";
  }
  return PUBLIC_STREAM_ERROR;
}
