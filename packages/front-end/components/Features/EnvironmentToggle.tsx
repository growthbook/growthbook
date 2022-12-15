import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import usePermissions from "@/hooks/usePermissions";
import Toggle from "../Forms/Toggle";

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
  const permissions = usePermissions();

  id = id || feature.id + "__" + environment;

  const envs = feature.environmentSettings;
  const env = envs?.[environment];

  return (
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

        setToggling(true);
        try {
          await apiCall(`/feature/${feature.id}/toggle`, {
            method: "POST",
            body: JSON.stringify({
              environment,
              state: on,
            }),
          });
          track("Feature Environment Toggle", {
            environment,
            enabled: on,
          });
        } catch (e) {
          console.error(e);
        }
        setToggling(false);
        mutate();
      }}
      type="environment"
    />
  );
}
