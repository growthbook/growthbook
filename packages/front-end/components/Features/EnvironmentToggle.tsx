import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

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
      track("功能环境切换", {
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
          trackingEventModalType=""
          header="切换环境状态"
          close={() => {
            setConfirming(false);
            setToggling(false);
          }}
          open={true}
          cta="确认"
          submit={() => submit(feature, environment, desiredState)}
        >
          你即将把 <strong>{environment}</strong> 环境设置为 <strong>{desiredState ? "启用" : "禁用"}</strong>。
        </Modal>
      ) : (
        ""
      )}
      <Toggle
        value={env?.enabled ?? false}
        id={id}
        disabledMessage="你没有权限更改此环境中的功能状态"
        disabled={!permissionsUtil.canPublishFeature(feature, [environment])}
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
