import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getExposureQuery,
  getExposureQueryIdentifierType,
  getExposureQueryIdentifierTypes,
} from "@/services/datasources";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

const EditDataSourceForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { datasources, getDatasourceById } = useDefinitions();
  const initialExposureQuery = getExposureQuery(
    getDatasourceById(experiment.datasource)?.settings,
    experiment.exposureQueryId,
    experiment.userIdType,
  );
  const form = useForm({
    defaultValues: {
      datasource: experiment.datasource || "",
      exposureQueryId: initialExposureQuery?.id || "",
      exposureQueryIdentifierType: initialExposureQuery
        ? getExposureQueryIdentifierType(
            initialExposureQuery,
            experiment.exposureQueryIdentifierType,
          )
        : undefined,
      trackingKey: experiment.trackingKey || "",
    },
  });
  const { apiCall } = useAuth();

  const datasource = getDatasourceById(form.watch("datasource"));

  const supportsExposureQueries = datasource?.properties?.exposureQueries;
  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryOptions = exposureQueries.flatMap((query) =>
    getExposureQueryIdentifierTypes(query).map((identifierType) => ({
      label: query.name,
      value: JSON.stringify([query.id, identifierType]),
      exposureQueryId: query.id,
      exposureQueryIdentifierType: identifierType,
    })),
  );
  const exposureQueryOptionValue =
    exposureQueryOptions.find(
      (option) =>
        option.exposureQueryId === form.watch("exposureQueryId") &&
        option.exposureQueryIdentifierType ===
          form.watch("exposureQueryIdentifierType"),
    )?.value ?? "";

  return (
    <ModalStandard
      trackingEventModalType=""
      header="Edit Data Source Settings"
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta="Save"
    >
      <SelectField
        size="legacy"
        label="Data Source"
        value={form.watch("datasource")}
        onChange={(v) => form.setValue("datasource", v)}
        disabled={experiment.status !== "draft"}
        placeholder="Select..."
        name="datasource"
        autoFocus={true}
        options={datasources.map((d) => ({ value: d.id, label: d.name }))}
        helpText={
          experiment.status !== "draft"
            ? "Cannot edit the data source while experiment is live. Revert to a draft first."
            : ""
        }
      />
      {supportsExposureQueries && (
        <SelectField
          size="legacy"
          label="Assignment Table"
          value={exposureQueryOptionValue}
          required
          onChange={(value) => {
            const selectedOption = exposureQueryOptions.find(
              (option) => option.value === value,
            );
            if (!selectedOption) return;
            form.setValue("exposureQueryId", selectedOption.exposureQueryId);
            form.setValue(
              "exposureQueryIdentifierType",
              selectedOption.exposureQueryIdentifierType,
            );
          }}
          options={exposureQueryOptions}
          formatOptionLabel={({ label, value }) => {
            const identifierType = exposureQueryOptions.find(
              (option) => option.value === value,
            )?.exposureQueryIdentifierType;
            return (
              <>
                {label}
                {identifierType ? (
                  <span className="text-muted small float-right">
                    Identifier Type: <code>{identifierType}</code>
                  </span>
                ) : null}
              </>
            );
          }}
        />
      )}
      <Field
        size="legacy"
        label="Experiment Id"
        {...form.register("trackingKey")}
      />
    </ModalStandard>
  );
};

export default EditDataSourceForm;
