import { useEffect, useState } from "react";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";

/**
 * Whether the docked AI panel leaves less page area (the window less the side
 * nav and the panel) than `minWidth`, for a page to take its narrow layout on
 * a wide window too. Only while the panel is docked, so without it nothing
 * changes; a narrow window is the page's own media queries' to handle.
 *
 * It measures a probe sized to --page-area-width at the document's root,
 * outside the page, so the page's own layout never changes what it measures
 * and can't flip it back and forth. It follows the panel's target width (set
 * on the root as its slide starts) and the side nav's, not their animations.
 */
export default function usePageAreaCrowded(
  minWidth: number,
  enabled = true,
): boolean {
  const { docked, open } = useAgentPanel();
  const active = enabled && docked && open;
  const [tooNarrow, setTooNarrow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    Object.assign(probe.style, {
      position: "fixed",
      top: "0",
      left: "0",
      height: "0",
      width: "var(--page-area-width)",
      visibility: "hidden",
      pointerEvents: "none",
    });
    document.body.appendChild(probe);
    const observer = new ResizeObserver(([entry]) =>
      setTooNarrow(entry.contentRect.width < minWidth),
    );
    observer.observe(probe);
    return () => {
      observer.disconnect();
      probe.remove();
      // The next docked panel measures afresh.
      setTooNarrow(false);
    };
  }, [minWidth, active]);
  return active && tooNarrow;
}
