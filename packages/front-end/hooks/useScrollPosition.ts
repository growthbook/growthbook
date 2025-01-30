import { useEffect, useState } from "react";

export function useScrollPosition() {
  const [scrollPosition, setScrollPosition] = useState({
    scrollX: globalThis?.window?.pageXOffset || 0,
    scrollY: globalThis?.window?.pageYOffset || 0,
  });
  useEffect(() => {
    function onScroll() {
      setScrollPosition({
        scrollX: globalThis?.window?.pageXOffset || 0,
        scrollY: globalThis?.window?.pageYOffset || 0,
      });
    }

    globalThis?.window?.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis?.window?.removeEventListener("scroll", onScroll);
  }, []);
  return scrollPosition;
}
