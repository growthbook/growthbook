import { ProjectInterface } from "back-end/types/project";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import MetricsSelector from "../Experiment/MetricsSelector";
import Modal from "../Modal";
import Field from "../Forms/Field";
import MultiSelect from "../Forms/MultiSelect";
import { useMemo } from "react";
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
  const form = useForm<Partial<ProjectInterface>>({
    defaultValues: {
      name: existing.name || "",
      metrics: existing.metrics || [],
      dimensions: existing.dimensions || [],
      segments: existing.segments || [],
    },
  });

  const { dimensions, segments, metrics } = useDefinitions();

  const dimensionOptions = useMemo(() => {
    return dimensions.map((d) => ({ display: d.name, value: d.id }));
  }, [dimensions]);
  const segmentOptions = useMemo(() => {
    return segments.map((s) => ({ display: s.name, value: s.id }));
  }, [segments]);

  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      header="Create Project"
      submit={form.handleSubmit(async (value) => {
        await apiCall(existing.id ? `/projects/${existing.id}` : `/projects`, {
          method: existing.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        await onSuccess();
      })}
    >
      <Field name="Name" maxLength={30} required {...form.register("name")} />
      <p>
        Select which metrics, dimensions, and segments you want available to
        this project.{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            form.setValue(
              "dimensions",
              dimensions.map((d) => d.id)
            );
            form.setValue(
              "segments",
              segments.map((s) => s.id)
            );
            form.setValue(
              "metrics",
              metrics.map((m) => m.id)
            );
          }}
        >
          Select All
        </a>
      </p>
      <div className="form-group">
        Metrics
        <MetricsSelector
          selected={form.watch("metrics")}
          onChange={(metrics) => {
            form.setValue("metrics", metrics);
          }}
        />
      </div>
      <MultiSelect
        label="Dimensions"
        value={form.watch("dimensions")}
        onChange={(dimensions) => {
          form.setValue("dimensions", dimensions);
        }}
        options={dimensionOptions}
      />
      <MultiSelect
        label="Segments"
        value={form.watch("segments")}
        onChange={(segments) => {
          form.setValue("segments", segments);
        }}
        options={segmentOptions}
      />
      <div style={{ height: 200 }} />
    </Modal>
  );
}
