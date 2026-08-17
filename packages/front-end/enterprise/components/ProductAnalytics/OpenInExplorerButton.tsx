import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
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

  if (disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <span style={{ cursor: "not-allowed" }}>
          <Button
            variant="outline"
            size="sm"
            disabled
            style={{ pointerEvents: "none" }}
          >
            Open in Explorer
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={tooltip}>
      <LinkButton
        href={href}
        variant="outline"
        size="sm"
        preventDefault={false}
      >
        Open in Explorer
      </LinkButton>
    </Tooltip>
  );
}
