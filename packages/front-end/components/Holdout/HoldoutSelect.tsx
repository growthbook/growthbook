import { useEffect, useMemo } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useFormContext } from "react-hook-form";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";

export const HoldoutSelect = ({
  selectedProject,
}: {
  selectedProject?: string;
}) => {
  const { project } = useDefinitions();
  const form = useFormContext();
  const { holdouts, experimentsMap } = useExperiments(
    project,
    false,
    "holdout"
  );

  const holdoutsWithExperiment = useMemo(() => {
    return holdouts
      .filter((h) => {
        const experiment = experimentsMap.get(h.experimentId);
        if (!!h.analysisStartDate || experiment?.status === "draft") {
          return false;
        }
        return selectedProject
          ? h.projects.length === 0 || h.projects.includes(selectedProject)
          : true;
      })
      .map((holdout) => ({
        ...holdout,
        experiment: experimentsMap.get(
          holdout.experimentId
        ) as ExperimentInterfaceStringDates,
      }));
  }, [holdouts, experimentsMap, selectedProject]);

  useEffect(() => {
    if (form.watch("holdoutId") === "none") {
      return;
    }
    if (
      holdoutsWithExperiment.length > 0 &&
      (!form.watch("holdoutId") ||
        !holdoutsWithExperiment.find((h) => h.id === form.watch("holdoutId")))
    ) {
      form.setValue("holdoutId", holdoutsWithExperiment[0].id);
    }
  }, [selectedProject, form, holdoutsWithExperiment]);
  return (
    <SelectField
      label="Holdout"
      labelClassName="font-weight-bold"
      value={form.watch("holdoutId")}
      onChange={(v) => {
        form.setValue("holdoutId", v);
      }}
      helpText={holdoutsWithExperiment.length === 0 ? "No holdouts" : undefined}
      options={[
        ...(holdoutsWithExperiment?.map((h) => {
          return {
            label: h.name,
            value: h.id,
          };
        }) || []),
        { label: "None", value: "none" },
      ]}
      required={holdoutsWithExperiment.length > 0}
      disabled={holdoutsWithExperiment.length === 0}
      sort={false}
      formatOptionLabel={({ label, value }) => {
        const userIdType = holdoutsWithExperiment?.find((h) => h.id === value)
          ?.experiment.exposureQueryId;
        return (
          <div className="cursor-pointer">
            {label}
            {userIdType ? (
              <span
                className="text-muted small float-right position-relative"
                style={{ top: 3, cursor: "pointer" }}
              >
                Identifier Type: <code>{userIdType}</code>
              </span>
            ) : null}
          </div>
        );
      }}
    />
  );
};
