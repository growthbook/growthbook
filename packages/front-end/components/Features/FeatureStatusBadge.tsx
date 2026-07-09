import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { StaleStateEntry } from "@/hooks/useFeatureStaleStates";

type FeatureStatus = "live" | "archived";

const STATUS_CONFIG: Record<
  Exclude<FeatureStatus, "live">,
  { color: NonNullable<RadixColor>; label: string }
> = {
  archived: { color: "gold", label: "Archived" },
};

function deriveStatus({
  archived,
}: {
  archived?: boolean;
  environmentSettings?: Record<string, { enabled: boolean }>;
  envStatus?: Record<string, boolean>;
}): FeatureStatus {
  if (archived) return "archived";
  return "live";
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: `var(--${color}-9)`,
        flexShrink: 0,
      }}
    />
  );
}

const FeatureStatusBadge: FC<{
  feature: {
    archived?: boolean;
    neverStale?: boolean;
    valueType?: FeatureValueType;
    environmentSettings?: Record<string, { enabled: boolean }>;
  };
  envStatus?: Record<string, boolean>;
  context?: "list" | "detail";
  staleData?: StaleStateEntry;
  fetchStaleData?: () => Promise<void>;
  onDisable?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = ({
  feature,
  envStatus,
  context = "detail",
  staleData,
  fetchStaleData,
  onDisable,
  open,
  onOpenChange,
}) => {
  const status = deriveStatus({
    archived: feature.archived,
    environmentSettings: feature.environmentSettings,
    envStatus,
  });

  if (status !== "live") {
    const { color, label } = STATUS_CONFIG[status];

    if (context === "list") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <StatusDot color={color} />
          {label}
        </span>
      );
    }

    return <Badge color={color} variant="solid" radius="full" label={label} />;
  }

  return (
    <StaleFeatureIcon
      neverStale={feature.neverStale}
      valueType={feature.valueType}
      staleData={staleData}
      fetchStaleData={fetchStaleData}
      onDisable={onDisable}
      context={context}
      open={open}
      onOpenChange={onOpenChange}
      labelPrefix="Live: "
    />
  );
};

export default FeatureStatusBadge;
