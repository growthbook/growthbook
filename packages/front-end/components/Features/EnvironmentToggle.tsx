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
  mutate: () => void;
  id?: string;
}

export default function EnvironmentToggle({
  feature,
  environment,
  mutate,
  id = "",
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
  const showConfirmation = !!settings?.killswitchConfirmation;

  const submit = async (
    feature: FeatureInterface,
    environment: string,
    state: boolean,
  ) => {
    setToggling(true);
    try {
      await apiCall(`/feature/${feature.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({
          environment,
          state,
        }),
      });
      track("Feature Environment Toggle", {
        environment,
        enabled: state,
      });
    } catch (e) {
      console.error(e);
    }

    setToggling(false);
    mutate();
  };

  const isDisabled = !permissionsUtil.canPublishFeature(feature, [environment]);

  const switchElement = (
    <Switch
      id={id}
      disabled={isDisabled}
      value={env?.enabled ?? false}
      onChange={async (on) => {
        if (toggling) return;
        if (on && env?.enabled) return;
        if (!on && !env?.enabled) return;

        if (showConfirmation) {
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

      {isDisabled ? (
        <Tooltip content="You don't have permission to change features in this environment">
          {switchElement}
        </Tooltip>
      ) : (
        switchElement
      )}
    </>
  );
}
