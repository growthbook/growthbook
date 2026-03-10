import { useEffect, useCallback } from "react";

/**
 * Trigger a callback when one or more keys are pressed.
 * @param keys - A single key string or an array of key strings to listen for
 * @param callback - Function to call when any of the specified keys is pressed
 */
export function useKeydown(
  keys: string | string[],
  callback: (event: KeyboardEvent) => void,
): void {
  const handleKeydown = useCallback(
    (event: KeyboardEvent) => {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      if (keyArray.includes(event.key)) {
        callback(event);
      }
    },
    [keys, callback],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [handleKeydown]);
}
