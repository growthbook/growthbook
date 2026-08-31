import { PiCodeBlock, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";

export function SchemaCopyButton({
  value,
  idleTooltip,
}: {
  value: string;
  idleTooltip: string;
}) {
  const { copySuccess, performCopy, copySupported } = useCopyToClipboard({
    timeout: 2000,
  });
  if (!copySupported) return null;
  return (
    <Tooltip
      content={copySuccess ? "Copied" : idleTooltip}
      disableHoverableContent
    >
      <Button
        variant="ghost"
        size="sm"
        color="inherit"
        stopPropagation
        aria-label={idleTooltip}
        onClick={() => performCopy(value)}
      >
        <PiCopy size={14} />
      </Button>
    </Tooltip>
  );
}

export function SchemaSqlInsertButton({
  tooltip,
  onClick,
}: {
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip} disableHoverableContent>
      <Button
        variant="ghost"
        size="sm"
        color="inherit"
        stopPropagation
        aria-label={tooltip}
        onClick={onClick}
      >
        <PiCodeBlock size={14} />
      </Button>
    </Tooltip>
  );
}
