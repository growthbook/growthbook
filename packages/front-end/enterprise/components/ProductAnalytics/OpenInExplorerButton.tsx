import Link from "next/link";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";

export default function OpenInExplorerButton({
  href,
  tooltip,
  enabled,
  disabledReason = null,
}: {
  href: string;
  tooltip: string;
  enabled: boolean;
  disabledReason?: string | null;
}) {
  if (!enabled) return null;

  const button = (
    <Button
      variant="outline"
      size="md"
      disabled={!!disabledReason}
      preventDefault={false}
      style={disabledReason ? { pointerEvents: "none" } : undefined}
    >
      Open in Explorer
    </Button>
  );

  return (
    <Tooltip content={disabledReason ?? tooltip}>
      {disabledReason ? (
        <span style={{ cursor: "not-allowed" }}>{button}</span>
      ) : (
        <Link href={href}>{button}</Link>
      )}
    </Tooltip>
  );
}
