import { PiArrowSquareOut } from "react-icons/pi";
import Link from "@/ui/Link";
import { useContextualBandits } from "@/hooks/useContextualBandits";

/** Resolves a CB id to a link, falling back to the raw id if not in the SWR cache. */
export default function ContextualBanditLink({
  contextualBanditId,
}: {
  contextualBanditId: string | undefined;
}) {
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
