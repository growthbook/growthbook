import { useForm } from "react-hook-form";
import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { useMemo } from "react";
import {
  evaluatePrerequisiteState,
  isFeatureCyclic,
  PrerequisiteState,
} from "shared/util";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
} from "react-icons/fa";
import clsx from "clsx";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import {
  FaRegCircleCheck,
  FaRegCircleQuestion,
  FaRegCircleXmark,
} from "react-icons/fa6";
import {
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
  getPrerequisites,
  getDefaultPrerequisiteCondition,
} from "@/services/features";
import track from "@/services/track";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
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

  const canSubmit = !isCyclic && !!parentFeature && !!form.watch("id");

  const prereqStates = useMemo(() => {
    if (!parentFeature) return null;
    const states: Record<string, PrerequisiteState> = {};
    envs.forEach((env) => {
      states[env] = evaluatePrerequisiteState(parentFeature, features, env);
    });
    return states;
  }, [parentFeature, features, envs]);

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      ctaEnabled={canSubmit}
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
                <td className="border-right">
                  <div
                    className={clsx({
                      small: parentFeature.valueType === "json",
                    })}
                  >
                    <ValueDisplay
                      value={getFeatureDefaultValue(parentFeature)}
                      type={parentFeature.valueType}
                      full={false}
                    />
                  </div>
                </td>
                {envs.map((env) => (
                  <td key={env} className="text-center">
                    {prereqStates?.[env] === "on" && (
                      <Tooltip popperClassName="text-left mt-2" body="The parent feature is currently enabled in this environment">
                        <FaRegCircleCheck
                          className="text-success cursor-pointer"
                          size={24}
                        />
                      </Tooltip>
                    )}
                    {prereqStates?.[env] === "off" && (
                      <Tooltip popperClassName="text-left mt-2" body="The parent feature is currently diabled in this environment">
                        <FaRegCircleXmark
                          className="text-danger cursor-pointer"
                          size={24}
                        />
                      </Tooltip>
                    )}
                    {prereqStates?.[env] === "conditional" && (
                      <Tooltip popperClassName="text-left mt-2" body="The parent feature is currently enabled but has rules which make the result conditional in this environment">
                        <FaRegCircleQuestion
                          className="text-black-50 cursor-pointer"
                          size={24}
                        />
                      </Tooltip>
                    )}
                    {prereqStates?.[env] === "cyclic" && (
                      <Tooltip popperClassName="text-left mt-2" body="Circular dependency detected. Please fix.">
                        <FaExclamationCircle
                          className="text-warning-orange cursor-pointer"
                          size={24}
                        />
                      </Tooltip>
                    )}
                  </td>
                ))}
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
    </Modal>
  );
}
