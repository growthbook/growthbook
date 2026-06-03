import React from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import Link from "@/ui/Link";
import { useContextualBandits } from "@/hooks/useContextualBandits";

/**
 * Resolves a CB id to its display name and renders it as a link.
 * Falls back to the raw id if not found in the local SWR cache.
 *
 * Routes to `/contextual-bandit/${cb.experiment ?? cbId}` during the
 * decoupling window — the detail page still fetches `/experiment/${id}`,
 * so the link target uses the paired experiment FK when present. PR-6's
 * detail-page fork will simplify this to `/contextual-bandit/${cbId}`.
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
  const detailId = cb?.experiment ?? contextualBanditId;
  return (
    <Link href={`/contextual-bandit/${detailId}`} target="_blank">
      {cb?.name ?? contextualBanditId}
      <PiArrowSquareOut style={{ marginLeft: 3, verticalAlign: "middle" }} />
    </Link>
  );
}
