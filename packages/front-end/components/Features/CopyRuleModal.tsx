import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { filterEnvironmentsByFeature } from "shared/util";
import { useState } from "react";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
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
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
}

export default function CopyRuleModal({
  feature,
  environment,
  version,
  setVersion,
  rules,
  cancel,
  mutate,
  safeRolloutsMap,
}: Props) {
  const { apiCall } = useAuth();

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const filteredEnvironments = environments.filter(
    (env) => env.id !== environment,
  );
  const envs = filteredEnvironments.map((e) => e.id);

  const ruleTxt = rules.length === 1 ? "rule" : "rules";

  const [selectedEnvironments, setSelectedEnvironments] = useState<
    Record<string, boolean>
  >({});

  const allToggled =
    Object.values(selectedEnvironments).filter((v) => v).length === envs.length;

  const toggleAll = () => {
    if (allToggled) {
      setSelectedEnvironments({});
    } else {
      const o = {};
      envs.forEach((env) => {
        o[env] = true;
      });
      setSelectedEnvironments(o);
    }
  };

  const submit = async () => {
    let draftVersion = version;
    for (const env in selectedEnvironments) {
      if (!selectedEnvironments[env]) continue;
      for (const rule of rules) {
        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${draftVersion}/rule`,
          {
            method: "POST",
            body: JSON.stringify({
              environment: env,
              rule:
                rule.type === "safe-rollout"
                  ? { ...rule, id: "", trackingKey: "" } // Don't copy tracking key but keep the seed for safe rollout copies
                  : { ...rule, id: "" },
              ...(rule.type === "safe-rollout" && {
                safeRolloutFields: safeRolloutsMap.get(rule.safeRolloutId),
              }),
            }),
          },
        );
        draftVersion = res.version;
      }
    }
    track("Clone Feature Rule", {
      environment,
    });
    await mutate();
    setVersion(draftVersion);
  };

  return (
    <Modal
      trackingEventModalType=""
      header={`Copy ${ruleTxt} to environment(s)`}
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
        from <span className="text-purple h5">{environment}</span> to...
      </div>
      {envs.length > 1 ? (
        <>
          <div className="mt-3">
            <label className="cursor-pointer hover-underline py-1 px-1 mb-0">
              <input
                type="checkbox"
                id="select_all"
                className="position-relative mr-2"
                style={{ top: "2px" }}
                onChange={toggleAll}
                checked={allToggled}
              />
              <span className="h5 mr-1 text-dark">all environments</span>
            </label>
          </div>
          <hr />
        </>
      ) : null}
      <div className="mt-2">
        {envs.map((env) => {
          const rules = getRules(feature, env);

          return (
            <div key={env}>
              <label className="cursor-pointer hover-underline py-1 px-1">
                <input
                  type="checkbox"
                  id={"select_" + env}
                  className="position-relative mr-2"
                  style={{ top: "2px" }}
                  onChange={() => {
                    setSelectedEnvironments({
                      ...selectedEnvironments,
                      [env]: !selectedEnvironments?.[env],
                    });
                  }}
                  checked={selectedEnvironments?.[env] ?? false}
                />
                <span className="h5 mr-1 text-purple">{env}</span>
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
