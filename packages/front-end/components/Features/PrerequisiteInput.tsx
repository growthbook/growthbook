import React, { useEffect, useMemo, useState } from "react";
import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import { getDefaultPrerequisiteCondition } from "shared/util";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import {
  PiXBold,
  PiPlusCircleBold,
  PiTextAa,
  PiCaretRightFill,
} from "react-icons/pi";
import { RxInfoCircled } from "react-icons/rx";
import {
  Box,
  Flex,
  IconButton,
  Tooltip as RadixTooltip,
  Separator,
  Text,
} from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { useFeaturesNames } from "@/hooks/useFeaturesNames";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  TargetingConditionsCard,
  AddConditionButton,
  ConditionRow,
  ConditionRowHeader,
} from "@/components/Features/TargetingConditionsCard";
import PrerequisiteFeatureSelector, {
  FeatureOptionMeta,
} from "@/components/Features/PrerequisiteFeatureSelector";
import PrerequisiteStatesTable, {
  MinimalFeatureInfo,
} from "@/components/Features/PrerequisiteStatesTable";
import PrerequisiteAlerts from "@/components/Features/PrerequisiteAlerts";
import {
  useBatchPrerequisiteStates,
  PrerequisiteStateResult,
} from "@/hooks/usePrerequisiteStates";
import { condToJson, jsonToConds } from "@/services/features";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import StringArrayField from "@/components/Forms/StringArrayField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Link from "@/ui/Link";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import {
  datatypeSupportsCaseInsensitive,
  getDisplayOperator,
  isCaseInsensitiveOperator,
  operatorSupportsCaseInsensitive,
  withOperatorCaseInsensitivity,
} from "./ConditionInput";

