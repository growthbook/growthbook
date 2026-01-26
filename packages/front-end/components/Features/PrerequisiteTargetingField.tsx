/* eslint-disable react-hooks/exhaustive-deps */

import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";

interface MinimalFeatureInfo {
  id: string;
  valueType: "boolean" | "string" | "number" | "json";
  project?: string;
  defaultValue?: string;
}
import {
  FaExclamationCircle,
  FaExternalLinkAlt,
  FaRecycle,
} from "react-icons/fa";
import {
  PiXBold,
  PiPlusBold,
  PiPlusCircleBold,
  PiArrowSquareOut,
} from "react-icons/pi";
import React, { useEffect, useMemo, useState } from "react";
import { getDefaultPrerequisiteCondition } from "shared/util";
import { BiHide, BiShow } from "react-icons/bi";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { FaRegCircleQuestion } from "react-icons/fa6";
import clsx from "clsx";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Box, Flex, Text, IconButton } from "@radix-ui/themes";
import RadixTooltip from "@/ui/Tooltip";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue } from "@/services/features";
import { useFeaturesNames } from "@/hooks/useFeaturesNames";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { DocLink } from "@/components/DocLink";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import { useDefinitions } from "@/services/DefinitionsContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import {
  PrerequisiteStateResult,
  useBatchPrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";

