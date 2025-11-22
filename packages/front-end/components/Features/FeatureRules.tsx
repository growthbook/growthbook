import { FeatureInterface } from "back-end/types/feature";
import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FeatureRevisionInterface,
  FeatureRule,
} from "back-end/src/validators/features";
import { Environment } from "back-end/types/organization";
import { Container, Flex, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { AppFeatures } from "@/types/app-features";
import RuleModal from "@/components/Features/RuleModal/index";
import RuleList from "@/components/Features/RuleList";
import { useEnvironmentState } from "@/services/features";
import CopyRuleModal from "@/components/Features/CopyRuleModal";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import EnvironmentDropdown from "../Environments/EnvironmentDropdown";
import CompareEnvironmentsModal from "./CompareEnvironmentsModal";
import HoldoutValueModal from "./HoldoutValueModal";

export default function FeatureRules({
  environments,
  feature,
  isLocked,
  canEditDrafts,
  revisions,
  experimentsMap,
  mutate,
  currentVersion,
  setVersion,
  hideInactive,
  isDraft,
  safeRolloutsMap,
  holdout,
}: {
  environments: Environment[];
  feature: FeatureInterface;
  isLocked: boolean;
  canEditDrafts: boolean;
  revisions: FeatureRevisionInterface[];
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  mutate: () => Promise<unknown>;
  currentVersion: number;
  setVersion: (v: number) => void;
  hideInactive: boolean;
  isDraft: boolean;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  holdout: HoldoutInterface | undefined;
}) {
  const { hasCommercialFeature } = useUser();
  const envs = environments.map((e) => e.id);
  const [selectedEnvs, setSelectedEnvs] = useEnvironmentState();

  // Use local state for current tab value (updates immediately)
  // Initialize from selectedEnvs
  const [env, setEnvState] = useState<string>(() => {
    return selectedEnvs.length === 0 ? "" : selectedEnvs[0];
  });

  // Sync with selectedEnvs when it changes (e.g., from other sources)
  useEffect(() => {
    const newEnv = selectedEnvs.length === 0 ? "" : selectedEnvs[0];
    setEnvState(newEnv);
  }, [selectedEnvs]);

  const setEnv = (value: string) => {
    console.log("setEnv", value);
    // Update local state immediately for UI responsiveness
    setEnvState(value);
    // Also update the persistent state
    if (value === "") {
      setSelectedEnvs([]);
    } else {
      setSelectedEnvs([value]);
    }
  };

  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
  } | null>(null);
  const [copyRuleModal, setCopyRuleModal] = useState<{
    environment: string;
    rules: FeatureRule[];
  } | null>(null);
  const [compareEnvModal, setCompareEnvModal] = useState<{
    sourceEnv?: string;
    targetEnv?: string;
  } | null>(null);
  const [holdoutModal, setHoldoutModal] = useState<boolean>(false);

  // Make sure you can't access an invalid env tab, since active env tab is persisted via localStorage
  useEffect(() => {
    if (!envs?.length) return;
    // Filter out invalid environments from selectedEnvs
    const validEnvs = selectedEnvs.filter((id) => envs.includes(id));
    if (validEnvs.length !== selectedEnvs.length) {
      setSelectedEnvs(validEnvs.length > 0 ? validEnvs : []);
    }
  }, [envs, selectedEnvs, setSelectedEnvs]);

  // Get all rules once - filtering will happen during render
  const allRules = feature?.rules ?? [];

  const tabEnvs = environments.slice(0, 4);
  const dropdownEnvs = environments.slice(4);
  const selectedDropdownEnv = dropdownEnvs.find((e) =>
    selectedEnvs.includes(e.id),
  )?.id;

  const gb = useGrowthBook<AppFeatures>();
  const isSafeRolloutPromoEnabled = gb.isOn("safe-rollout-promo");
  const hasSafeRollout = hasCommercialFeature("safe-rollout");

  return (
    <>
      <Tabs value={env} onValueChange={setEnv}>
        <Container maxWidth="100%">
          <Flex
            align="center"
            justify="between"
            style={{ boxShadow: "inset 0 -1px 0 0 var(--slate-a3)" }}
          >
            <TabsList className="w-full" style={{ boxShadow: "none" }}>
              <Flex wrap="wrap" overflow="hidden">
                <TabsTrigger value={""} key="all">
                  <Flex maxWidth="220px">
                    <Text truncate title="All Environments">
                      All Environments
                    </Text>
                  </Flex>
                  <Badge
                    ml="2"
                    label={allRules.length.toString()}
                    radius="full"
                    variant="solid"
                    color="violet"
                  />
                </TabsTrigger>
                {tabEnvs.map((e) => {
                  const envRules = allRules.filter(
                    (rule) =>
                      rule.allEnvironments || rule.environments?.includes(e.id),
                  );
                  return (
                    <TabsTrigger value={e.id} key={e.id}>
                      <Flex maxWidth="220px">
                        <Text truncate title={e.id}>
                          {e.id}
                        </Text>
                      </Flex>
                      <Badge
                        ml="2"
                        label={
                          holdout?.environmentSettings?.[e.id]?.enabled
                            ? (envRules.length + 1).toString()
                            : envRules.length.toString()
                        }
                        radius="full"
                        variant="solid"
                        color="violet"
                      />
                    </TabsTrigger>
                  );
                })}
                {dropdownEnvs.length === 1 &&
                  (() => {
                    const e = dropdownEnvs[0];
                    const envRules = allRules.filter(
                      (rule) =>
                        rule.allEnvironments ||
                        rule.environments?.includes(e.id),
                    );
                    return (
                      <TabsTrigger value={e.id}>
                        <Flex maxWidth="220px">
                          <Text truncate title={e.id}>
                            {e.id}
                          </Text>
                        </Flex>
                        <Badge
                          ml="2"
                          label={
                            holdout?.environmentSettings[e.id].enabled
                              ? (envRules.length + 1).toString()
                              : envRules.length.toString()
                          }
                          radius="full"
                          variant="solid"
                          color="violet"
                        />
                      </TabsTrigger>
                    );
                  })()}
                {dropdownEnvs.length > 1 && (
                  <Flex
                    px="1"
                    direction="column"
                    justify="center"
                    align="center"
                    className={clsx("tab-trigger-container", {
                      active: !!selectedDropdownEnv,
                    })}
                  >
                    <Container
                      flexGrow="0"
                      minWidth={selectedDropdownEnv ? undefined : "100px"}
                    >
                      <EnvironmentDropdown
                        containerClassName={"select-dropdown-no-underline"}
                        env={selectedDropdownEnv}
                        setEnv={setEnv}
                        environments={dropdownEnvs}
                        placeholder="Other..."
                        formatOptionLabel={({ value }) => {
                          const envRules = allRules.filter(
                            (rule) =>
                              rule.allEnvironments ||
                              rule.environments?.includes(value),
                          );
                          return (
                            <Flex align="center">
                              <Flex maxWidth="150px">
                                <Text weight="medium" truncate title={value}>
                                  {value}
                                </Text>
                              </Flex>
                              <Badge
                                ml="2"
                                mr="3"
                                label={
                                  holdout?.environmentSettings[value].enabled
                                    ? (envRules.length + 1).toString()
                                    : envRules.length.toString()
                                }
                                radius="full"
                                variant="solid"
                                color="violet"
                              />
                            </Flex>
                          );
                        }}
                      />
                    </Container>
                  </Flex>
                )}
              </Flex>
            </TabsList>
            <Link
              ml="2"
              onClick={() => setCompareEnvModal({ sourceEnv: env })}
              underline="none"
              wrap="nowrap"
              size="1"
            >
              Compare environments
            </Link>
          </Flex>
        </Container>
        <RuleList
          environment={env}
          feature={feature}
          mutate={mutate}
          setRuleModal={setRuleModal}
          setCopyRuleModal={setCopyRuleModal}
          version={currentVersion}
          setVersion={setVersion}
          locked={isLocked}
          experimentsMap={experimentsMap}
          hideInactive={hideInactive}
          isDraft={isDraft}
          safeRolloutsMap={safeRolloutsMap}
          holdout={holdout}
          openHoldoutModal={() => setHoldoutModal(true)}
          canEditDrafts={canEditDrafts}
          isSafeRolloutPromoEnabled={isSafeRolloutPromoEnabled}
          hasSafeRollout={hasSafeRollout}
          environments={environments}
        />
      </Tabs>
      {ruleModal !== null && (
        <RuleModal
          feature={feature}
          close={() => setRuleModal(null)}
          i={ruleModal.i}
          safeRolloutsMap={safeRolloutsMap}
          environment={ruleModal.environment}
          mutate={mutate}
          defaultType={ruleModal.defaultType || ""}
          version={currentVersion}
          setVersion={setVersion}
          revisions={revisions}
          mode={ruleModal.mode}
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
          safeRolloutsMap={safeRolloutsMap}
        />
      )}
      {compareEnvModal !== null && (
        <CompareEnvironmentsModal
          feature={feature}
          sourceEnv={compareEnvModal.sourceEnv}
          targetEnv={compareEnvModal.targetEnv}
          setSourceEnv={(sourceEnv) =>
            setCompareEnvModal({ ...compareEnvModal, sourceEnv })
          }
          setTargetEnv={(targetEnv) =>
            setCompareEnvModal({ ...compareEnvModal, targetEnv })
          }
          version={currentVersion}
          setVersion={setVersion}
          setEnvironment={setEnv}
          cancel={() => setCompareEnvModal(null)}
          mutate={mutate}
        />
      )}
      {holdoutModal && (
        <HoldoutValueModal
          feature={feature}
          close={() => setHoldoutModal(false)}
          mutate={mutate}
        />
      )}
    </>
  );
}
