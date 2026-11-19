import { OfficialBadge } from "@/components/Metrics/MetricName";

export const MANAGED_WAREHOUSE_QUERY_TOOLTIP =
  "Generated from your organization's attributes for the Managed Warehouse. It is read-only and updates automatically when attributes change.";

export function ManagedWarehouseQueryBadge({ type }: { type: string }) {
  return (
    <OfficialBadge
      type={type}
      managedBy="api"
      tooltip={MANAGED_WAREHOUSE_QUERY_TOOLTIP}
      usePortal
      ml="1"
    />
  );
}
