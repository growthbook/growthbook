import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import { FaRedo, FaRegCopy } from "react-icons/fa";
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
  const [copyingRules, setCopyingRules] = useState(false);
  const environments = Object.keys(feature.environmentSettings); // MKTODO: Is this right? Where is dev coming from?
  const { apiCall } = useAuth();

  async function handleCopyingRules(
    targetEnv: string,
    newRules: FeatureRule[]
  ) {
    setCopyingRules(true);
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
    setCopyingRules(false);
  }

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
              disabled={copyingRules}
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
              disabled={copyingRules}
            />
          </div>
        </div>
        {env1 && env2 ? (
          <>
            <div className="row px-2">
              <div className="alert alert-secondary col-12">
                If copied, rules from <strong>{env1}</strong> will overwrite any
                existing rules on <strong>{env2}</strong>.
              </div>
              <div className="d-flex align-items-center justify-content-between w-100">
                <button
                  className="btn btn-outline-primary"
                  onClick={async () =>
                    await handleCopyingRules(
                      env2,
                      feature.environmentSettings[env1].rules
                    )
                  }
                  disabled={
                    getDiffString(env1) === getDiffString(env2) || copyingRules
                  }
                >
                  <FaRegCopy />
                  {copyingRules ? " Copying rules..." : " Copy Rules to Target"}
                </button>
                <Tooltip body="Reset environment selection to trigger a new comparison.">
                  <button
                    className="btn btn-link text-decoration-none"
                    disabled={copyingRules}
                    onClick={() => {
                      // MKTODO: This isn't resetting the SelectField's value prop
                      setEnv1(null);
                      setEnv2(null);
                    }}
                  >
                    {" "}
                    <FaRedo size={10} /> Compare New Selection
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="my-3 border rounded">
              <div className="bg-light w-100 p-2">
                <strong>Environments Compared</strong>
              </div>
              {getDiffString(env1) === getDiffString(env2) ? (
                <div className="p-3">No difference between environments.</div>
              ) : (
                <div className="d-flex w-100">
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
