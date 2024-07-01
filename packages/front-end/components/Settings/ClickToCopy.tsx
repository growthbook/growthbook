import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import clsx from "clsx";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";

type Props = {
  compact?: boolean;
  children?: string;
  className?: string;
  valueToCopy?: string;
};

export default function ClickToCopy({
  compact,
  children,
  className = "",
  valueToCopy,
}: Props) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });
  return (
    <div
      className={clsx("d-flex align-items-center position-relative", className)}
    >
      {copySupported ? (
        <button
          className="btn p-0"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (valueToCopy) {
              performCopy(valueToCopy);
            } else if (children) {
              performCopy(children);
            }
          }}
          title="Copy to Clipboard"
          style={compact ? { lineHeight: 1.1 } : {}}
        >
          <span
            className="text-main"
            style={{ fontSize: compact ? ".95rem" : "1.1rem" }}
          >
            {copySuccess ? <HiOutlineClipboardCheck /> : <HiOutlineClipboard />}
          </span>
        </button>
      ) : null}
      {children ? (
        <span
          className={compact ? "" : "ml-2"}
          style={compact ? { marginLeft: 2, lineHeight: 1.1 } : {}}
        >
          <code
            className="text-main text-break"
            style={compact ? { fontSize: ".7rem" } : {}}
          >
            {children}
          </code>
        </span>
      ) : null}

      {copySuccess ? (
        <SimpleTooltip position="left">Copied to clipboard!</SimpleTooltip>
      ) : null}
    </div>
  );
}
