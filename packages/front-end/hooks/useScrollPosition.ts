import { useEffect, useState } from "react";

export function useScrollPosition() {
  const [scrollPosition, setScrollPosition] = useState({
    scrollX: window.pageXOffset,
    scrollY: window.pageYOffset,
  });
  useEffect(() => {
    function onScroll() {
      setScrollPosition({
        scrollX: window.pageXOffset,
        scrollY: window.pageYOffset,
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrollPosition;
}
