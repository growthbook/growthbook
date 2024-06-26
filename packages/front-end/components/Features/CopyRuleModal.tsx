import { FeatureInterface, FeatureRule } from "@back-end/types/feature";
import { filterEnvironmentsByFeature } from "shared/dist/util";
import { useState } from "react";
import { getRules, useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import track from "@/services/track";

export interface Props {
  feature: FeatureInterface;
  environment: string;
  version: number;
  setVersion: (version: number) => void;
  rules: FeatureRule[];
  cancel: () => void;
  mutate: () => void;
}

export default function CopyRuleModal({
  feature,
  environment,
  version,
  setVersion,
  rules,
  cancel,
  mutate,
}: Props) {
  const { apiCall } = useAuth();

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const filteredEnvironments = environments.filter(
    (env) => env.id !== environment
  );

  const ruleTxt = rules.length === 1 ? "rule" : "rules";

  const [selectedEnvironments, setSelectedEnvironments] = useState<
    Record<string, boolean>
  >({});

  const submit = async () => {
    let res: { version: number } | undefined;
    for (const env in selectedEnvironments) {
      if (!selectedEnvironments[env]) continue;
      for (const rule of rules) {
        res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${version}/rule`,
          {
            method: "POST",
            body: JSON.stringify({
              environment: env,
              rule: { ...rule, id: "" },
            }),
          }
        );
      }
    }
    track("Clone Feature Rule", {
      environment,
    });
    await mutate();
    res?.version && setVersion(res.version);
  };

  return (
    <Modal
      header={`Copy ${ruleTxt} to environment`}
      open={true}
      close={cancel}
      submit={submit}
      cta={`Copy ${ruleTxt}`}
    >
      <div>
        Copy{" "}
        <span className={`badge badge-gray`}>
          {rules.length} {ruleTxt}
        </span>{" "}
        from <span className="text-indigo h5">{environment}</span> to...
      </div>
      <div className="mt-3">
        {filteredEnvironments.map((env) => {
          const rules = getRules(feature, env.id);

          return (
            <div key={env.id}>
              <label className="cursor-pointer hover-underline py-1 px-2">
                <input
                  type="checkbox"
                  id={"select_" + env.id}
                  className="position-relative mr-2"
                  style={{ top: "2px" }}
                  onChange={() => {
                    setSelectedEnvironments({
                      ...selectedEnvironments,
                      [env.id]: !selectedEnvironments?.[env.id],
                    });
                  }}
                  checked={selectedEnvironments?.[env.id] ?? false}
                />
                <span className="h5 mr-1 text-indigo">{env.id}</span>
                <span className={`badge badge-gray ml-2`}>
                  {rules.length} rule{rules.length !== 1 ? "s" : ""}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
