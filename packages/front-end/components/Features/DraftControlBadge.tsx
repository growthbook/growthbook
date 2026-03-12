import { PiShieldCheckBold, PiShieldSlashBold } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";

// Shield badge showing whether a section is gated by draft approval.
// Pass approvalsEnabled={false} to hide it entirely when org-level approvals are off.
export default function DraftControlBadge({
  gated,
  alwaysDrafted = false,
  approvalsEnabled = true,
}: {
  gated: boolean;
  alwaysDrafted?: boolean; // true for sections that always draft even without approval
  approvalsEnabled?: boolean;
}) {
  if (!approvalsEnabled) return null;
  const notGatedTooltip = alwaysDrafted
    ? "Changes to this section always create a draft revision, but no approval is required to publish."
    : "Changes to this section are published directly — no draft or approval required.";
  return (
    <Tooltip
      body={
        gated
          ? "Changes to this section create a draft revision that requires approval before going live."
          : notGatedTooltip
      }
      tipMinWidth="180px"
    >
      <span
        style={{
          color: gated ? "var(--violet-9)" : "var(--gray-8)",
          lineHeight: 1,
          display: "flex",
        }}
      >
        {gated ? (
          <PiShieldCheckBold size={16} />
        ) : (
          <PiShieldSlashBold size={16} />
        )}
      </span>
    </Tooltip>
  );
}
