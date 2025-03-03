import { FeatureInterface } from "back-end/types/feature";
import React, { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FeatureRevisionInterface,
  FeatureRule,
} from "back-end/src/validators/features";
import { Environment } from "back-end/types/organization";
import { Box, Container, Flex, Text } from "@radix-ui/themes";
import clsx from "clsx";
import RuleModal from "@/components/Features/RuleModal/index";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import { getRules, useEnvironmentState } from "@/services/features";
import CopyRuleModal from "@/components/Features/CopyRuleModal";
import Button from "@/components/Radix/Button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import Badge from "@/components/Radix/Badge";
import Link from "@/components/Radix/Link";
import EnvironmentDropdown from "../Environments/EnvironmentDropdown";
import CompareEnvironmentsModal from "./CompareEnvironmentsModal";

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
}) {
  const envs = environments.map((e) => e.id);
  const [env, setEnv] = useEnvironmentState();
  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
    duplicate?: boolean;
  } | null>(null);
  const [copyRuleModal, setCopyRuleModal] = useState<{
    environment: string;
    rules: FeatureRule[];
  } | null>(null);
  const [compareEnvModal, setCompareEnvModal] = useState<{
    sourceEnv?: string;
    targetEnv?: string;
  } | null>(null);

  // Make sure you can't access an invalid env tab, since active env tab is persisted via localStorage
  useEffect(() => {
    if (!envs?.length) return;
    if (!envs.includes(env)) {
      setEnv(envs[0]);
    }
  }, [envs, env, setEnv]);

  const rulesByEnv = Object.fromEntries(
    environments.map((e) => {
      const rules = getRules(feature, e.id);
      return [e.id, rules];
    })
  );

  const tabEnvs = environments.slice(0, 4);
  const dropdownEnvs = environments.slice(4);
  const selectedDropdownEnv = dropdownEnvs.find((e) => e.id === env)?.id;

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
                {tabEnvs.map((e) => (
                  <TabsTrigger value={e.id} key={e.id}>
                    <Flex maxWidth="220px">
                      <Text truncate>{e.id}</Text>
                    </Flex>
                    <Badge
                      ml="2"
                      label={rulesByEnv[e.id].length.toString()}
                      radius="full"
                      variant="solid"
                      color="violet"
                    ></Badge>
                  </TabsTrigger>
                ))}
                {dropdownEnvs.length === 1 && (
                  <TabsTrigger value={dropdownEnvs[0].id}>
                    <Flex maxWidth="220px">
                      <Text truncate>{dropdownEnvs[0].id}</Text>
                    </Flex>
                    <Badge
                      ml="2"
                      label={rulesByEnv[dropdownEnvs[0].id].length.toString()}
                      radius="full"
                      variant="solid"
                      color="violet"
                    ></Badge>
                  </TabsTrigger>
                )}
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
                        formatOptionLabel={({ value }) => (
                          <Flex align="center">
                            <Flex maxWidth="150px">
                              <Text weight="medium" truncate>
                                {value}
                              </Text>
                            </Flex>
                            <Badge
                              ml="2"
                              mr="3"
                              label={rulesByEnv[value].length.toString()}
                              radius="full"
                              variant="solid"
                              color="violet"
                            ></Badge>
                          </Flex>
                        )}
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
        {environments.map((e) => {
          return (
            <TabsContent key={e.id} value={e.id}>
              <div className="mb-4 mt-2">
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
                    hideInactive={hideInactive}
                    isDraft={isDraft}
                  />
                ) : (
                  <Box py="4" className="text-muted">
                    <em>No rules have been added to this environment yet</em>
                  </Box>
                )}

                {canEditDrafts && !isLocked && (
                  <Flex pt="4" justify="end" align="center">
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
                  </Flex>
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
          duplicate={ruleModal?.duplicate || false}
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
    </>
  );
}
