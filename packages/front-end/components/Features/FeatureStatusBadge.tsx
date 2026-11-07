import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import Badge from "@/ui/Badge";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { FeatureHealthStateEntry } from "@/hooks/useFeatureHealthStates";

export const FeatureLifecycleStatus: FC<{
  archived?: boolean;
  envStatus?: Record<string, boolean>;
}> = ({ archived, envStatus }) => {
  if (archived) return <>Archived</>;
  const enabled = Object.values(envStatus ?? {});
  if (enabled.length && enabled.every((on) => !on)) return <>Off</>;
  return <>Live</>;
};

const FeatureStatusBadge: FC<{
  feature: {
    archived?: boolean;
    neverStale?: boolean;
    valueType?: FeatureValueType;
  };
  staleData?: FeatureHealthStateEntry;
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
  if (feature.archived) {
    return (
      <Badge color="gold" variant="solid" radius="full" label="Archived" />
    );
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
