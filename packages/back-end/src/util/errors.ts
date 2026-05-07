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

// Uses ApiErrorDetails<"checklist_incomplete"> directly so we avoid importing
// StartChecklistItemStatus from changeExperimentStatus (which would create a cycle).
export class ChecklistIncompleteError extends ApiError<"checklist_incomplete"> {
  constructor(
    remainingChecklistItems: ApiErrorDetails<"checklist_incomplete">["remainingChecklistItems"],
  ) {
    super(
      "checklist_incomplete",
      "Experiment cannot be started: required checklist items are incomplete",
      { remainingChecklistItems },
    );
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

export class InvalidExperimentStatusError extends ApiError<"invalid_experiment_status"> {
  constructor(
    message: string,
    currentStatus: string,
    expectedStatuses: string[],
  ) {
    super("invalid_experiment_status", message, {
      currentStatus,
      expectedStatuses,
    });
    this.name = "InvalidExperimentStatusError";
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

export class ConflictError extends ApiError<"conflict"> {
  constructor(message: string, conflicts: unknown[] = []) {
    super("conflict", message, { conflicts });
    this.name = "ConflictError";
  }
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
