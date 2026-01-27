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

export class InternalServerError extends Error {
  status = 500;
  constructor(message: string) {
    super(message);
    this.name = "InternalServerError";
  }
}
