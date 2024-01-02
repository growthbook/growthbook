import { FeatureInterface } from "back-end/types/feature";
import { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getRules, isRuleFullyCovered } from "@/services/features";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import { SortableRule } from "./Rule";

interface Props {
  feature: FeatureInterface;
  version: number;
  close: () => void;
  mutate: () => void;
  setRuleModal: (rule: { environment: string; i: number }) => void;
  setVersion: (version: number) => void;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
}

export default function CompareRulesModal({
  feature,
  version,
  close,
  mutate,
  setRuleModal, //TODO: Can I delete this?
  setVersion, //TODO: Can I delete this?
  experimentsMap, //TODO: Can I delete this?
}: Props) {
  const [env1, setEnv1] = useState<string | null>(null);
  const [env2, setEnv2] = useState<string | null>(null);
  const [env1Rules, setEnv1Rules] = useState<any[]>([]);
  const [env2Rules, setEnv2Rules] = useState<any[]>([]);
  const environments = Object.keys(feature.environmentSettings);

  useEffect(() => {
    if (env1) {
      setEnv1Rules(getRules(feature, env1));
      console.log("env1Rules", env1Rules);
    }

    if (env2) {
      setEnv2Rules(getRules(feature, env2));
      console.log("env2Rules", env2Rules);
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
      <p>
        Select two environments to compare to the override rules. The first
        matching rule applies, so the order of the rules does matter.
      </p>
      <div className="d-flex">
        <div className="w-50">
          <SelectField
            className="pr-2"
            type="dropdown"
            name="environment"
            label="Environment 1"
            value="Test"
            placeholder="Select an environment"
            options={environments
              .map((env) => ({
                label: env,
                value: env,
              }))
              .filter((env) => env.value !== env2)}
            onChange={(value) => setEnv1(value)}
          ></SelectField>
          {env1Rules?.length && env1 ? (
            <div className="border rounded p-2 mr-2">
              {env1Rules.map(({ ...rule }, i) => (
                <SortableRule
                  key={rule.id}
                  environment={env1}
                  i={i}
                  rule={rule}
                  feature={feature}
                  mutate={mutate}
                  setRuleModal={setRuleModal}
                  unreachable={false}
                  version={version}
                  setVersion={setVersion}
                  locked={true}
                  experimentsMap={experimentsMap}
                />
              ))}
            </div>
          ) : null}
          {env1 && !env1Rules.length ? (
            <div>This environment doesn&apos;t have any rules</div>
          ) : null}
        </div>
        <div className="w-50">
          <SelectField
            className="pl-2"
            type="dropdown"
            name="environment"
            label="Environment 2"
            value="Test"
            placeholder="Select an environment"
            options={environments
              .map((env) => ({
                label: env,
                value: env,
              }))
              .filter((env) => env.value !== env1)}
            onChange={(value) => setEnv2(value)}
          ></SelectField>
          {env2Rules && env2 ? (
            <div className="border rounded p-2 ml-2">
              {env2Rules.map(({ ...rule }, i) => (
                <SortableRule
                  key={rule.id}
                  environment={env2}
                  i={i}
                  rule={rule}
                  feature={feature}
                  mutate={mutate}
                  setRuleModal={setRuleModal}
                  unreachable={false}
                  version={version}
                  setVersion={setVersion}
                  locked={true}
                  experimentsMap={experimentsMap}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
