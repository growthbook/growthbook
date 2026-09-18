export class ErrorWrapper extends Error {
  constructor(
    customMessage: string,
    { message, stack }: { message: string; stack?: string },
  ) {
    super(customMessage);
    this.name = customMessage;
    this.message = message;
    this.stack = stack;
  }
}

export class PermissionError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

// Thrown when the API answers with something other than JSON, e.g. an auth proxy (Google IAP) responding in plain text after its session expired
export class NonJsonResponseError extends Error {
  status: number;
  constructor(status: number) {
    super(
      status === 401 || status === 403
        ? "Your network sign-in session has expired. Reload the page to continue."
        : `The API returned an invalid response (HTTP ${status})`,
    );
    this.name = "NonJsonResponseError";
    this.status = status;
  }
}
