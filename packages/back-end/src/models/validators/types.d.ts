/**
 * Format for validating Mongoose properties.
 */
export interface PropertyValidator {
  (value: unknown): boolean;
}
