import React from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import Link from "@/ui/Link";
import { useContextualBandits } from "@/hooks/useContextualBandits";

/**
 * Resolves a CB id to its display name and renders it as a link.
 * Falls back to the raw id if not found in the local SWR cache.
 *
 * Parallel to the local `ExperimentLink` in `FeatureDiffRenders.tsx` —
 * extracted to a shared component so feature-rule renderers (diff view,
 * rule list) can share one implementation.
 */
export default function ContextualBanditLink({
  contextualBanditId,
}: {
  contextualBanditId: string | undefined;
}) {
  // Pull all CBs from the SWR cache; the page-level hook deduplicates
  // requests, so this is cheap relative to a per-id fetch and keeps the
  // link component synchronous.
  const { contextualBanditsMap } = useContextualBandits();

  if (!contextualBanditId) return <em>unset</em>;
  const cb = contextualBanditsMap?.get(contextualBanditId);
  return (
    <Link href={`/contextual-bandit/${contextualBanditId}`} target="_blank">
      {cb?.name ?? contextualBanditId}
      <PiArrowSquareOut style={{ marginLeft: 3, verticalAlign: "middle" }} />
    </Link>
  );
}
