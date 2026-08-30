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
