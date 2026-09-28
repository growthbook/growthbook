import { ReactNode } from "react";
import { PiCodeBlock, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";

function ActionTooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={content} disableHoverableContent>
      <span
        onClick={(e) => e.stopPropagation()}
        style={{ display: "inline-flex" }}
      >
        {children}
      </span>
    </Tooltip>
  );
}

export function SchemaCopyButton({
  value,
  tooltip,
}: {
  value: string;
  tooltip: string;
}) {
  const { copySuccess, performCopy, copySupported } = useCopyToClipboard({
    timeout: 2000,
  });
  if (!copySupported) return null;
  return (
    <ActionTooltip content={copySuccess ? "Copied" : tooltip}>
      <Button
        variant="ghost"
        size="sm"
        color="inherit"
        stopPropagation
        aria-label={tooltip}
        icon={<PiCopy size={14} />}
        onClick={() => performCopy(value)}
      >
        {null}
      </Button>
    </ActionTooltip>
  );
}

export function SchemaSqlInsertButton({
  tooltip,
  disabledTooltip,
  disabled = false,
  onClick,
}: {
  tooltip: string;
  disabledTooltip?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const label = disabled && disabledTooltip ? disabledTooltip : tooltip;
  return (
    <ActionTooltip content={label}>
      <Button
        variant="ghost"
        size="sm"
        color="inherit"
        stopPropagation
        disabled={disabled}
        aria-label={label}
        icon={<PiCodeBlock size={14} />}
        style={disabled ? { pointerEvents: "none" } : undefined}
        onClick={onClick}
      >
        {null}
      </Button>
    </ActionTooltip>
  );
}
