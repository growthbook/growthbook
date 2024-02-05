import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useEffect, useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";

interface Props {
  feature: FeatureInterface;
  close: () => void;
}

type EnvSettings = {
  enabled: boolean;
  rules: Omit<FeatureRule, "id">[];
};

export default function CompareRulesModal({ feature, close }: Props) {
  const [env1, setEnv1] = useState<string | null>(null);
  const [env2, setEnv2] = useState<string | null>(null);
  const [env1Rules, setEnv1Rules] = useState<string | null>(null);
  const [env2Rules, setEnv2Rules] = useState<string | null>(null);
  const environments = Object.keys(feature.environmentSettings);

  const options = environments.map((env) => ({
    label: `${env} (${feature.environmentSettings[env].rules.length} rules)`,
    value: env,
  }));

  useEffect(() => {
    function buildDiffString(environment: string): string {
      const envSettings: EnvSettings = {
        enabled: feature.environmentSettings[environment].enabled,
        rules: [],
      };

      feature.environmentSettings[environment].rules.forEach(
        (rule: FeatureRule) => {
          // We don't want to include rule.ids in the diff
          const partialRule: Omit<FeatureRule, "id"> & { id?: string } = {
            ...rule,
          };
          delete partialRule.id;
          envSettings.rules.push(partialRule);
        }
      );

      return JSON.stringify(envSettings, null, 2);
    }

    if (env1) {
      setEnv1Rules(buildDiffString(env1));
    }

    if (env2) {
      setEnv2Rules(buildDiffString(env2));
    }
  }, [env1, env2, feature, env1Rules, env2Rules]);

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
          <div className="col col-5 d-flex align-items-center justify-content-center"></div>
        </div>
        {env1Rules && env2Rules ? (
          <div className="border rounded">
            <ReactDiffViewer
              oldValue={env1Rules}
              newValue={env2Rules}
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
