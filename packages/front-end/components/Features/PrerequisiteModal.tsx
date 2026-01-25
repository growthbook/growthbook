import { useForm } from "react-hook-form";
import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import React, { useMemo, useState, useEffect } from "react";
import {
  evaluatePrerequisiteState,
  filterEnvironmentsByFeature,
  getDefaultPrerequisiteCondition,
  isFeatureCyclic,
  PrerequisiteStateResult,
} from "shared/util";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaRecycle,
} from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import clsx from "clsx";
import { FaRegCircleQuestion } from "react-icons/fa6";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import {
  getFeatureDefaultValue,
  getPrerequisites,
  useEnvironments,
  useFeaturesList,
} from "@/services/features";
import track from "@/services/track";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useAuth } from "@/services/auth";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import Tooltip from "@/components/Tooltip/Tooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  PrerequisiteAlerts,
  FeatureOptionMeta,
} from "@/components/Features/PrerequisiteTargetingField";
import { DocLink } from "@/components/DocLink";
import Modal from "@/components/Modal";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import HelperText from "@/ui/HelperText";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Switch from "@/ui/Switch";
import Callout from "@/ui/Callout";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
  revisions: FeatureRevisionInterface[];
  version: number;
}

export default function PrerequisiteModal({
  close,
  feature,
  i,
  mutate,
  revisions,
  version,
}: Props) {
  const [showOtherProjects, setShowOtherProjects] = useState(false);
  const targetProject = feature?.project || "";
  const { features } = useFeaturesList(
    showOtherProjects || !targetProject
      ? { useCurrentProject: false }
      : { project: targetProject },
  );
  const { projects } = useDefinitions();
  const prerequisites = getPrerequisites(feature);
  const prerequisite = prerequisites[i] ?? null;
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);
  const { apiCall } = useAuth();

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: feature?.project ?? "",
  }).includes("prerequisites");

  const defaultValues = {
    id: "",
    condition: getDefaultPrerequisiteCondition(),
  };

  const form = useForm<FeaturePrerequisite>({
    defaultValues: {
      id: prerequisite?.id ?? defaultValues.id,
      condition: prerequisite?.condition ?? defaultValues.condition,
    },
  });

  const parentFeature = features.find((f) => f.id === form.watch("id"));
  const parentFeatureId = parentFeature?.id;

  const [isCyclic, cyclicFeatureId] = useMemo(() => {
    if (!parentFeatureId) return [false, null];
    const newFeature = cloneDeep(feature);
    const revision = revisions?.find((r) => r.version === version);
    newFeature.prerequisites = [...prerequisites];
    newFeature.prerequisites[i] = form.getValues();

    const featuresMap = new Map(features.map((f) => [f.id, f]));
    return isFeatureCyclic(newFeature, featuresMap, revision, envs);
  }, [
    parentFeatureId,
    features,
    revisions,
    version,
    envs,
    feature,
    prerequisites,
    form,
    i,
  ]);

  const [featuresStates, wouldBeCyclicStates] = useMemo(() => {
    const featuresStates: Record<
      string,
      Record<string, PrerequisiteStateResult>
    > = {};
    const wouldBeCyclicStates: Record<string, boolean> = {};
    const featuresMap = new Map(features.map((f) => [f.id, f]));

    for (const f of features) {
      // get current states:
      const states: Record<string, PrerequisiteStateResult> = {};
      envs.forEach((env) => {
        states[env] = evaluatePrerequisiteState(f, featuresMap, env);
      });
      featuresStates[f.id] = states;

      // check if selecting this would be cyclic:
      const newFeature = cloneDeep(feature);
      const revision = revisions?.find((r) => r.version === version);
      newFeature.prerequisites = [...prerequisites];
      newFeature.prerequisites[i] = {
        id: f.id,
        condition: getDefaultPrerequisiteCondition(),
      };
      wouldBeCyclicStates[f.id] = isFeatureCyclic(
        newFeature,
        featuresMap,
        revision,
        envs,
      )[0];
    }
    return [featuresStates, wouldBeCyclicStates];
  }, [feature, features, envs, i, prerequisites, revisions, version]);

  const prereqStates = featuresStates?.[form.watch("id")];

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const canSubmit =
    !isCyclic &&
    !!parentFeature &&
    !!form.watch("id") &&
    (!hasConditionalState || hasSDKWithPrerequisites);

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => {
      map.set(p.id, p.name);
    });
    return map;
  }, [projects]);

  const selectedFeatureId = form.watch("id");

  const featuresMap = useMemo(
    () => new Map(features.map((f) => [f.id, f])),
    [features],
  );

  // Check if selected feature is from another project
  const hasCrossProjectPrerequisite = useMemo(() => {
    if (!targetProject || !selectedFeatureId) return false;
    const selectedFeature = featuresMap.get(selectedFeatureId);
    // If feature is not in the fetched list, or its project doesn't match targetProject, it's cross-project
    return (
      selectedFeatureId !== feature?.id &&
      (!selectedFeature || selectedFeature.project !== targetProject)
    );
  }, [targetProject, selectedFeatureId, featuresMap, feature?.id]);

  // Auto-enable showing other projects if we detect cross-project prerequisites
  useEffect(() => {
    if (hasCrossProjectPrerequisite && !showOtherProjects) {
      setShowOtherProjects(true);
    }
  }, [hasCrossProjectPrerequisite, showOtherProjects]);

  const allFeatureOptions = features
    .filter((f) => f.id !== feature?.id)
    .filter(
      (f) =>
        !prerequisites.map((p) => p.id).includes(f.id) ||
        f.id === prerequisite?.id,
    )
    .filter((f) => f.valueType === "boolean")
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

  if (
    selectedFeatureId &&
    !featuresMap.has(selectedFeatureId) &&
    selectedFeatureId !== feature?.id
  ) {
    // This feature is selected but not in the filtered list - it's from another project
    allFeatureOptions.push({
      label: selectedFeatureId,
      value: selectedFeatureId,
      meta: {
        conditional: false,
        cyclic: false,
        wouldBeCyclic: false,
        disabled: false,
        isOtherProject: true,
      } as FeatureOptionMeta,
      project: "",
      projectName: null,
    });
  }

  allFeatureOptions.sort((a, b) => {
    if (b.meta?.disabled) return -1;
    return 0;
  });

  const featureProject = feature?.project || "";
  const featureOptionsInProject = allFeatureOptions.filter(
    (f) => !f.meta?.isOtherProject && (f.project || "") === featureProject,
  );
  const featureOptionsInOtherProjects = allFeatureOptions.filter(
    (f) => f.meta?.isOtherProject || (f.project || "") !== featureProject,
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
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="lg"
      cta="Save"
      ctaEnabled={canSubmit}
      bodyClassName="mx-2"
      header={prerequisite ? "Edit Prerequisite" : "New Prerequisite"}
      submit={form.handleSubmit(async (values) => {
        if (!values.condition) {
          values.condition = getDefaultPrerequisiteCondition(parentFeature);
        }
        const action = i === prerequisites.length ? "add" : "edit";

        track("Save Prerequisite", {
          source: action,
          prerequisiteIndex: i,
        });

        await apiCall<{ version: number }>(
          `/feature/${feature.id}/prerequisite`,
          {
            method: action === "add" ? "POST" : "PUT",
            body: JSON.stringify({
              prerequisite: values,
              i,
            }),
          },
        );
        mutate();
      })}
    >
      <Callout status="info" mt="2" mb="3" contentsAs="div">
        Prerequisite features must evaluate to{" "}
        <span className="rounded px-1 bg-light">
          <ValueDisplay value={"true"} type="boolean" />
        </span>{" "}
        for this feature to be enabled.{" "}
        <Tooltip
          body={
            <>
              Only <strong>boolean</strong> features may be used as top-level
              prerequisites. To implement prerequisites using non-boolean
              features or non-standard targeting rules, you may add prerequisite
              targeting to a feature rule.
            </>
          }
        />
      </Callout>

      <Flex align="center" justify="between" mt="4">
        <label>Select feature from boolean features</label>
        {targetProject ? (
          <Switch
            value={showOtherProjects}
            onChange={setShowOtherProjects}
            label="Show options in other projects"
            size="1"
            disabled={hasCrossProjectPrerequisite}
          />
        ) : null}
      </Flex>

      <SelectField
        placeholder="Select feature"
        options={groupedFeatureOptions}
        value={form.watch("id")}
        onChange={(v) => {
          const meta = featureOptions.find((o) => o.value === v)?.meta;
          if (meta?.disabled) return;
          form.setValue("id", v);
          form.setValue("condition", "");
        }}
        sort={false}
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
        formatOptionLabel={({ value, label }) => {
          const option = featureOptions.find((o) => o.value === value);
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
              {option?.meta?.isOtherProject ? (
                <em
                  className="text-muted small float-right position-relative"
                  style={{ top: 3, opacity: 0.5 }}
                >
                  in another project
                </em>
              ) : projectName ? (
                <OverflowText
                  maxWidth={150}
                  className="text-muted small float-right text-right position-relative"
                  style={{ top: 3 }}
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
                      {environments.length > 1 && " in some environments"}.
                      {!hasSDKWithPrerequisites && (
                        <>
                          {" "}
                          None of your SDK Connections in this project support
                          evaluating Schrödinger states.
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
      />

      {parentFeature ? (
        <div>
          <div className="mb-2">
            <a
              href={`/features/${form.watch("id")}`}
              target="_blank"
              rel="noreferrer"
            >
              {form.watch("id")}
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

          <table className="table mb-4 border">
            <thead className="bg-light text-dark">
              <tr>
                <th className="pl-4">Type</th>
                <th className="border-right">Default value</th>
                {envs.map((env) => (
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
                      maxHeight: 120,
                      overflowY: "auto",
                      overflowX: "auto",
                      maxWidth: "100%",
                    }}
                  />
                </td>
                <PrerequisiteStatesCols
                  prereqStates={prereqStates ?? undefined}
                  envs={envs}
                />
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {isCyclic && (
        <div className="alert alert-danger">
          <FaExclamationTriangle />
          <code>{cyclicFeatureId}</code> creates a circular dependency. Select a
          different feature.
        </div>
      )}

      {hasConditionalState && (
        <PrerequisiteAlerts
          project={feature.project || ""}
          environments={envs}
        />
      )}

      <div className="float-right mt-1">
        <DocLink docSection="prerequisites">
          docs <PiArrowSquareOut />
        </DocLink>
      </div>
    </Modal>
  );
}