interface Props {
  value: FeaturePrerequisite[];
  setValue: (prerequisites: FeaturePrerequisite[]) => void;
  feature?: FeatureInterface;
  project?: string;
  environments: string[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
}

export default function PrerequisiteInput({
  value,
  setValue,
  feature,
  project,
  environments,
  setPrerequisiteTargetingSdkIssues,
}: Props) {
  const { features: featureNames } = useFeaturesNames({
    includeDefaultValue: true,
  });
  const { projects } = useDefinitions();
  const valueStr = JSON.stringify(value);

  const [conditionKeys, forceConditionRender] = useArrayIncrementer();
  const [advancedMode, setAdvancedMode] = useState<boolean[]>([]);

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: (feature ? feature?.project : project) ?? "",
  }).includes("prerequisites");

  const { hasCommercialFeature } = useUser();
  const hasPrerequisitesCommercialFeature = hasCommercialFeature(
    "prerequisite-targeting",
  );

  useEffect(() => {
    if (advancedMode.length !== value.length) {
      const parentValueMaps = value.map((v) => {
        const parentFeatureMeta = featureNames.find((f) => f.id === v.id);
        const map = new Map();
        if (parentFeatureMeta?.valueType) {
          map.set("value", {
            attribute: "value",
            datatype: parentFeatureMeta.valueType,
            array: false,
            identifier: false,
            enum: [],
            archived: false,
          });
        }
        return map;
      });

      setAdvancedMode(
        value.map(
          (v, i) => jsonToConds(v.condition, parentValueMaps[i]) === null,
        ),
      );
    }
  }, [value.length, featureNames, value, advancedMode.length]);

  useEffect(() => {
    const updates: Array<{ index: number; condStr: string }> = [];

    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const parentFeatureMeta = featureNames.find((f) => f.id === v.id);
      const parentCondition = v.condition;
      if (parentFeatureMeta && parentFeatureMeta.defaultValue !== undefined) {
        if (parentCondition === "" || parentCondition === "{}") {
          const condStr = getDefaultPrerequisiteCondition({
            valueType: parentFeatureMeta.valueType,
          });
          updates.push({ index: i, condStr });
        }
      }
    }

    if (updates.length > 0) {
      const newValue = [...value];
      updates.forEach(({ index, condStr }) => {
        newValue[index] = {
          id: value[index].id,
          condition: condStr,
        };
        forceConditionRender(index);
      });
      setValue(newValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueStr, featureNames]);

  const isSingleEnvironment = environments.length === 1;
  const targetFeatureId = feature?.id || "";
  const hasTargetFeature = !!targetFeatureId;

  const featureIdsToFetch = useMemo(() => {
    if (isSingleEnvironment && hasTargetFeature) {
      const selectedIds = value.map((v) => v.id).filter(Boolean);
      const dropdownIds = featureNames
        .filter((f) => f.id !== feature?.id)
        .map((f) => f.id);
      return [...new Set([...selectedIds, ...dropdownIds])];
    } else {
      return value.map((v) => v.id).filter(Boolean);
    }
  }, [isSingleEnvironment, hasTargetFeature, value, featureNames, feature?.id]);

  const { results: batchStates, loading: batchStatesLoading } =
    useBatchPrerequisiteStates({
      baseFeatureId: targetFeatureId,
      featureIds: featureIdsToFetch,
      environments,
      isExperiment: !hasTargetFeature,
      enabled: featureIdsToFetch.length > 0 && environments.length > 0,
    });

  const featuresStates: Record<
    string,
    Record<string, PrerequisiteStateResult>
  > = useMemo(() => {
    if (!batchStates) return {};
    const states: Record<string, Record<string, PrerequisiteStateResult>> = {};
    Object.entries(batchStates).forEach(([featureId, data]) => {
      states[featureId] = data.states;
    });
    return states;
  }, [batchStates]);

  const wouldBeCyclicStates: Record<string, boolean> = useMemo(() => {
    if (!batchStates) return {};
    const cyclic: Record<string, boolean> = {};
    Object.entries(batchStates).forEach(([featureId, data]) => {
      cyclic[featureId] = data.wouldBeCyclic;
    });
    return cyclic;
  }, [batchStates]);

  const prereqStatesArr = useMemo(
    () =>
      value.map((v) => {
        if (!v.id) return null;
        return featuresStates[v.id] || null;
      }),
    [value, featuresStates],
  );

  const blockedBySdkLimitations = useMemo(() => {
    for (let i = 0; i < value.length; i++) {
      const prereqStates = prereqStatesArr[i];
      if (!prereqStates) continue;
      const hasConditionalState = Object.values(prereqStates).some(
        (s) => s.state === "conditional",
      );
      if (!hasSDKWithPrerequisites && hasConditionalState) {
        return true;
      }
    }
    return false;
  }, [prereqStatesArr, hasSDKWithPrerequisites, value.length]);

  useEffect(() => {
    setPrerequisiteTargetingSdkIssues(blockedBySdkLimitations);
  }, [blockedBySdkLimitations, setPrerequisiteTargetingSdkIssues]);

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => {
      map.set(p.id, p.name);
    });
    return map;
  }, [projects]);

  const allFeatureOptions = featureNames
    .filter((f) => f.id !== feature?.id)
    .filter((f) => !f.archived)
    .map((f) => {
      const featureStates = featuresStates[f.id] || {};
      const prodEnv = environments.find(
        (env) => env === "production" || env === "prod",
      );
      const targetEnv = isSingleEnvironment ? environments[0] : prodEnv;

      const conditional = targetEnv
        ? featureStates[targetEnv]?.state === "conditional"
        : Object.values(featureStates).some((s) => s.state === "conditional");
      const cyclic = targetEnv
        ? featureStates[targetEnv]?.state === "cyclic"
        : false;
      const wouldBeCyclic = targetEnv
        ? wouldBeCyclicStates[f.id] || false
        : false;

      const states = targetEnv
        ? [featureStates[targetEnv]].filter(Boolean)
        : [];
      const allDeterministic =
        states.length > 0 && states.every((s) => s.state === "deterministic");

      const deterministicLive =
        allDeterministic &&
        states.every((s) => s.value !== null && s.value !== "false");
      const deterministicNotLive =
        allDeterministic && states.every((s) => s.value === null);
      const deterministicFalse =
        allDeterministic && states.every((s) => s.value === "false");

      const disabled =
        (!hasSDKWithPrerequisites && conditional) || cyclic || wouldBeCyclic;
      const projectId = f.project || "";
      const projectName = projectId ? projectMap.get(projectId) : null;
      return {
        label: f.id,
        value: f.id,
        meta: {
          conditional,
          cyclic,
          wouldBeCyclic,
          disabled,
          deterministicLive,
          deterministicNotLive,
          deterministicFalse,
        } as FeatureOptionMeta,
        project: projectId,
        projectName,
      };
    });

  allFeatureOptions.sort((a, b) => {
    if (a.meta?.disabled && !b.meta?.disabled) return 1;
    if (!a.meta?.disabled && b.meta?.disabled) return -1;
    return 0;
  });

  const featureProject = (feature ? feature?.project : project) || "";

  // Pre-compute parent value maps for all prerequisites (avoid hooks in map)
  const parentValueMaps = useMemo(() => {
    return value.map((v) => {
      const parentFeatureMeta = featureNames.find((f) => f.id === v.id);
      const map = new Map();
      if (parentFeatureMeta?.valueType) {
        map.set("value", {
          attribute: "value",
          datatype: parentFeatureMeta.valueType,
          array: false,
          identifier: false,
          enum: [],
          archived: false,
        });
      }
      return map;
    });
  }, [value, featureNames]);

  const updateCondition = (i: number, newCondition: string) => {
    setValue([
      ...value.slice(0, i),
      {
        id: value[i].id,
        condition: newCondition,
      },
      ...value.slice(i + 1),
    ]);
  };

  return (
    <Box my="4">
      <Flex mb="1">
        <PremiumTooltip
          commercialFeature="prerequisite-targeting"
          premiumText="Prerequisite targeting is available for Enterprise customers"
        >
          <label>Target by Prerequisite Features</label>
        </PremiumTooltip>
      </Flex>
      {value.length > 0 ? (
        <TargetingConditionsCard
          targetingType="prerequisite"
          total={value.length}
          advancedToggle={
            value.length > 0 &&
            featureNames.find((f) => f.id === value[0].id) ? (
              <Switch
                value={advancedMode[0]}
                onChange={(checked) => {
                  const newAdvancedMode = [...advancedMode];
                  newAdvancedMode[0] = checked;
                  setAdvancedMode(newAdvancedMode);
                }}
                label="Advanced"
                size="1"
              />
            ) : undefined
          }
          addButton={
            hasPrerequisitesCommercialFeature ? (
              <AddConditionButton
                onClick={() => {
                  setValue([
                    ...value,
                    {
                      id: "",
                      condition: "{}",
                    },
                  ]);
                }}
              >
                Add prerequisite
              </AddConditionButton>
            ) : undefined
          }
        >
          {value.map((v, i) => {
            const parentFeatureMeta = featureNames.find((f) => f.id === v.id);
            const parentFeature: MinimalFeatureInfo | undefined =
              parentFeatureMeta && parentFeatureMeta.defaultValue !== undefined
                ? {
                    id: parentFeatureMeta.id,
                    project: parentFeatureMeta.project,
                    valueType: parentFeatureMeta.valueType,
                    defaultValue: parentFeatureMeta.defaultValue,
                  }
                : undefined;
            const prereqStates = prereqStatesArr[i];
            const hasConditionalState = Object.values(prereqStates || {}).some(
              (s) => s.state === "conditional",
            );

            const parentValueMap = parentValueMaps[i];
            const conds = jsonToConds(v.condition, parentValueMap) || [];
            const isAdvanced = advancedMode[i];

            return (
              <React.Fragment key={conditionKeys[i]}>
                {i > 0 && (
                  <Separator
                    key={`sep-${conditionKeys[i]}`}
                    style={{
                      width: "100%",
                      backgroundColor: "var(--slate-a3)",
                    }}
                  />
                )}

                <Box>
                  {i > 0 && (
                    <ConditionRowHeader
                      label="AND"
                      advancedToggle={
                        parentFeature ? (
                          <Switch
                            value={isAdvanced}
                            onChange={(checked) => {
                              const newAdvancedMode = [...advancedMode];
                              newAdvancedMode[i] = checked;
                              setAdvancedMode(newAdvancedMode);
                            }}
                            label="Advanced"
                            size="1"
                          />
                        ) : undefined
                      }
                    />
                  )}

                  {!isAdvanced ? (
                    <>
                      <ConditionRow
                        widthMode="wide-attribute"
                        attributeSlot={
                          <PrerequisiteFeatureSelector
                            value={v.id}
                            onChange={(featureId) => {
                              setValue([
                                ...value.slice(0, i),
                                {
                                  id: featureId,
                                  condition: "",
                                },
                                ...value.slice(i + 1),
                              ]);
                            }}
                            featureOptions={allFeatureOptions}
                            featureProject={featureProject}
                            environments={environments}
                            hasSDKWithPrerequisites={hasSDKWithPrerequisites}
                          />
                        }
                        operatorSlot={
                          <Flex gap="3" align="start">
                            <Box flexGrow="1">
                              <SelectField
                                useMultilineLabels={true}
                                value={getDisplayOperator(
                                  conds?.[0]?.[0]?.operator || "",
                                )}
                                options={
                                  parentFeatureMeta?.valueType === "boolean"
                                    ? [
                                        { label: "is true", value: "$true" },
                                        { label: "is false", value: "$false" },
                                        { label: "is live", value: "$exists" },
                                        {
                                          label: "is not live",
                                          value: "$notExists",
                                        },
                                      ]
                                    : parentFeatureMeta?.valueType === "string"
                                      ? [
                                          {
                                            label: "is live",
                                            value: "$exists",
                                          },
                                          {
                                            label: "is not live",
                                            value: "$notExists",
                                          },
                                          {
                                            label: "is equal to",
                                            value: "$eq",
                                          },
                                          {
                                            label: "is not equal to",
                                            value: "$ne",
                                          },
                                          {
                                            label: "matches regex",
                                            value: "$regex",
                                          },
                                          {
                                            label: "does not match regex",
                                            value: "$notRegex",
                                          },
                                          {
                                            label: "is greater than",
                                            value: "$gt",
                                          },
                                          {
                                            label:
                                              "is greater than or equal to",
                                            value: "$gte",
                                          },
                                          {
                                            label: "is less than",
                                            value: "$lt",
                                          },
                                          {
                                            label: "is less than or equal to",
                                            value: "$lte",
                                          },
                                          { label: "is any of", value: "$in" },
                                          {
                                            label: "is none of",
                                            value: "$nin",
                                          },
                                        ]
                                      : parentFeatureMeta?.valueType ===
                                          "number"
                                        ? [
                                            {
                                              label: "is live",
                                              value: "$exists",
                                            },
                                            {
                                              label: "is not live",
                                              value: "$notExists",
                                            },
                                            {
                                              label: "is equal to",
                                              value: "$eq",
                                            },
                                            {
                                              label: "is not equal to",
                                              value: "$ne",
                                            },
                                            {
                                              label: "is greater than",
                                              value: "$gt",
                                            },
                                            {
                                              label:
                                                "is greater than or equal to",
                                              value: "$gte",
                                            },
                                            {
                                              label: "is less than",
                                              value: "$lt",
                                            },
                                            {
                                              label: "is less than or equal to",
                                              value: "$lte",
                                            },
                                            {
                                              label: "is any of",
                                              value: "$in",
                                            },
                                            {
                                              label: "is none of",
                                              value: "$nin",
                                            },
                                          ]
                                        : [
                                            {
                                              label: "is live",
                                              value: "$exists",
                                            },
                                            {
                                              label: "is not live",
                                              value: "$notExists",
                                            },
                                          ]
                                }
                                sort={false}
                                onChange={(op) => {
                                  if (!conds?.[0]?.[0]) return;
                                  const newConds = [...conds[0]];
                                  newConds[0] = {
                                    ...newConds[0],
                                    operator: withOperatorCaseInsensitivity(
                                      op,
                                      isCaseInsensitiveOperator(
                                        conds[0][0].operator,
                                      ),
                                    ),
                                  };
                                  updateCondition(
                                    i,
                                    condToJson([newConds], parentValueMap),
                                  );
                                }}
                              />
                            </Box>
                            {conds?.[0]?.[0] &&
                              operatorSupportsCaseInsensitive(
                                conds[0][0].operator,
                              ) &&
                              datatypeSupportsCaseInsensitive(
                                parentFeatureMeta?.valueType,
                              ) && (
                                <Tooltip
                                  body={`Case insensitive: ${isCaseInsensitiveOperator(conds[0][0].operator) ? "ON" : "OFF"}`}
                                >
                                  <IconButton
                                    type="button"
                                    variant={
                                      isCaseInsensitiveOperator(
                                        conds[0][0].operator,
                                      )
                                        ? "soft"
                                        : "ghost"
                                    }
                                    size="1"
                                    radius="medium"
                                    onClick={() => {
                                      const newConds = [...conds[0]];
                                      newConds[0] = {
                                        ...newConds[0],
                                        operator: withOperatorCaseInsensitivity(
                                          getDisplayOperator(
                                            conds[0][0].operator,
                                          ),
                                          !isCaseInsensitiveOperator(
                                            conds[0][0].operator,
                                          ),
                                        ),
                                      };
                                      updateCondition(
                                        i,
                                        condToJson([newConds], parentValueMap),
                                      );
                                    }}
                                    style={{
                                      width: 24,
                                      height: 24,
                                      margin: "8px 0 0 0",
                                      padding: 0,
                                    }}
                                  >
                                    <PiTextAa />
                                  </IconButton>
                                </Tooltip>
                              )}
                          </Flex>
                        }
                        valueSlot={
                          !conds?.[0]?.[0] ? null : ![
                              "$exists",
                              "$notExists",
                              "$true",
                              "$false",
                              "$empty",
                              "$notEmpty",
                            ].includes(conds[0][0].operator) ? (
                            ["$in", "$nin", "$ini", "$nini"].includes(
                              conds?.[0]?.[0]?.operator,
                            ) ? (
                              <StringArrayField
                                containerClassName="w-100"
                                value={
                                  conds[0][0].value
                                    ? conds[0][0].value.trim().split(",")
                                    : []
                                }
                                onChange={(values) => {
                                  const newConds = [...conds[0]];
                                  newConds[0] = {
                                    ...newConds[0],
                                    value: values.join(","),
                                  };
                                  updateCondition(
                                    i,
                                    condToJson([newConds], parentValueMap),
                                  );
                                }}
                                placeholder={
                                  parentFeatureMeta?.valueType === "number"
                                    ? "1, 2..."
                                    : "value 1, value 2..."
                                }
                                delimiters={["Enter", "Tab"]}
                                showCopyButton
                                required
                              />
                            ) : parentFeatureMeta?.valueType === "number" ? (
                              <Field
                                type="number"
                                step="any"
                                value={conds[0][0].value}
                                onChange={(e) => {
                                  const newConds = [...conds[0]];
                                  newConds[0] = {
                                    ...newConds[0],
                                    value: e.target.value,
                                  };
                                  updateCondition(
                                    i,
                                    condToJson([newConds], parentValueMap),
                                  );
                                }}
                                style={{ minHeight: 38 }}
                                required
                              />
                            ) : (
                              <Field
                                value={conds[0][0].value}
                                onChange={(e) => {
                                  const newConds = [...conds[0]];
                                  newConds[0] = {
                                    ...newConds[0],
                                    value: e.target.value,
                                  };
                                  updateCondition(
                                    i,
                                    condToJson([newConds], parentValueMap),
                                  );
                                }}
                                style={{ minHeight: 38 }}
                                required
                              />
                            )
                          ) : null
                        }
                        removeSlot={
                          <RadixTooltip content="Remove prerequisite">
                            <IconButton
                              type="button"
                              color="gray"
                              variant="ghost"
                              radius="full"
                              size="1"
                              onClick={() => {
                                setValue([
                                  ...value.slice(0, i),
                                  ...value.slice(i + 1),
                                ]);
                              }}
                            >
                              <PiXBold size={16} />
                            </IconButton>
                          </RadixTooltip>
                        }
                      />
                    </>
                  ) : (
                    // Advanced mode - only show feature selector
                    <>
                      <ConditionRow
                        widthMode="wide-attribute"
                        attributeSlot={
                          <PrerequisiteFeatureSelector
                            value={v.id}
                            onChange={(featureId) => {
                              setValue([
                                ...value.slice(0, i),
                                {
                                  id: featureId,
                                  condition: "",
                                },
                                ...value.slice(i + 1),
                              ]);
                            }}
                            featureOptions={allFeatureOptions}
                            featureProject={featureProject}
                            environments={environments}
                            hasSDKWithPrerequisites={hasSDKWithPrerequisites}
                          />
                        }
                        operatorSlot={null}
                        valueSlot={null}
                        removeSlot={
                          <RadixTooltip content="Remove prerequisite">
                            <IconButton
                              type="button"
                              color="gray"
                              variant="ghost"
                              radius="full"
                              size="1"
                              onClick={() => {
                                setValue([
                                  ...value.slice(0, i),
                                  ...value.slice(i + 1),
                                ]);
                              }}
                            >
                              <PiXBold size={16} />
                            </IconButton>
                          </RadixTooltip>
                        }
                      />
                    </>
                  )}

                  {isAdvanced && parentFeature && (
                    <Box mt="2" mb="4">
                      <CodeTextArea
                        language="json"
                        value={v.condition}
                        setValue={(newVal) => updateCondition(i, newVal)}
                        minLines={3}
                        maxLines={6}
                        showCopyButton={true}
                        showFullscreenButton={true}
                      />
                      <Box>
                        <Text color="gray" size="1">
                          <code>{`"value"`}</code> refers to the
                          prerequisite&apos;s evaluated value.
                          <Tooltip
                            body={
                              <div>
                                Example: <code>{`{"value": {"$gt": 3}}`}</code>
                              </div>
                            }
                            className="ml-2"
                            flipTheme={false}
                          >
                            <RxInfoCircled
                              className="text-info hover-underline"
                              style={{ verticalAlign: "middle" }}
                            />
                          </Tooltip>
                        </Text>
                      </Box>
                    </Box>
                  )}

                  {parentFeature && (
                    <Box mb="2">
                      <Collapsible
                        trigger={
                          <Link>
                            <Text color="gray">
                              <PiCaretRightFill className="chevron mr-1" />
                              Details
                            </Text>
                          </Link>
                        }
                        transitionTime={100}
                      >
                        <PrerequisiteStatesTable
                          parentFeature={parentFeature}
                          prereqStates={prereqStates}
                          environments={environments}
                          loading={batchStatesLoading}
                        />
                      </Collapsible>
                    </Box>
                  )}

                  {parentFeature &&
                    (parentFeature?.project || "") !== featureProject && (
                      <Callout
                        status="warning"
                        mb="2"
                        size="sm"
                        id="prerequisite-project-mismatch--field"
                      >
                        The prerequisite&apos;s project does not match this
                        feature&apos;s project. For SDK connections that do not
                        overlap in project scope, prerequisite evaluation will
                        not pass.
                      </Callout>
                    )}

                  {parentFeature && hasConditionalState && (
                    <PrerequisiteAlerts
                      environments={environments}
                      project={parentFeature.project || ""}
                      size="sm"
                      mb="0"
                    />
                  )}
                </Box>
              </React.Fragment>
            );
          })}
        </TargetingConditionsCard>
      ) : (
        <PremiumTooltip commercialFeature="prerequisite-targeting">
          <Link
            onClick={() => {
              setValue([{ id: "", condition: "{}" }]);
            }}
            style={{
              opacity: hasPrerequisitesCommercialFeature ? 1 : 0.5,
              cursor: hasPrerequisitesCommercialFeature
                ? "pointer"
                : "not-allowed",
            }}
          >
            <PiPlusCircleBold /> Add prerequisite targeting
          </Link>
        </PremiumTooltip>
      )}
    </Box>
  );
}
