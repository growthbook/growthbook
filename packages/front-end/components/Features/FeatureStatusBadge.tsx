import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import Badge from "@/ui/Badge";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { StaleStateEntry } from "@/hooks/useFeatureStaleStates";

type FeatureStatus = "live" | "off" | "archived";

const STATUS_CONFIG: Record<
  FeatureStatus,
  { color: "green" | "gray" | "gold"; label: string }
> = {
  live: { color: "green", label: "Live" },
  off: { color: "gray", label: "Off" },
  archived: { color: "gold", label: "Archived" },
};

function deriveStatus({
  archived,
  envStatus,
}: {
  archived?: boolean;
  // environment id → enabled, from the lazily loaded feature status endpoint.
  envStatus?: Record<string, boolean>;
}): FeatureStatus {
  if (archived) return "archived";
  const enabled = Object.values(envStatus ?? {});
  if (enabled.length && enabled.every((on) => !on)) return "off";
  return "live";
}

// Lifecycle only (Live / Off / Archived) — health lives in its own column.
export const FeatureLifecycleStatus: FC<{
  archived?: boolean;
  envStatus?: Record<string, boolean>;
}> = ({ archived, envStatus }) => (
  <>{STATUS_CONFIG[deriveStatus({ archived, envStatus })].label}</>
);

// Detail-page header: Archived badge, or the staleness verdict for live flags.
const FeatureStatusBadge: FC<{
  feature: {
    archived?: boolean;
    neverStale?: boolean;
    valueType?: FeatureValueType;
  };
  staleData?: StaleStateEntry;
  fetchStaleData?: () => Promise<void>;
  onDisable?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = ({
  feature,
  staleData,
  fetchStaleData,
  onDisable,
  open,
  onOpenChange,
}) => {
  const status = deriveStatus({ archived: feature.archived });
  const { color, label } = STATUS_CONFIG[status];

  if (status !== "live") {
    return <Badge color={color} variant="solid" radius="full" label={label} />;
  }

  return (
    <StaleFeatureIcon
      neverStale={feature.neverStale}
      valueType={feature.valueType}
      staleData={staleData}
      fetchStaleData={fetchStaleData}
      onDisable={onDisable}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
};

export default FeatureStatusBadge;
