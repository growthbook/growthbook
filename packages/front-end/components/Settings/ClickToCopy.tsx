import { PiCheck, PiCopy } from "react-icons/pi";
import clsx from "clsx";
import { VisuallyHidden } from "@radix-ui/themes";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";

type Props = {
  compact?: boolean;
  children?: string;
  className?: string;
  valueToCopy?: string;
  iconPosition?: "left" | "right";
};

export default function ClickToCopy({
  compact,
  children,
  className = "",
  valueToCopy,
  iconPosition = "left",
}: Props) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });
  const iconRight = iconPosition === "right";
  const copyButton = copySupported ? (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        if (valueToCopy) {
          performCopy(valueToCopy);
        } else if (children) {
          performCopy(children);
        }
      }}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      style={{
        display: "inline-flex",
        padding: 0,
        border: 0,
        background: "none",
        color: "var(--gray-11)",
        fontSize: compact ? ".95rem" : "1rem",
        cursor: "pointer",
        ...(iconRight ? { marginLeft: 6 } : {}),
      }}
    >
      {copySuccess ? <PiCheck /> : <PiCopy />}
    </button>
  ) : null;
  return (
    <div
      className={clsx("d-flex align-items-center position-relative", className)}
    >
      {!iconRight ? copyButton : null}
      {children ? (
        <span
          className={compact || iconRight ? "" : "ml-2"}
          style={
            compact ? { marginLeft: iconRight ? 0 : 2, lineHeight: 1.1 } : {}
          }
        >
          <code
            className="text-main text-break"
            style={compact ? { fontSize: ".7rem" } : {}}
          >
            {children}
          </code>
        </span>
      ) : null}
      {iconRight ? copyButton : null}

      <VisuallyHidden role="status">
        {copySuccess ? "Copied" : ""}
      </VisuallyHidden>
      {copySuccess ? (
        <SimpleTooltip position="left">Copied to clipboard!</SimpleTooltip>
      ) : null}
    </div>
  );
}
