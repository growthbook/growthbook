import clsx from "clsx";
import {
  ComponentPropsWithoutRef,
  forwardRef,
  MouseEvent,
  ReactNode,
} from "react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { CopyIcon } from "@/ui/ActionIcons";
import Tooltip from "@/ui/Tooltip";

type Props = Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-label" | "onClick"
> & {
  label: string;
  // Shown instead of the label, e.g. "Copied".
  tooltip?: ReactNode;
  tooltipOpen?: boolean;
  onClick?: () => void;
  // Hidden until the field is hovered or focused.
  reveal?: boolean;
  // A select's own indicator class, in place of the field one.
  className?: string;
};

// Neither focuses the field nor opens a select's menu.
function swallow(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * An icon button inside a field's box, acting on its value. Also a menu's
 * `trigger`, which passes its own props through.
 */
const FieldIndicator = forwardRef<HTMLButtonElement, Props>(
  function FieldIndicator(
    {
      label,
      tooltip,
      tooltipOpen,
      onClick,
      reveal = false,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <Tooltip content={tooltip ?? label} open={tooltipOpen}>
        <button
          ref={ref}
          type="button"
          {...props}
          className={clsx(
            className || "gb-field-indicator",
            reveal && "gb-field-indicator--reveal",
          )}
          aria-label={label}
          onMouseDown={swallow}
          onClick={(e) => {
            swallow(e);
            onClick?.();
          }}
        >
          {children}
        </button>
      </Tooltip>
    );
  },
);
export default FieldIndicator;

export function CopyFieldIndicator({
  value,
  reveal,
  className,
}: {
  value: string;
  reveal?: boolean;
  className?: string;
}) {
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 800 });
  return (
    <FieldIndicator
      label="Copy to clipboard"
      tooltip={copySuccess ? "Copied" : undefined}
      tooltipOpen={copySuccess || undefined}
      onClick={() => {
        if (!copySuccess) performCopy(value);
      }}
      reveal={reveal}
      className={className}
    >
      <CopyIcon copied={copySuccess} />
    </FieldIndicator>
  );
}

/**
 * A multi-line field's indicators, in its bottom-right corner. The field's
 * box needs the `gb-field-indicator-host` class.
 */
export function FieldIndicatorCorner({
  right = 14,
  children,
}: {
  // Clear of a resize grip.
  right?: number;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        position: "absolute",
        bottom: 4,
        right,
        display: "flex",
        alignItems: "center",
        // Above a code editor's own layers.
        zIndex: 1000,
      }}
    >
      {children}
    </span>
  );
}
