import { RefObject, useEffect, useRef, useState } from "react";
import { TABS_HEADER_HEIGHT_PX } from "@/components/Layout/constants";

// Whether the tab bar has scrolled up under the fixed page header. Place the
// returned ref on a zero-height sentinel just above the tab bar.
export default function usePinnedHeader(
  enabled = true,
): [RefObject<HTMLDivElement>, boolean] {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      {
        root: null,
        rootMargin: `-${TABS_HEADER_HEIGHT_PX}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return [sentinelRef, pinned];
}
