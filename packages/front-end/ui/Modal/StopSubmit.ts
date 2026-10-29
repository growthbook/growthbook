// Thrown from a modal's submit to keep it open without an error, scroll, or
// error tracking, e.g. to reveal a warning the user must acknowledge first.
export class StopSubmit extends Error {}
