import { useState } from "react";

export const KEEP_EXISTING_PLACEHOLDER = "(Keep existing)";

export function useCanKeepExistingCredentials(
  existing: boolean,
  authMethod: string,
): boolean {
  const [initialAuthMethod] = useState(authMethod);
  return existing && authMethod === initialAuthMethod;
}
