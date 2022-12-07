import { ProjectInterface } from "back-end/types/project";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import MultiSelectField from "../Forms/MultiSelectField";
import { useDefinitions } from "../../services/DefinitionsContext";

export default function ProjectModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<ProjectInterface>;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { datasources, metrics } = useDefinitions();

  const form = useForm<Partial<ProjectInterface>>({
    defaultValues: {
      name: existing.name || "",
      datasources: existing.datasources || [],
      metrics: existing.metrics || [],
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      header={existing.id ? "Edit Project" : "Create Project"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(existing.id ? `/projects/${existing.id}` : `/projects`, {
          method: existing.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        await onSuccess();
      })}
    >
      <Field label="Name" maxLength={30} required {...form.register("name")} />

      { datasources.length && (
        <MultiSelectField
          label="Data Sources (optional)"
          value={form.watch("datasources")}
          onChange={(v) => form.setValue("datasources", v)}
          options={datasources.map(ds => ({label: ds.name, value: ds.id}))}
          helpText="Limit this project to specific data sources"
        />
      )}

      { metrics.length && (
        <MultiSelectField
          label="Metrics (optional)"
          value={form.watch("metrics")}
          onChange={(v) => form.setValue("metrics", v)}
          options={metrics.map(m => ({label: m.name, value: m.id}))}
          helpText="Limit this project to specific metrics"
        />
      )}
    </Modal>
  );
}
