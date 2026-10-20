import { OfficialBadge } from "@/components/Metrics/MetricName";

export const EVENT_FORWARDER_MANAGED_TOOLTIP =
  "Managed by Event Forwarder. It is read-only and cannot be edited or deleted from within GrowthBook.";

export function EventForwarderManagedBadge({ type }: { type: string }) {
  return (
    <OfficialBadge
      type={type}
      managedBy="api"
      tooltip={EVENT_FORWARDER_MANAGED_TOOLTIP}
      usePortal
      ml="1"
    />
  );
}
