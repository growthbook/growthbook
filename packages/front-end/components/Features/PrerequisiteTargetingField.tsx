/* eslint-disable react-hooks/exhaustive-deps */

import {
  FeatureInterface,
  FeaturePrerequisite,
  ForceRule,
} from "shared/types/feature";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaMinusCircle,
  FaPlusCircle,
  FaRecycle,
} from "react-icons/fa";
import React, { useEffect, useMemo, useState } from "react";
import {
  evaluatePrerequisiteState,
  getDefaultPrerequisiteCondition,
  isFeatureCyclic,
  PrerequisiteStateResult,
} from "shared/util";
import { BiHide, BiShow } from "react-icons/bi";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { FaRegCircleQuestion } from "react-icons/fa6";
import clsx from "clsx";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue, useFeaturesList } from "@/services/features";
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
import HelperText from "@/ui/HelperText";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

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
  revisions,
  version,
  environments,
  setPrerequisiteTargetingSdkIssues,
}: Props) {
  const { features } = useFeaturesList(false);
  const { projects } = useDefinitions();
  const envsStr = JSON.stringify(environments);
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
      const parentFeature = features.find((f) => f.id === v.id);
      const parentCondition = v.condition;
      if (parentFeature) {
        if (parentCondition === "" || parentCondition === "{}") {
          const condStr = getDefaultPrerequisiteCondition(parentFeature);
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
  }, [valueStr]);

  const prereqStatesArr: (Record<string, PrerequisiteStateResult> | null)[] =
    useMemo(() => {
      const featuresMap = new Map(features.map((f) => [f.id, f]));
      return value.map((v) => {
        const parentFeature = featuresMap.get(v.id);
        if (!parentFeature) return null;
        const states: Record<string, PrerequisiteStateResult> = {};
        environments.forEach((env) => {
          states[env] = evaluatePrerequisiteState(
            parentFeature,
            featuresMap,
            env,
          );
        });
        return states;
      });
    }, [valueStr, features, envsStr]);

  const [featuresStates, wouldBeCyclicStates] = useMemo(() => {
    const featuresStates: Record<
      string,
      Record<string, PrerequisiteStateResult>
    > = {};
    const featuresMap = new Map(features.map((f) => [f.id, f]));
    const wouldBeCyclicStates: Record<string, boolean> = {};
    for (const f of features) {
      // get current states:
      const states: Record<string, PrerequisiteStateResult> = {};
      environments.forEach((env) => {
        states[env] = evaluatePrerequisiteState(f, featuresMap, env);
      });
      featuresStates[f.id] = states;

      // check if selecting this would be cyclic:
      let wouldBeCyclic = false;
      if (feature?.environmentSettings?.[environments?.[0]]?.rules) {
        const newFeature = cloneDeep(feature);
        const revision = revisions?.find((r) => r.version === version);
        const newRevision = cloneDeep(revision);
        const fakeRule: ForceRule = {
          type: "force",
          description: "fake rule",
          id: "fake-rule",
          value: "true",
          prerequisites: [
            {
              id: f.id,
              condition: getDefaultPrerequisiteCondition(),
            },
          ],
          enabled: true,
        };
        if (newRevision) {
          newRevision.rules[environments[0]] =
            newRevision.rules[environments[0]] || [];
          newRevision.rules[environments[0]].push(fakeRule);
        } else {
          newFeature.environmentSettings[environments[0]].rules.push(fakeRule);
        }

        wouldBeCyclic = isFeatureCyclic(
          newFeature,
          featuresMap,
          newRevision,
          environments,
        )[0];
      }
      wouldBeCyclicStates[f.id] = wouldBeCyclic;
    }
    return [featuresStates, wouldBeCyclicStates];
  }, [features, envsStr]);

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
  }, [prereqStatesArr, features, valueStr, hasSDKWithPrerequisites]);

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

  const allFeatureOptions = features
    .filter((f) => f.id !== feature?.id)
    .map((f) => {
      const conditional = Object.values(featuresStates[f.id]).some(
        (s) => s.state === "conditional",
      );
      const cyclic = Object.values(featuresStates[f.id]).some(
        (s) => s.state === "cyclic",
      );
      const wouldBeCyclic = wouldBeCyclicStates[f.id];
      const disabled =
        (!hasSDKWithPrerequisites && conditional) || cyclic || wouldBeCyclic;
      const projectId = f.project || "";
      const projectName = projectId ? projectMap.get(projectId) : null;
      return {
        label: f.id,
        value: f.id,
        meta: { conditional, cyclic, wouldBeCyclic, disabled },
        project: projectId,
        projectName,
      };
    })
    .sort((a, b) => {
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
    <div className="form-group my-4">
      <div className="mb-2">
        <PremiumTooltip
          commercialFeature="prerequisite-targeting"
          premiumText="Prerequisite targeting is available for Enterprise customers"
        >
          <label className="mb-0">Target by Prerequisite Features</label>
        </PremiumTooltip>
      </div>
      {value.length > 0 ? (
        <>
          {value.map((v, i) => {
            const parentFeature = features.find((f) => f.id === v.id);
            const prereqStates = prereqStatesArr[i];
            const hasConditionalState = Object.values(prereqStates || {}).some(
              (s) => s.state === "conditional",
            );

            return (
              <div key={i} className="appbox bg-light px-3 py-3">
                <div className="row mb-1">
                  <div className="col">
                    <label className="mb-0">Feature</label>
                  </div>
                  <div className="col-md-auto col-sm-12">
                    <button
                      className="btn btn-link py-0 text-danger position-relative"
                      style={{ top: -4 }}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setValue([...value.slice(0, i), ...value.slice(i + 1)]);
                      }}
                    >
                      <FaMinusCircle className="mr-1" />
                      remove
                    </button>
                  </div>
                </div>

                <div className="row">
                  <div className="col">
                    <SelectField
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
                  </div>
                </div>

                <PrereqStatesRows
                  parentFeature={parentFeature}
                  prereqStates={prereqStatesArr[i]}
                  environments={environments}
                  featureProject={featureProject}
                />

                {parentFeature && hasConditionalState ? (
                  <PrerequisiteAlerts
                    environments={environments}
                    project={parentFeature.project || ""}
                  />
                ) : null}

                <div className="mt-2">
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
                </div>
              </div>
            );
          })}

          <div className="float-right small">
            <DocLink
              docSection="prerequisites"
              className="align-self-center ml-2 pb-1"
            >
              View Documentation
            </DocLink>
          </div>

          <div
            className={clsx(
              "d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer",
              {
                "opacity-50 cursor-not-allowed":
                  !hasPrerequisitesCommercialFeature,
              },
            )}
            onClick={(e) => {
              if (!hasPrerequisitesCommercialFeature) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              setValue([
                ...value,
                {
                  id: "",
                  condition: "{}",
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            Add prerequisite
          </div>
        </>
      ) : (
        <div>
          <div className="font-italic text-muted mr-3">
            No prerequisite targeting applied.
          </div>
          <div
            className={clsx(
              "d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer",
              {
                "opacity-50 cursor-not-allowed":
                  !hasPrerequisitesCommercialFeature,
              },
            )}
            style={{ paddingLeft: 0 }}
            onClick={(e) => {
              if (!hasPrerequisitesCommercialFeature) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              setValue([
                ...value,
                {
                  id: "",
                  condition: "{}",
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            Add prerequisite targeting
          </div>
        </div>
      )}
    </div>
  );
}

function PrereqStatesRows({
  parentFeature,
  prereqStates,
  environments,
  featureProject,
}: {
  parentFeature?: FeatureInterface;
  prereqStates: Record<string, PrerequisiteStateResult> | null;
  environments: string[];
  featureProject: string;
}) {
  const [showDetails, setShowDetails] = useState(true);

  if (!parentFeature) {
    return null;
  }

  return (
    <>
      <div className="d-flex align-items-center mt-1">
        <div className="flex-1" />
        <span
          className="link-purple cursor-pointer"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? (
            <>
              <BiHide /> Hide details
            </>
          ) : (
            <>
              <BiShow /> Show details
            </>
          )}
        </span>
      </div>

      {showDetails && (
        <div>
          <div className="mb-2">
            <a
              className="a nowrap"
              href={`/features/${parentFeature.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {parentFeature.id}
              <FaExternalLinkAlt className="ml-1" />
            </a>
          </div>

          {(parentFeature?.project || "") !== featureProject ? (
            <HelperText status="warning" mt="3" mb="6">
              The prerequisite&apos;s project does not match this feature&apos;s
              project. For SDK connections that do not overlap in project scope,
              prerequisite evaluation will not pass.
            </HelperText>
          ) : null}

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
                />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export const PrerequisiteAlerts = ({
  environments,
  type = "prerequisite",
  project,
}: {
  environments: string[];
  type?: "feature" | "prerequisite";
  project: string;
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
    <div
      className={`mt-2 mb-3 alert ${
        hasSDKWithPrerequisites ? "alert-warning" : "alert-danger"
      }`}
    >
      <div>
        <FaExclamationTriangle className="mr-1" />
        This {type} is in a{" "}
        <span className="text-warning-orange font-weight-bold">
          Schrödinger state
        </span>{" "}
        {environments.length > 1
          ? "in some environments"
          : "in this environment"}{" "}
        and {type === "feature" && "its prerequisites "}must be evaluated at
        runtime in the SDK.{" "}
        {hasSDKWithPrerequisites ? (
          <>
            However, some of your{" "}
            <a href="/sdks" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </a>{" "}
            in this project may not support prerequisite evaluation.
          </>
        ) : (
          <>
            However, none of your{" "}
            <a href="/sdks" className="text-normal" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </a>{" "}
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
      </div>
    </div>
  );
};
