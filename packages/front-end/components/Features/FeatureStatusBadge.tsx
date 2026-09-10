import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import Badge from "@/ui/Badge";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { StaleStateEntry } from "@/hooks/useFeatureStaleStates";

type FeatureStatus = "live" | "archived";

const STATUS_CONFIG: Record<
  FeatureStatus,
  { color: "green" | "gold"; label: string }
> = {
  live: { color: "green", label: "Live" },
  archived: { color: "gold", label: "Archived" },
};

function deriveStatus({ archived }: { archived?: boolean }): FeatureStatus {
  return archived ? "archived" : "live";
}

// Lifecycle only (Live / Archived) — health lives in its own column.
export const FeatureLifecycleStatus: FC<{ archived?: boolean }> = ({
  archived,
}) => <>{STATUS_CONFIG[deriveStatus({ archived })].label}</>;

// Detail-page header. Archived is the only lifecycle state worth a badge;
// live features show the staleness verdict. Temp rollout warnings live on the
// rule itself (ExperimentRefSummary).
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
