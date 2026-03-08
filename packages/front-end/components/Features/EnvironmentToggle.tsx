import { useState } from "react";
import { Tooltip } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import Switch from "@/ui/Switch";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export interface Props {
  feature: FeatureInterface;
  environment: string;
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  id?: string;
  /** When true and kill switches are gated, the toggle is disabled with a tooltip. */
  isLocked?: boolean;
}

export default function EnvironmentToggle({
  feature,
  environment,
  mutate,
  setVersion,
  id = "",
  isLocked = false,
}: Props) {
  const [toggling, setToggling] = useState(false);

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  id = id || feature.id + "__" + environment;

  const envs = feature.environmentSettings;
  const env = envs?.[environment];

  const [desiredState, setDesiredState] = useState(env?.enabled ?? false);
  const [confirming, setConfirming] = useState(false);

  const settings = useOrgSettings();

  // Global kill switch behavior; fall back to legacy killswitchConfirmation boolean.
  const killSwitchBehavior =
    settings?.featureKillSwitchBehavior ??
    (settings?.killswitchConfirmation ? "warn" : "off");

  const submit = async (
    feature: FeatureInterface,
    environment: string,
    state: boolean,
  ) => {
    setToggling(true);
    try {
      const res = await apiCall<{ status: 200; draftVersion?: number }>(
        `/feature/${feature.id}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({
            environment,
            state,
          }),
        },
      );
      track("Feature Environment Toggle", {
        environment,
        enabled: state,
        gated: killSwitchBehavior === "gate",
      });
      await mutate();
      if (res?.draftVersion) {
        setVersion(res.draftVersion);
      }
    } catch (e) {
      console.error(e);
    }

    setToggling(false);
  };

  const isDisabled = !permissionsUtil.canPublishFeature(feature, [environment]);
  // When kill switches are gated and we're viewing a locked (non-active-draft)
  // revision, the toggle must be made on the active draft instead.
  const isGatedAndLocked = killSwitchBehavior === "gate" && isLocked;

  const switchElement = (
    <Switch
      id={id}
      disabled={isDisabled || isGatedAndLocked}
      value={env?.enabled ?? false}
      onChange={async (on) => {
        if (toggling) return;
        if (on && env?.enabled) return;
        if (!on && !env?.enabled) return;

        if (killSwitchBehavior === "warn") {
          setDesiredState(on);
          setConfirming(true);
        } else {
          await submit(feature, environment, on);
        }
      }}
      size="3"
    />
  );

  return (
    <>
      {confirming ? (
        <Modal
          trackingEventModalType=""
          header="Toggle environment"
          close={() => {
            setConfirming(false);
            setToggling(false);
          }}
          open={true}
          cta="Confirm"
          submit={() => submit(feature, environment, desiredState)}
        >
          You are about to set the <strong>{environment}</strong> environment to{" "}
          <strong>{desiredState ? "enabled" : "disabled"}</strong>.
        </Modal>
      ) : null}

      {isGatedAndLocked ? (
        <Tooltip content="Switch to the active draft to toggle this environment">
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
