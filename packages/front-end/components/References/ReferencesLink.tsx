import { ReactNode } from "react";
import { BiShow } from "react-icons/bi";
import { PiWarningFill } from "react-icons/pi";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";

function DisabledLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ color: "var(--gray-10)", cursor: "not-allowed" }}>
      {children}
    </span>
  );
}

export default function ReferencesLink({
  total,
  onShow,
  emptyTooltip,
  status,
}: {
  total: number;
  onShow: () => void;
  emptyTooltip: string;
  status?: "loading" | "error";
}) {
  if (status === "loading") {
    return (
      <DisabledLabel>
        <LoadingSpinner /> Loading references…
      </DisabledLabel>
    );
  }

  if (status === "error") {
    return (
      <Tooltip content="Some data failed to load, so references can't be counted.">
        <DisabledLabel>
          <PiWarningFill /> References unavailable
        </DisabledLabel>
      </Tooltip>
    );
  }

  if (total === 0) {
    return (
      <Tooltip content={emptyTooltip}>
        <DisabledLabel>
          <BiShow /> 0 references
        </DisabledLabel>
      </Tooltip>
    );
  }

  return (
    <Link onClick={onShow}>
      <BiShow /> {total} reference{total !== 1 && "s"}
    </Link>
  );
}
