import { useForm } from "react-hook-form";
import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import React, { useMemo } from "react";
import {
  filterEnvironmentsByFeature,
  getDefaultPrerequisiteCondition,
} from "shared/util";
import { FaExclamationTriangle } from "react-icons/fa";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { Box } from "@radix-ui/themes";
import { MinimalFeatureInfo } from "@/components/Features/PrerequisiteStatesTable";
import {
  getFeatureDefaultValue,
  getPrerequisites,
  useEnvironments,
} from "@/services/features";
import { useFeaturesNames } from "@/hooks/useFeaturesNames";
import track from "@/services/track";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useAuth } from "@/services/auth";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import Tooltip from "@/components/Tooltip/Tooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import PrerequisiteFeatureSelector from "@/components/Features/PrerequisiteFeatureSelector";
import PrerequisiteAlerts from "@/components/Features/PrerequisiteAlerts";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import {
  PrerequisiteStateResult,
  useBatchPrerequisiteStates,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
}

export default function PrerequisiteModal({
  close,
  feature,
  i,
  mutate,
}: Props) {
  const { features: featureNames } = useFeaturesNames({
    includeDefaultValue: true,
  });
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

  const selectedFeatureId = form.watch("id");
  const selectedPrerequisite = form.getValues();
  const parentFeatureMeta = featureNames.find(
    (f) => f.id === selectedFeatureId,
  );
  const parentFeature: MinimalFeatureInfo | undefined =
    parentFeatureMeta && parentFeatureMeta.defaultValue !== undefined
      ? {
          id: parentFeatureMeta.id,
          project: parentFeatureMeta.project,
          valueType: parentFeatureMeta.valueType,
          defaultValue: parentFeatureMeta.defaultValue,
        }
      : undefined;

  const featureIds = useMemo(
    () => featureNames.filter((f) => f.id !== feature?.id).map((f) => f.id),
    [featureNames, feature?.id],
  );

  const { results: batchStates, checkPrerequisiteCyclic } =
    useBatchPrerequisiteStates({
      baseFeatureId: feature.id,
      featureIds,
      environments: envs,
      enabled: featureIds.length > 0 && envs.length > 0,
      checkPrerequisite: selectedPrerequisite.id
        ? {
            id: selectedPrerequisite.id,
            condition: selectedPrerequisite.condition,
            prerequisiteIndex: i,
          }
        : undefined,
    });

  const isCyclic = checkPrerequisiteCyclic?.wouldBeCyclic ?? false;
  const cyclicFeatureId = checkPrerequisiteCyclic?.cyclicFeatureId ?? null;

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

  const wouldBeCyclicStates: Record<string, boolean> = useMemo(() => {
    if (!batchStates) return {};
    const states: Record<string, boolean> = {};
    for (const [featureId, result] of Object.entries(batchStates)) {
      states[featureId] = result.wouldBeCyclic;
    }
    return states;
  }, [batchStates]);
  const { states: prereqStates, loading: prereqStatesLoading } =
    usePrerequisiteStates({
      featureId: selectedFeatureId,
      environments: envs,
      enabled: !!selectedFeatureId,
    });

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

  const allFeatureOptions = featureNames
    .filter((f) => f.id !== feature?.id)
    .filter((f) => !f.archived)
    .filter(
      (f) =>
        !prerequisites.map((p) => p.id).includes(f.id) ||
        f.id === prerequisite?.id,
    )
    .filter((f) => f.valueType === "boolean")
    .map((f) => {
      const isSingleEnvironment = envs.length === 1;
      const featureStates = featuresStates[f.id] || {};
      const prodEnv = envs.find(
        (env) => env === "production" || env === "prod",
      );
      const targetEnv = isSingleEnvironment ? envs[0] : prodEnv;

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
        },
        project: projectId,
        projectName,
      };
    });

  allFeatureOptions.sort((a, b) => {
    if (a.meta?.disabled && !b.meta?.disabled) return 1;
    if (!a.meta?.disabled && b.meta?.disabled) return -1;
    return 0;
  });

  const featureProject = feature?.project || "";

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="lg"
      cta="Save"
      ctaEnabled={canSubmit}
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

      <label className="mt-4 d-block">
        Select prerequisite from boolean features
      </label>

      <PrerequisiteFeatureSelector
        value={form.watch("id")}
        onChange={(v) => {
          form.setValue("id", v);
          form.setValue("condition", "");
        }}
        featureOptions={allFeatureOptions}
        featureProject={featureProject}
        environments={envs}
        hasSDKWithPrerequisites={hasSDKWithPrerequisites}
      />

      {parentFeature ? (
        <Box mt="6">
          {(parentFeature?.project || "") !== featureProject ? (
            <Callout
              status="warning"
              mb="5"
              dismissible={true}
              id="prerequisite-project-mismatch--modal"
            >
              Project mismatch. Prerequisite evaluation may fail for SDK
              Connections with non-overlapping project scope.
            </Callout>
          ) : null}

          <Box mb="4" style={{ maxWidth: "100%", overflowX: "auto" }}>
            <table className="table border mb-0">
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
                    loading={prereqStatesLoading}
                  />
                </tr>
              </tbody>
            </table>
          </Box>
        </Box>
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
    </Modal>
  );
}
