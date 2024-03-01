import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";

export interface Props {
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  id?: string;
  className?: string;
}

export default function EnvironmentToggle({
  feature,
  environment,
  mutate,
  id = "",
  className = "mr-1",
}: Props) {
  const [toggling, setToggling] = useState(false);

  const { apiCall } = useAuth();
  const permissions = usePermissions();

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
    state: boolean
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

  return (
    <>
      {confirming ? (
        <Modal
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
      ) : (
        ""
      )}
      <Toggle
        value={env?.enabled ?? false}
        id={id}
        disabledMessage="You don't have permission to change features in this environment"
        disabled={
          !permissions.check("publishFeatures", feature.project, [environment])
        }
        setValue={async (on) => {
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
        type="environment"
        className={className}
      />
    </>
  );
}
