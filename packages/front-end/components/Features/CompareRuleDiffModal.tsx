import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useEffect, useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

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
  const [env1Rules, setEnv1Rules] = useState<FeatureRule[]>([]);
  const [env2Rules, setEnv2Rules] = useState<FeatureRule[]>([]);
  const environments = Object.keys(feature.environmentSettings);
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

  useEffect(() => {
    if (env1) {
      setEnv1Rules(feature.environmentSettings[env1].rules);
    }

    if (env2) {
      setEnv2Rules(feature.environmentSettings[env2].rules);
    }
  }, [env1, env2, feature.environmentSettings]);

  return (
    <Modal
      close={close}
      closeCta="Close"
      header="Compare Environment Rules"
      open={true}
      size="max"
    >
      <div>
        <div className="row">
          <div className="col d-flex align-items-center justify-content-center">
            <strong>Select Two Environments</strong>
          </div>
          <div className="col-5">
            <SelectField
              type="dropdown"
              name="environment"
              label="Source Environment"
              value="Test"
              placeholder="Select an environment"
              options={options.filter((env) => env.value !== env2)}
              onChange={(value) => setEnv1(value)}
            ></SelectField>
          </div>
          <div className="col-5">
            <SelectField
              type="dropdown"
              name="environment"
              label="Target Environment"
              value="Test"
              placeholder="Select an environment"
              options={options.filter((env) => env.value !== env1)}
              onChange={(value) => setEnv2(value)}
            ></SelectField>
          </div>
        </div>
        <div className="row">
          <div className="col"></div>
          <div className="col col-5 d-flex align-items-center justify-content-center">
            {env1 && env2 && env1Rules && env2Rules ? (
              <>
                <Tooltip
                  tipPosition="top"
                  body={`Note: This will overwrite ${env2}'s existing rules completely.`}
                >
                  <button
                    className="btn btn-outline-primary"
                    onClick={async () =>
                      await handleCopyingRules(env2, env1Rules)
                    }
                  >
                    Copy {env1} rules to {env2}
                  </button>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        {env1 && env2 ? (
          <div className="border rounded">
            <ReactDiffViewer
              oldValue={getDiffString(env1)}
              newValue={getDiffString(env2)}
              splitView={true}
            />
          </div>
        ) : (
          <div className="row px-2">
            <div className="col text-center bg-light py-3">
              Please select two environments to compare.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
