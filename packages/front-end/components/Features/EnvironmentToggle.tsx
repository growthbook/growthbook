import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "../../services/auth";
import Toggle from "../Forms/Toggle";
import track from "../../services/track";

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

  const envs = feature.environments || [];

  id = id || feature.id + "__" + environment;

  return (
    <Toggle
      value={envs.includes(environment) ?? false}
      id={id}
      setValue={async (on) => {
        if (toggling) return;
        if (on && envs.includes(environment)) return;
        if (!on && !envs.includes(environment)) return;

        let newEnvs = [...envs];
        if (on) newEnvs.push(environment);
        else newEnvs = newEnvs.filter((e) => e !== environment);

        setToggling(true);
        try {
          await apiCall(`/feature/${feature.id}`, {
            method: "PUT",
            body: JSON.stringify({
              environments: newEnvs,
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
    />
  );
}
