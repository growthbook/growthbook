import {
  ApiErrorCode,
  ApiErrorDetails,
  apiErrorRegistry,
} from "shared/validators";

export abstract class ApiError<C extends ApiErrorCode> extends Error {
  readonly code: C;
  readonly status: number;
  readonly details: ApiErrorDetails<C>;

  constructor(code: C, message: string, details: ApiErrorDetails<C>) {
    super(message);
    this.code = code;
    this.status = apiErrorRegistry[code].status;
    this.details = details;
    this.name = "ApiError";
  }
}

export class ChecklistIncompleteError extends ApiError<"checklist_incomplete"> {
  constructor(
    message: string,
    remainingChecklistItems: ApiErrorDetails<"checklist_incomplete">["remainingChecklistItems"],
  ) {
    super("checklist_incomplete", message, { remainingChecklistItems });
    this.name = "ChecklistIncompleteError";
  }
}

// Message is supplied by the caller (typically via formatPendingDraftFailureMessage
// in services/experiment-feature) to keep this module free of back-end imports
// — errors.ts is loaded by licenseUtil and other low-level modules.
export class PendingDraftPublishFailedError extends ApiError<"pending_draft_publish_failed"> {
  constructor(
    message: string,
    failedFeatureDrafts: ApiErrorDetails<"pending_draft_publish_failed">["failedFeatureDrafts"],
  ) {
    super("pending_draft_publish_failed", message, { failedFeatureDrafts });
    this.name = "PendingDraftPublishFailedError";
  }
}

export class InvalidStatusError extends ApiError<"invalid_status"> {
  constructor(
    message: string,
    currentStatus: string,
    expectedStatuses: string[],
  ) {
    super("invalid_status", message, {
      currentStatus,
      expectedStatuses,
    });
    this.name = "InvalidStatusError";
  }
}

export class MissingDatasourceParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingDatasourceParamsError";
  }
}

export class DataSourceNotSupportedError extends Error {
  constructor() {
    super("This data source is not supported yet.");
    this.name = "DataSourceNotSupportedError";
  }
}

export class SQLExecutionError extends Error {
  query: string;
  constructor(message: string, query: string) {
    super(message);
    this.name = "SQLExecutionError";
    this.query = query;
  }
}

export class UnrecoverableApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableApiError";
  }
}

export class LicenseServerError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "LicenseServerError";
  }
}

export class VercelInstallationNotFound extends Error {}

export class BadRequestError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class PlanDoesNotAllowError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PlanDoesNotAllowError";
  }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message?: string) {
    super(message ?? "Not found");
    this.name = "NotFoundError";
  }
}

// Generic 409. Stays as a plain Error so the response body is just `{ message }`
// — preserving the legacy shape for callers that don't have structured conflict
// details (e.g. namespace endpoints). Use MergeConflictError for callers that
// do have a list of conflicts to surface.
export class ConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class MergeConflictError extends ApiError<"conflict"> {
  constructor(message: string, conflicts: unknown[]) {
    super("conflict", message, { conflicts });
    this.name = "MergeConflictError";
  }
}

export class SoftWarningError extends Error {
  status = 422;
  warnings: string[];
  constructor(message: string, warnings: string[]) {
    super(message);
    this.name = "SoftWarningError";
    this.warnings = warnings;
  }
}

// A publish failure that cannot become publishable on a later tick — a stale
// experiment-guard fingerprint (the acknowledged conflict set no longer matches)
// or a missing arming user. Thrown from a publish path so the scheduled-publish
// poller gives up on the FIRST occurrence — parks the draft and fires
// `revision.publishFailed` — instead of retrying to the attempt cap. Failures a
// later tick could still resolve (merge conflicts, an incomplete pre-launch
// checklist, a schema/invariant violation the config's schema or value may yet
// be edited to satisfy) stay ordinary errors and retry to the cap. The
// `terminalPublishFailure` flag lets the classifier recognize it even across
// module/re-throw boundaries where `instanceof` can be unreliable. Still a 400
// for synchronous (manual) callers.
export class TerminalPublishError extends Error {
  status = 400;
  readonly terminalPublishFailure = true;
  constructor(message: string) {
    super(message);
    this.name = "TerminalPublishError";
  }
}

export function isTerminalPublishError(error: unknown): boolean {
  if (error instanceof TerminalPublishError) return true;
  return (
    !!error &&
    typeof error === "object" &&
    (error as { terminalPublishFailure?: unknown }).terminalPublishFailure ===
      true
  );
}

export class InternalServerError extends Error {
  status = 500;
  constructor(message: string) {
    super(message);
    this.name = "InternalServerError";
  }
}

export class ConcurrentIncrementalRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentIncrementalRefreshError";
  }
}

// Another advance holds a ramp schedule's advance lock. Transient: callers
// either retry briefly (user-initiated actions) or defer to the scheduler.
export class RampAdvanceLockBusyError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "RampAdvanceLockBusyError";
  }
}

export class ExperimentIncrementalPipelineRequiresFullRefreshError extends Error {
  readonly status = 409;
  readonly code = "requires_full_refresh";
  readonly details: { reason: string };
  constructor(reason: string) {
    super(reason);
    this.name = "ExperimentIncrementalPipelineRequiresFullRefreshError";
    this.details = { reason };
  }
}

// Snapshot failures that repeat on every retry; auto-updates get disabled, even for bandits
export class UnrecoverableSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableSnapshotError";
  }
}

// Some errors are part of normal operation and shouldn't pollute
// error-level logs or Sentry. Add cases here as we identify them.
export function shouldSkipErrorLog(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  // express-jwt wraps the underlying jsonwebtoken error under `inner`.
  // A TokenExpiredError fires every time a logged-in tab makes a request
  // after its JWT lifespan; the front-end silently refreshes and retries.
  const inner = (err as { inner?: { name?: string } }).inner;
  if (inner?.name === "TokenExpiredError") return true;

  return false;
}

export function getErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
    if (message != null) return String(message);
  }
  if (error == null) return fallback ?? "Unknown error";
  return fallback ?? String(error);
}
