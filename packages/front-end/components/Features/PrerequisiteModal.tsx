import { useForm } from "react-hook-form";
import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import React, { useMemo } from "react";
import {
  evaluatePrerequisiteState,
  getDefaultPrerequisiteCondition,
  isFeatureCyclic,
  PrerequisiteState,
} from "shared/util";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import {
  getConnectionSDKCapabilities,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import {
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
  getPrerequisites,
} from "@/services/features";
import track from "@/services/track";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useAuth } from "@/services/auth";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import Tooltip from "@/components/Tooltip/Tooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";

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
  const { features } = useFeaturesList();
  const prerequisites = getPrerequisites(feature);
  const prerequisite = prerequisites[i] ?? null;
  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);
  const { data: sdkConnectionsData } = useSDKConnections();

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
  const { apiCall } = useAuth();

  const featureOptions = features
    .filter((f) => f.id !== feature.id)
    .filter((f) => !prerequisites.map((p) => p.id).includes(f.id))
    .filter((f) => (f.project || "") === (feature.project || ""))
    .filter((f) => f.valueType === "boolean")
    .map((f) => ({ label: f.id, value: f.id }));

  const parentFeature = features.find((f) => f.id === form.watch("id"));
  const parentFeatureId = parentFeature?.id;

  const [isCyclic, cyclicFeatureId] = useMemo(() => {
    if (!parentFeatureId) return [false, null];
    const newFeature = cloneDeep(feature);
    const revision = revisions?.find((r) => r.version === version);
    newFeature.prerequisites = [...prerequisites];
    newFeature.prerequisites[i] = form.getValues();
    return isFeatureCyclic(newFeature, features, revision);
  }, [
    parentFeatureId,
    features,
    revisions,
    version,
    feature,
    prerequisites,
    form,
    i,
  ]);

  const prereqStates = useMemo(() => {
    if (!parentFeature) return null;
    const states: Record<string, PrerequisiteState> = {};
    envs.forEach((env) => {
      states[env] = evaluatePrerequisiteState(parentFeature, features, env);
    });
    return states;
  }, [parentFeature, features, envs]);

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s === "conditional");

  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities(
    sdkConnectionsData?.connections || []
  ).includes("prerequisites");

  const hasSDKWithNoPrerequisites = (sdkConnectionsData?.connections || [])
    .map((sdk) => getConnectionSDKCapabilities(sdk))
    .some((c) => !c.includes("prerequisites"));

  const canSubmit =
    !isCyclic &&
    !!parentFeature &&
    !!form.watch("id") &&
    (!hasConditionalState || hasSDKWithPrerequisites);

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      ctaEnabled={canSubmit}
      bodyClassName="mx-2"
      header={prerequisite ? "Edit Prerequisite" : "New Prerequisite"}
      submit={form.handleSubmit(async (values) => {
        if (!values.condition) {
          values.condition = getDefaultPrerequisiteCondition();
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
          }
        );
        mutate();
      })}
    >
      <div className="alert alert-info mt-2 mb-3">
        Prerequisite features must evaluate to <code>true</code> for this
        feature to be enabled.{" "}
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
      </div>

      <SelectField
        label="Select from boolean features"
        placeholder="Select feature"
        options={featureOptions}
        value={form.watch("id")}
        onChange={(v) => {
          form.setValue("id", v);
          form.setValue("condition", "");
        }}
        sort={false}
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

      {hasSDKWithNoPrerequisites && hasConditionalState && (
        <div
          className={`alert ${
            hasSDKWithPrerequisites
              ? "text-warning-orange py-0"
              : "alert-danger"
          }`}
        >
          <FaExclamationTriangle className="mr-1" />
          This prerequisite is{" "}
          <span className="text-purple font-weight-bold">
            conditionally enabled
          </span>{" "}
          in one or more environments. Conditional prerequisite evaluation
          happens in the SDK; therefore a compatible SDK version is required.{" "}
          <Tooltip
            body={
              <>
                <div>
                  {hasSDKWithPrerequisites
                    ? "Some of your SDK Connections may not support prerequisite evaluation. Use at your own risk."
                    : "None of your SDK Connections currently support prerequisite evaluation. Either upgrade your SDKs or remove this prerequisite."}
                </div>
                <div className="mt-2">
                  Prerequisite evaluation is only supported in the following
                  SDKs and versions:
                  <ul className="mb-1">
                    <li>Javascript &gt;= 0.33.0</li>
                    <li>React &gt;= 0.23.0</li>
                  </ul>
                </div>
              </>
            }
          />
        </div>
      )}
    </Modal>
  );
}
