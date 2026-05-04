import { useState } from "react";
import { Tooltip } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import Switch from "@/ui/Switch";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import KillSwitchModal from "@/components/Features/KillSwitchModal";

export interface Props {
  /** Merged feature (may reflect draft state) — used for the toggle value. */
  feature: FeatureInterface;
  /** Live base feature document — used for the live-state row in the modal. */
  baseFeature?: FeatureInterface;
  environment: string;
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  /** The revision currently being viewed — used to pre-select in the draft dropdown. */
  currentVersion: number;
  /** All known revisions (sparse) — used to populate the draft dropdown. */
  revisionList: MinimalFeatureRevisionInterface[];
  id?: string;
  /** When true, the toggle is disabled with a tooltip. */
  isLocked?: boolean;
}

export default function EnvironmentToggle({
  feature,
  baseFeature,
  environment,
  mutate,
  setVersion,
  currentVersion,
  revisionList,
  id = "",
  isLocked = false,
}: Props) {
  const [toggling, setToggling] = useState(false);
  const [confirmingState, setConfirmingState] = useState<boolean | null>(null);

  const permissionsUtil = usePermissionsUtil();

  id = id || feature.id + "__" + environment;

  const env = feature.environmentSettings?.[environment];
  const isDisabled = !permissionsUtil.canPublishFeature(feature, [environment]);

  const switchElement = (
    <Switch
      id={id}
      disabled={isDisabled || isLocked || toggling}
      value={env?.enabled ?? false}
      onChange={(on) => {
        if (toggling) return;
        if (on === (env?.enabled ?? false)) return;
        setConfirmingState(on);
      }}
      size="3"
    />
  );

  return (
    <>
      {confirmingState !== null && (
        <KillSwitchModal
          feature={feature}
          baseFeature={baseFeature}
          environment={environment}
          desiredState={confirmingState}
          currentVersion={currentVersion}
          revisionList={revisionList}
          mutate={async () => {
            setToggling(false);
            await mutate();
          }}
          setVersion={setVersion}
          close={() => {
            setConfirmingState(null);
            setToggling(false);
          }}
        />
      )}

      {isLocked ? (
        <Tooltip content="Switch to an active draft to toggle this environment">
          {switchElement}
        </Tooltip>
      ) : isDisabled ? (
        <Tooltip content="You don't have permission to change features in this environment">
          {switchElement}
        </Tooltip>
      ) : (
        switchElement
      )}
    </>
  );
}
