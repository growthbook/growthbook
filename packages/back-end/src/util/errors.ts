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

export class ConflictError extends Error {
  status = 409;
  conflicts?: unknown[];
  constructor(message: string, conflicts?: unknown[]) {
    super(message);
    this.name = "ConflictError";
    this.conflicts = conflicts;
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
