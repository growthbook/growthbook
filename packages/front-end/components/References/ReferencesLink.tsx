import { BiShow } from "react-icons/bi";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";

// "{n} references" link that opens a references modal; renders a disabled,
// tooltip-explained label when there are none.
export default function ReferencesLink({
  total,
  onShow,
  emptyTooltip,
}: {
  total: number;
  onShow: () => void;
  emptyTooltip: string;
}) {
  if (total === 0) {
    return (
      <Tooltip content={emptyTooltip}>
        <span style={{ color: "var(--gray-10)", cursor: "not-allowed" }}>
          <BiShow /> 0 references
        </span>
      </Tooltip>
    );
  }

  return (
    <Link onClick={onShow}>
      <BiShow /> {total} reference{total !== 1 && "s"}
    </Link>
  );
}
