import { useRef } from "react";
import isEqual from "lodash/isEqual";

export function useDeepStableValue<T>(value: T): T {
  const ref = useRef(value);
  if (!isEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}
