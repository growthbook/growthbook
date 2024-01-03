import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import { getRules } from "@/services/features";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import Tooltip from "../Tooltip/Tooltip";
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
  const [env1Rules, setEnv1Rules] = useState<FeatureRule[]>([]);
  const [env2Rules, setEnv2Rules] = useState<FeatureRule[]>([]);
  const environments = Object.keys(feature.environmentSettings);

  const options = environments.map((env) => ({
    label: `${env} (${feature.environmentSettings[env].rules.length} rules)`,
    value: env,
  }));

  useEffect(() => {
    if (env1) {
      setEnv1Rules(getRules(feature, env1));
    }

    if (env2) {
      setEnv2Rules(getRules(feature, env2));
    }
  }, [env1, env2, feature, env1Rules, env2Rules]);

  const maxRuleLength = Math.max(env1Rules.length, env2Rules.length);

  function doRulesMatch(rule1, rule2): boolean {
    if (rule1 && rule2) {
      // Remove the id from each rule
      const localRule1 = { ...rule1 };
      const localRule2 = { ...rule2 };
      delete localRule1.id;
      delete localRule2.id;

      const rule1JSON = JSON.stringify(localRule1);
      const rule2JSON = JSON.stringify(localRule2);

      if (rule1JSON === rule2JSON) {
        return true;
      }
    }
    return false;
  }

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
            {env1 && env2 ? (
              <>
                <Tooltip
                  tipPosition="top"
                  body={`Note: This will overwrite ${env2}'s existing rules completely.`}
                >
                  <button className="btn btn-outline-primary">
                    Copy {env1} rules to {env2}
                  </button>
                </Tooltip>
              </>
            ) : null}
          </div>
          <div className="col col-5 d-flex align-items-center justify-content-center">
            {env1 && env2 ? (
              <>
                <Tooltip
                  tipPosition="top"
                  body={`Note: This will overwrite ${env1}'s existing rules completely.`}
                >
                  <button className="btn btn-outline-primary">
                    Copy {env2} rules to {env1}
                  </button>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        {env1 && env2 ? (
          <>
            {Array.from({ length: maxRuleLength }).map((_, i) => (
              <div className="row border m-2" key={`rule-${i}`}>
                <div className="col">
                  <div className="d-flex h-100 justify-content-center align-items-center">
                    {env1Rules[i] || env2Rules[i] ? (
                      <>
                        {doRulesMatch(env1Rules[i], env2Rules[i]) ? (
                          <Tooltip
                            body="Rules match"
                            className="d-flex align-items-center"
                          >
                            <FaCheckCircle color="green" size={20} />
                          </Tooltip>
                        ) : (
                          <Tooltip
                            body="These rules do not match"
                            className="d-flex align-items-center"
                          >
                            <FaExclamationTriangle color="orange" size={20} />
                          </Tooltip>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="col-5 border-left">
                  {" "}
                  {env1Rules[i] ? (
                    <SortableRule
                      key={env1Rules[i].id}
                      environment={env1}
                      i={i}
                      rule={env1Rules[i]}
                      feature={feature}
                      mutate={mutate}
                      setRuleModal={setRuleModal}
                      unreachable={false}
                      version={version}
                      setVersion={setVersion}
                      locked={true}
                      experimentsMap={experimentsMap}
                      hideTrackingKey={true}
                    />
                  ) : (
                    <div className="bg-light d-flex justify-content-center align-items-center h-100">
                      No rule to compare
                    </div>
                  )}
                </div>
                <div className="col-5 border-left">
                  {" "}
                  {env2Rules[i] ? (
                    <SortableRule
                      key={env2Rules[i].id}
                      environment={env2}
                      i={i}
                      rule={env2Rules[i]}
                      feature={feature}
                      mutate={mutate}
                      setRuleModal={setRuleModal}
                      unreachable={false}
                      version={version}
                      setVersion={setVersion}
                      locked={true}
                      experimentsMap={experimentsMap}
                      hideTrackingKey={true}
                    />
                  ) : (
                    <div className="bg-light d-flex justify-content-center align-items-center h-100">
                      No rule to compare
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
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
