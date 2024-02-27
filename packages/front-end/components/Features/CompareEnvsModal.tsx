import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useEffect, useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import { FaCopy, FaRegCopy } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import Tooltip from "../Tooltip/Tooltip";

interface Props {
  feature: FeatureInterface;
  close: () => void;
  version: number;
  setVersion: (version: number) => void;
  mutate: () => void;
}

type PartialRule = Omit<FeatureRule, "id">;

export default function CompareRulesModal({
  feature,
  close,
  version,
  setVersion,
  mutate,
}: Props) {
  const [env1, setEnv1] = useState<string | null>(null);
  const [env2, setEnv2] = useState<string | null>(null);
  const environments = Object.keys(feature.environmentSettings); // Is this right? Where is dev coming from?
  const { apiCall } = useAuth();

  async function handleCopyingRules(
    targetEnv: string,
    newRules: FeatureRule[]
  ) {
    const res = await apiCall<{ version: number }>(
      `/feature/${feature.id}/${version}/copy-rule-set`,
      {
        method: "PUT",
        body: JSON.stringify({
          targetEnv,
          newRules,
        }),
      }
    );
    track("Clone Feature Rule Set", {
      sourceEnvironment: env1,
      targetEnv,
      rules: newRules,
    });
    await mutate();
    res.version && setVersion(res.version);
  }

  console.log("environments", environments);

  const options = environments.map((env) => ({
    label: `${env} (${feature.environmentSettings[env].rules.length} rules)`,
    value: env,
  }));

  function getDiffString(environment: string): string {
    const updatedRules: PartialRule[] = feature.environmentSettings[
      environment
    ].rules.map((rule: FeatureRule) => {
      // We don't want to include rule.ids in the diff as they'll always be different
      const partialRule: Omit<FeatureRule, "id"> & { id?: string } = {
        ...rule,
      };
      delete partialRule.id;
      return partialRule;
    });

    return JSON.stringify(updatedRules, null, 2);
  }

  return (
    <Modal
      close={close}
      closeCta="Close"
      header="Compare Environment Rules"
      open={true}
      size="max"
    >
      <div className="p-2">
        <div className="row">
          <div className="col-12">
            <SelectField
              type="dropdown"
              name="environment"
              label="Select Source Environment"
              value={env1 || ""}
              placeholder="Select Environment..."
              options={options.filter((env) => env.value !== env2)}
              onChange={(value) => setEnv1(value)}
            />
          </div>
          <div className="col-12">
            <SelectField
              type="dropdown"
              name="environment"
              label="Select Target Environment"
              value={env2 || ""}
              placeholder="Select Environment..."
              options={options.filter((env) => env.value !== env1)}
              onChange={(value) => setEnv2(value)}
            />
          </div>
        </div>
        {env1 && env2 ? (
          <>
            <div className="row">
              <div className="alert alert-secondary col-12">
                If copied, rules from <strong>{env1}</strong> will overwrite any
                existing rules on <strong>{env2}</strong>.
              </div>
              <button
                className="btn btn-outline-primary"
                onClick={async () =>
                  await handleCopyingRules(
                    env2,
                    feature.environmentSettings[env1].rules
                  )
                }
                disabled={getDiffString(env1) === getDiffString(env2)}
              >
                <FaRegCopy /> Copy Rules to {env2}
              </button>
            </div>
            <div className="row my-3">
              {getDiffString(env1) === getDiffString(env2) ? (
                <div className="alert alert-info col-12">
                  <strong>{env1}</strong> and <strong>{env2}</strong> have
                  identical rules.
                </div>
              ) : (
                <div className="border rounded col-12">
                  <ReactDiffViewer
                    oldValue={getDiffString(env1)}
                    newValue={getDiffString(env2)}
                    splitView={true}
                  />
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
