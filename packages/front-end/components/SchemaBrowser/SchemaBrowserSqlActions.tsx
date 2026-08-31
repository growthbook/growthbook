import { PiCodeBlock, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import styles from "./SchemaBrowserSqlActions.module.scss";

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
  disabledTooltip,
  disabled = false,
  onClick,
}: {
  tooltip: string;
  disabledTooltip?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip
      content={disabled && disabledTooltip ? disabledTooltip : tooltip}
      disableHoverableContent
    >
      <Button
        variant="ghost"
        size="sm"
        color="inherit"
        stopPropagation
        aria-label={tooltip}
        aria-disabled={disabled}
        className={disabled ? styles.disabledInsert : undefined}
        onClick={() => {
          if (disabled) return;
          onClick();
        }}
      >
        <PiCodeBlock size={14} />
      </Button>
    </Tooltip>
  );
}