export interface Props {
  value: FeaturePrerequisite[];
  setValue: (prerequisites: FeaturePrerequisite[]) => void;
  feature?: FeatureInterface;
  project?: string; // only used if feature is not provided
  revisions?: FeatureRevisionInterface[];
  version?: number;
  environments: string[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
}

export interface FeatureOptionMeta {
  conditional: boolean;
  cyclic: boolean;
  wouldBeCyclic: boolean;
  disabled: boolean;
}

export default function PrerequisiteTargetingField({
  value,
  setValue,
  feature,
  project,
  revisions: _revisions,
  version: _version,
  environments,
  setPrerequisiteTargetingSdkIssues,
}: Props) {
  const { features: featureNames } = useFeaturesNames({
    includeDefaultValue: true,
  });
  const { projects } = useDefinitions();
  const valueStr = JSON.stringify(value);

  const [conditionKeys, forceConditionRender] = useArrayIncrementer();

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
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const parentFeatureMeta = featureNames.find((f) => f.id === v.id);
      const parentCondition = v.condition;
      if (parentFeatureMeta && parentFeatureMeta.defaultValue !== undefined) {
        if (parentCondition === "" || parentCondition === "{}") {
          const condStr = getDefaultPrerequisiteCondition({
            valueType: parentFeatureMeta.valueType,
          });
          setValue([
            ...value.slice(0, i),
            {
              id: v.id,
              condition: condStr,
            },
            ...value.slice(i + 1),
          ]);
          forceConditionRender(i);
        }
      }
    }
  }, [valueStr, featureNames]);

  // Get all feature IDs that we need states for (dropdown options + selected prerequisites)
  const allFeatureIds = useMemo(() => {
    const selectedIds = value.map((v) => v.id).filter(Boolean);
    const dropdownIds = featureNames
      .filter((f) => f.id !== feature?.id)
      .map((f) => f.id);
    return [...new Set([...selectedIds, ...dropdownIds])];
  }, [value, featureNames, feature?.id]);

  // Fetch prerequisite states and cyclic checks from backend for all relevant features
  const targetFeatureId = feature?.id || "";
  const { results: batchStates, loading: batchStatesLoading } =
    useBatchPrerequisiteStates({
      targetFeatureId,
      featureIds: allFeatureIds,
      environments,
      enabled:
        !!targetFeatureId &&
        allFeatureIds.length > 0 &&
        environments.length > 0,
    });

  // Extract prerequisite states from backend response
  const featuresStates: Record<
    string,
    Record<string, PrerequisiteStateResult>
  > = useMemo(() => {
    if (!batchStates) return {};
    const states: Record<string, Record<string, PrerequisiteStateResult>> = {};
    for (const [featureId, result] of Object.entries(batchStates)) {
      states[featureId] = result.states;
    }
    return states;
  }, [batchStates]);

  // Map selected prerequisites to their states
  const prereqStatesArr: (Record<string, PrerequisiteStateResult> | null)[] =
    useMemo(() => {
      return value.map((v) => {
        if (!v.id) return null;
        return featuresStates[v.id] || null;
      });
    }, [value, featuresStates]);

  // Extract wouldBeCyclic flags from backend response
  const wouldBeCyclicStates: Record<string, boolean> = useMemo(() => {
    if (!batchStates) return {};
    const states: Record<string, boolean> = {};
    for (const [featureId, result] of Object.entries(batchStates)) {
      states[featureId] = result.wouldBeCyclic;
    }
    return states;
  }, [batchStates]);

  const blockedBySdkLimitations = useMemo(() => {
    for (let i = 0; i < prereqStatesArr.length; i++) {
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
  }, [prereqStatesArr, valueStr, hasSDKWithPrerequisites]);

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
      const conditional = Object.values(featuresStates[f.id] || {}).some(
        (s) => s.state === "conditional",
      );
      const cyclic = Object.values(featuresStates[f.id] || {}).some(
        (s) => s.state === "cyclic",
      );
      const wouldBeCyclic = wouldBeCyclicStates[f.id] || false;
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
        } as FeatureOptionMeta,
        project: projectId,
        projectName,
      };
    });

  allFeatureOptions.sort((a, b) => {
    if (b.meta?.disabled) return -1;
    return 0;
  });

  const featureProject = (feature ? feature?.project : project) || "";
  const featureOptionsInProject = allFeatureOptions.filter(
    (f) => (f.project || "") === featureProject,
  );
  const featureOptionsInOtherProjects = allFeatureOptions.filter(
    (f) => (f.project || "") !== featureProject,
  );

  const featureOptions = [
    ...featureOptionsInProject,
    ...featureOptionsInOtherProjects,
  ];

  const groupedFeatureOptions: (GroupedValue & {
    options: (SingleValue & { meta?: FeatureOptionMeta })[];
  })[] = [];

  const projectGroupOptions = featureOptionsInProject.map((f) => ({
    label: f.label,
    value: f.value,
    meta: f.meta,
  }));

  groupedFeatureOptions.push({
    label: featureProject === "" ? "In no project" : "In this project",
    options: projectGroupOptions,
  });

  if (featureOptionsInOtherProjects.length > 0) {
    groupedFeatureOptions.push({
      label: "In other projects",
      options: featureOptionsInOtherProjects.map((f) => ({
        label: f.label,
        value: f.value,
        meta: f.meta,
      })),
    });
  }

  return (
    <Box my="4">
      <PremiumTooltip
        commercialFeature="prerequisite-targeting"
        premiumText="Prerequisite targeting is available for Enterprise customers"
      >
        <label style={{ marginBottom: 0 }} className="mb-2 d-block">
          Target by Prerequisite Features (
          <DocLink docSection="prerequisites">
            docs <PiArrowSquareOut />
          </DocLink>
          )
        </label>
      </PremiumTooltip>
      {value.length > 0 ? (
        <>
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

            return (
              <Box key={i} className="appbox bg-light px-3 py-3" mb="4">
                <Box mb="2">
                  <label style={{ marginBottom: 0 }}>Feature</label>
                </Box>

                <Flex align="start" gap="2" mb="2">
                  <Box style={{ flex: "1 1 0", minWidth: 0 }}>
                    <SelectField
                      useMultilineLabels={true}
                      placeholder="Select feature"
                      options={groupedFeatureOptions}
                      value={v.id}
                      onChange={(v) => {
                        const meta = featureOptions.find(
                          (o) => o.value === v,
                        )?.meta;
                        if (meta?.disabled) return;
                        setValue([
                          ...value.slice(0, i),
                          {
                            id: v,
                            condition: "",
                          },
                          ...value.slice(i + 1),
                        ]);
                      }}
                      key={`parentId-${i}`}
                      sort={false}
                      formatOptionLabel={({ value, label }) => {
                        const option = featureOptions.find(
                          (o) => o.value === value,
                        );
                        const meta = option?.meta;
                        const projectName = option?.projectName;
                        return (
                          <div
                            className={clsx({
                              "cursor-disabled": !!meta?.disabled,
                            })}
                          >
                            <span
                              className="mr-2"
                              style={{ opacity: meta?.disabled ? 0.5 : 1 }}
                            >
                              {label}
                            </span>
                            {projectName ? (
                              <OverflowText
                                maxWidth={150}
                                className="text-muted small float-right text-right"
                              >
                                project: <strong>{projectName}</strong>
                              </OverflowText>
                            ) : (
                              <em
                                className="text-muted small float-right position-relative"
                                style={{ top: 3, opacity: 0.5 }}
                              >
                                no project
                              </em>
                            )}
                            {meta?.wouldBeCyclic && (
                              <Tooltip
                                body="Selecting this feature would create a cyclic dependency."
                                className="mr-2"
                              >
                                <FaRecycle
                                  className="text-muted position-relative"
                                  style={{ zIndex: 1 }}
                                />
                              </Tooltip>
                            )}
                            {meta?.conditional && (
                              <Tooltip
                                body={
                                  <>
                                    This feature is in a{" "}
                                    <span className="text-warning-orange font-weight-bold">
                                      Schrödinger state
                                    </span>
                                    {environments.length > 1 &&
                                      " in some environments"}
                                    .
                                    {!hasSDKWithPrerequisites && (
                                      <>
                                        {" "}
                                        None of your SDK Connections in this
                                        project support evaluating Schrödinger
                                        states.
                                      </>
                                    )}
                                  </>
                                }
                                className="mr-2"
                              >
                                <FaRegCircleQuestion
                                  className="text-warning-orange position-relative"
                                  style={{ zIndex: 1 }}
                                />
                              </Tooltip>
                            )}
                            {meta?.cyclic && (
                              <Tooltip
                                body="This feature has a cyclic dependency."
                                className="mr-2"
                              >
                                <FaExclamationCircle
                                  className="text-danger position-relative"
                                  style={{ zIndex: 1 }}
                                />
                              </Tooltip>
                            )}
                          </div>
                        );
                      }}
                      formatGroupLabel={({ label }) => {
                        return (
                          <div
                            className={clsx("pt-2 pb-1 text-muted", {
                              "border-top":
                                label === "In other projects" &&
                                featureOptionsInProject.length > 0,
                            })}
                          >
                            {label}
                          </div>
                        );
                      }}
                    />
                  </Box>
                  <Box px="1" pt="3" style={{ width: 16 }}>
                    <RadixTooltip content="Remove prerequisite">
                      <IconButton
                        type="button"
                        color="red"
                        variant="ghost"
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
                  </Box>
                </Flex>

                <PrereqStatesRows
                  parentFeature={parentFeature}
                  prereqStates={prereqStatesArr[i]}
                  environments={environments}
                  featureProject={featureProject}
                  loading={batchStatesLoading}
                />

                {parentFeature && hasConditionalState ? (
                  <PrerequisiteAlerts
                    environments={environments}
                    project={parentFeature.project || ""}
                    size="sm"
                  />
                ) : null}

                <Box mt="2">
                  {parentFeature ? (
                    <PrerequisiteInput
                      defaultValue={v.condition}
                      onChange={(s) => {
                        setValue([
                          ...value.slice(0, i),
                          {
                            id: v.id,
                            condition: s,
                          },
                          ...value.slice(i + 1),
                        ]);
                      }}
                      parentFeature={parentFeature}
                      prereqStates={prereqStates}
                      key={conditionKeys[i]}
                    />
                  ) : null}
                </Box>
              </Box>
            );
          })}

          <Box mt="2">
            <Link
              onClick={() => {
                if (!hasPrerequisitesCommercialFeature) {
                  return;
                }
                setValue([
                  ...value,
                  {
                    id: "",
                    condition: "{}",
                  },
                ]);
              }}
              style={{
                opacity: !hasPrerequisitesCommercialFeature ? 0.5 : 1,
                cursor: !hasPrerequisitesCommercialFeature
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              <Text weight="bold">
                <PiPlusBold className="mr-1" />
                Add another prerequisite
              </Text>
            </Link>
          </Box>
        </>
      ) : (
        <Box>
          <Text color="gray" style={{ fontStyle: "italic" }} mr="3" mb="2">
            No prerequisite targeting applied.
          </Text>
          <Box mt="2">
            <Link
              onClick={() => {
                if (!hasPrerequisitesCommercialFeature) {
                  return;
                }
                setValue([
                  ...value,
                  {
                    id: "",
                    condition: "{}",
                  },
                ]);
              }}
              style={{
                opacity: !hasPrerequisitesCommercialFeature ? 0.5 : 1,
                cursor: !hasPrerequisitesCommercialFeature
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              <Text weight="bold">
                <PiPlusCircleBold className="mr-1" />
                Add prerequisite targeting
              </Text>
            </Link>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function PrereqStatesRows({
  parentFeature,
  prereqStates,
  environments,
  featureProject,
  loading = false,
}: {
  parentFeature?: MinimalFeatureInfo;
  prereqStates: Record<string, PrerequisiteStateResult> | null;
  environments: string[];
  featureProject: string;
  loading?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(true);

  if (!parentFeature) {
    return null;
  }

  return (
    <>
      <Flex align="center" justify="between" mt="1" mb="2">
        <Link
          href={`/features/${parentFeature.id}`}
          target="_blank"
          style={{ whiteSpace: "nowrap" }}
        >
          {parentFeature.id}
          <FaExternalLinkAlt style={{ marginLeft: 4 }} />
        </Link>
        <Link onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? (
            <>
              <BiHide /> Hide details
            </>
          ) : (
            <>
              <BiShow /> Show details
            </>
          )}
        </Link>
      </Flex>

      {(parentFeature?.project || "") !== featureProject ? (
        <Callout
          status="warning"
          mb="3"
          size="sm"
          dismissible={true}
          id="prerequisite-project-mismatch--field"
        >
          The prerequisite&apos;s project does not match this feature&apos;s
          project. For SDK connections that do not overlap in project scope,
          prerequisite evaluation will not pass.
        </Callout>
      ) : null}

      {showDetails && (
        <Box>
          <table className="table mb-4 border bg-white">
            <thead className="text-dark">
              <tr>
                <th className="pl-4">Type</th>
                <th className="border-right">Default value</th>
                {environments.map((env) => (
                  <th key={env} className="text-center">
                    {env}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pl-4">
                  {parentFeature.valueType === "json"
                    ? "JSON"
                    : parentFeature.valueType}
                </td>
                <td className="border-right" style={{ maxWidth: 400 }}>
                  <ValueDisplay
                    value={getFeatureDefaultValue(parentFeature)}
                    type={parentFeature.valueType}
                    fullStyle={{
                      maxHeight: 80,
                      overflowY: "auto",
                      overflowX: "auto",
                      maxWidth: "100%",
                    }}
                  />
                </td>
                <PrerequisiteStatesCols
                  prereqStates={prereqStates ?? undefined}
                  envs={environments}
                  loading={loading}
                />
              </tr>
            </tbody>
          </table>
        </Box>
      )}
    </>
  );
}

export const PrerequisiteAlerts = ({
  environments,
  type = "prerequisite",
  project,
  size,
  mt = "0",
  mb = "4",
}: {
  environments: string[];
  type?: "feature" | "prerequisite";
  project: string;
  size?: "sm" | "md";
  mt?: string;
  mb?: string;
}) => {
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project,
  }).includes("prerequisites");
  const hasSDKWithNoPrerequisites = !getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    mustMatchAllConnections: true,
    project,
  }).includes("prerequisites");

  if (!hasSDKWithNoPrerequisites) {
    return null;
  }

  return (
    <Callout
      size={size}
      status={hasSDKWithPrerequisites ? "warning" : "error"}
      mb={mb}
      mt={mt}
    >
      <Text>
        This {type} is in a{" "}
        <Text weight="bold" style={{ color: "var(--orange-9)" }}>
          Schrödinger state
        </Text>{" "}
        {environments.length > 1
          ? "in some environments"
          : "in this environment"}{" "}
        and {type === "feature" && "its prerequisites "}must be evaluated at
        runtime in the SDK.{" "}
        {hasSDKWithPrerequisites ? (
          <>
            However, some of your{" "}
            <Link href="/sdks" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </Link>{" "}
            in this project may not support prerequisite evaluation.
          </>
        ) : (
          <>
            However, none of your{" "}
            <Link href="/sdks" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </Link>{" "}
            in this project support prerequisite evaluation. Either upgrade your
            SDKs or{" "}
            {type === "prerequisite"
              ? "remove this prerequisite"
              : "remove Schrödinger prerequisites"}
            .
          </>
        )}{" "}
        <Tooltip
          body={
            <>
              Prerequisite evaluation is only supported in the following SDKs
              and versions:
              <MinSDKVersionsList capability="prerequisites" />
            </>
          }
        />
      </Text>
    </Callout>
  );
};
