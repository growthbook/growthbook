import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "../SimpleTooltip/SimpleTooltip";

type Props = {
  children: string;
};

export default function ClickToCopy({ children }: Props) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });
  return (
    <div className="d-flex align-items-center position-relative">
      {copySupported ? (
        <button
          className="btn p-0"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            performCopy(children);
          }}
          title="Copy to Clipboard"
        >
          <span className="text-main" style={{ fontSize: "1.1rem" }}>
            {copySuccess ? <HiOutlineClipboardCheck /> : <HiOutlineClipboard />}
          </span>
        </button>
      ) : null}
      <span className="ml-2">
        <code className="text-main text-break">{children}</code>
      </span>

      {copySuccess ? (
        <SimpleTooltip position="left">Copied to clipboard!</SimpleTooltip>
      ) : null}
    </div>
  );
}
