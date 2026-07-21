import LinkButton from "@/ui/LinkButton";
import Tooltip from "@/ui/Tooltip";

export default function OpenInExplorerButton({
  href,
  tooltip,
  enabled,
}: {
  href: string;
  tooltip: string;
  enabled: boolean;
}) {
  if (!enabled) return null;

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
