import { useEffect, useLayoutEffect } from "react";

/** Before paint in the browser, as a plain effect on the server. */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
