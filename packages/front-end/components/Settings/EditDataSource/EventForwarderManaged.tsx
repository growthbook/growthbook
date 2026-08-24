import { OfficialBadge } from "@/components/Metrics/MetricName";
import Tooltip from "@/components/Tooltip/Tooltip";

export const EVENT_FORWARDER_MANAGED_TOOLTIP =
  "Managed by the Event Forwarder. It is read-only and cannot be edited or deleted from within GrowthBook.";

// These badges sit inside Cards that clip overflow, so the tooltip has to
// portal out or it gets cut off.
export function EventForwarderManagedBadge({ type }: { type: string }) {
  return (
    <Tooltip body={EVENT_FORWARDER_MANAGED_TOOLTIP} usePortal>
      <OfficialBadge type={type} managedBy="api" disableTooltip ml="1" />
    </Tooltip>
  );
}
