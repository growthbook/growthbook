import { apiErrorRegistry } from "shared/validators";

// Thrown by apiCall so callers can read the structured code/details off a failed response.
export class ApiCallError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    responseData: { message?: string; code?: string; details?: unknown },
    fallbackMessage = "There was an error",
  ) {
    super(responseData.message || fallbackMessage);
    this.name = "ApiCallError";
    this.code = responseData.code;
    this.details = responseData.details;
  }
}

// Technical context for an error message, shown collapsed so users can share it.
export function getErrorDetails(e: unknown): string | null {
  if (!(e instanceof ApiCallError) || e.code !== "custom_hook_error") {
    return null;
  }
  const parsed = apiErrorRegistry.custom_hook_error.detailsSchema.safeParse(
    e.details,
  );
  if (!parsed.success) return null;

  const blocks = parsed.data.hooks
    .map((hook) => {
      const lines: string[] = [];
      if (!hook.rejected) lines.push(hook.stack || hook.message);
      if (hook.log) lines.push(`Console output:\n${hook.log}`);
      return lines.length
        ? [`Hook: ${hook.hookName}`, ...lines].join("\n")
        : "";
    })
    .filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : null;
}
