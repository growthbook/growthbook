import { FeatureInterface } from "back-end/types/feature";
import React, { useEffect, useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FeatureRevisionInterface,
  FeatureRule,
} from "back-end/src/validators/features";
import { Environment } from "back-end/types/organization";
import RuleModal from "@/components/Features/RuleModal/index";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import { getRules, useEnvironmentState } from "@/services/features";
import CopyRuleModal from "@/components/Features/CopyRuleModal";
import Button from "@/components/Radix/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../Radix/Tabs";
import Badge from "../Radix/Badge";

export default function FeatureRules({
  environments,
  feature,
  isLocked,
  canEditDrafts,
  revisions,
  experiments,
  mutate,
  currentVersion,
  setVersion,
}: {
  environments: Environment[];
  feature: FeatureInterface;
  isLocked: boolean;
  canEditDrafts: boolean;
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  mutate: () => Promise<unknown>;
  currentVersion: number;
  setVersion: (v: number) => void;
}) {
  const envs = environments.map((e) => e.id);
  const [env, setEnv] = useEnvironmentState();
  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
  } | null>(null);
  const [copyRuleModal, setCopyRuleModal] = useState<{
    environment: string;
    rules: FeatureRule[];
  } | null>(null);

  // Make sure you can't access an invalid env tab, since active env tab is persisted via localStorage
  useEffect(() => {
    if (!envs?.length) return;
    if (!envs.includes(env)) {
      setEnv(envs[0]);
    }
  }, [envs, env, setEnv]);

  const experimentsMap = useMemo(() => {
    if (!experiments) return new Map();

    return new Map<string, ExperimentInterfaceStringDates>(
      experiments.map((exp) => [exp.id, exp])
    );
  }, [experiments]);

  const rulesByEnv = Object.fromEntries(
    environments.map((e) => {
      const rules = getRules(feature, e.id);
      return [e.id, rules];
    })
  );

  return (
    <>
      <Tabs value={env} onValueChange={setEnv}>
        <TabsList>
          {environments.map((e) => (
            <TabsTrigger value={e.id} key={e.id}>
              <span className="mr-2">{e.id}</span>
              <Badge
                label={rulesByEnv[e.id].length.toString()}
                radius="full"
                variant="solid"
                color="violet"
              ></Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {environments.map((e) => {
          return (
            <TabsContent key={e.id} value={e.id}>
              <div className="mb-4 border border-top-0">
                {rulesByEnv[e.id].length > 0 ? (
                  <RuleList
                    environment={e.id}
                    feature={feature}
                    mutate={mutate}
                    setRuleModal={setRuleModal}
                    setCopyRuleModal={setCopyRuleModal}
                    version={currentVersion}
                    setVersion={setVersion}
                    locked={isLocked}
                    experimentsMap={experimentsMap}
                  />
                ) : (
                  <div className="p-3 bg-white border-bottom">
                    <em>No rules for this environment yet</em>
                  </div>
                )}

                {canEditDrafts && !isLocked && (
                  <div className="p-3 d-flex align-items-center">
                    <h5 className="ml-0 mb-0">Add Rule to {env}</h5>
                    <div className="flex-1" />
                    <Button
                      onClick={() => {
                        setRuleModal({
                          environment: env,
                          i: getRules(feature, env).length,
                        });
                        track("Viewed Rule Modal", {
                          source: "add-rule",
                          type: "force",
                        });
                      }}
                    >
                      Add Rule
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
      {ruleModal !== null && (
        <RuleModal
          feature={feature}
          close={() => setRuleModal(null)}
          i={ruleModal.i}
          environment={ruleModal.environment}
          mutate={mutate}
          defaultType={ruleModal.defaultType || ""}
          version={currentVersion}
          setVersion={setVersion}
          revisions={revisions}
        />
      )}
      {copyRuleModal !== null && (
        <CopyRuleModal
          feature={feature}
          environment={copyRuleModal.environment}
          version={currentVersion}
          setVersion={setVersion}
          rules={copyRuleModal.rules}
          cancel={() => setCopyRuleModal(null)}
          mutate={mutate}
        />
      )}
    </>
  );
}
