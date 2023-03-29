import { VisualChangesetInterface } from "@/../back-end/types/visual-changeset";
import { FC, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";
import Modal from "../Modal";
import { useAuth } from "@/services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

const defaultType = "exact";

const VisualChangesetModal: FC<{
  mode: "create" | "edit";
  experiment: ExperimentInterfaceStringDates;
  visualChangeset?: VisualChangesetInterface;
  mutate: () => void;
  close: () => void;
}> = ({ mode, experiment, visualChangeset, mutate, close }) => {
  const { apiCall } = useAuth();

  // todo: bug bash this
  let forceAdvancedMode = false;
  if (visualChangeset?.urlPatterns?.length > 0) {
    forceAdvancedMode = true;
  }
  if (visualChangeset?.urlPatterns?.length === 1) {
    const p = visualChangeset.urlPatterns[0];
    if (
      p.pattern === visualChangeset.editorUrl &&
      p.type === defaultType &&
      p.include
    ) {
      forceAdvancedMode = false;
    }
  }

  const [showAdvanced, setShowAdvanced] = useState(forceAdvancedMode);

  const form = useForm({
    defaultValues: {
      editorUrl: visualChangeset?.editorUrl ?? "",
      urlPatterns: visualChangeset?.urlPatterns ?? [{ pattern: "", type: defaultType, include: true }],
    }
  });
  const urlPatterns = useFieldArray({
    control: form.control,
    name: "urlPatterns",
  });

  const onSubmit = form.handleSubmit(async (value) => {
    let payload = {
      editorUrl: value.editorUrl,
      urlPatterns: value.urlPatterns,
    }
    if (!showAdvanced) {
      payload.urlPatterns = [{ pattern: value.editorUrl, type: defaultType, include: true }];
    }
    if (mode === "create") {
      await apiCall(`/experiments/${experiment.id}/visual-changeset`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    }
    mutate();
    close();
  });

  const editorUrlLabel = !showAdvanced
    ? "Target URL"
    : "URL to edit with Visual Editor";
  const editorUrlHelpText = !showAdvanced
    ? "Exact match of the URL to edit"
    : "When clicking the Open Visual Editor button, this page will be opened.";

  return (
    <Modal
      open
      close={close}
      size="lg"
      header="Add Visual Changes"
      submit={onSubmit}
    >
      <Field
        required
        label={editorUrlLabel}
        helpText={editorUrlHelpText}
        {...form.register("editorUrl", { required: true,
          onChange: () => {
            if (!showAdvanced) {
              form.setValue("urlPatterns.0.pattern", form.watch("editorUrl"));
              form.setValue("urlPatterns.0.type", defaultType);
              form.setValue("urlPatterns.0.include", true);
            }
          }
        })}
      />

      {!forceAdvancedMode && (
        <div className="mt-1 mb-3 text-xs">
          <span
            className="btn-link cursor-pointer"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <small>{showAdvanced ? "Hide" : "Show"} advanced options</small>
          </span>
        </div>
      )}

      <div style={{display: showAdvanced ? "block" : "none"}}>
        <label>URL Targeting</label>
        {urlPatterns.fields.map((p, i) => (
          <div key={i} className="row mb-2">
            <div className="col-2">
              <SelectField
                value={!form.watch(`urlPatterns.${i}.include`) ? "false" : "true"}
                options={[
                  { label: "Include", value: "true" },
                  { label: "Exclude", value: "false" },
                ]}
                onChange={(v) => form.setValue(`urlPatterns.${i}.include`, v !== "false")}
              />
            </div>
            <div className="col">
              <Field
                {...form.register(`urlPatterns.${i}.pattern`)}
              />
            </div>
            <div className="col-2">
              <SelectField
                value={form.watch(`urlPatterns.${i}.type`)}
                options={[
                  { label: "Exact", value: "exact" },
                  { label: "Regex", value: "regex" },
                ]}
                onChange={(v) => form.setValue(`urlPatterns.${i}.type`, v)}
              />
            </div>
            <div className="col-auto" style={{ width: 30 }}>
              {urlPatterns.fields.length > 1 && (
                <button
                  type="button"
                  className="close inline mt-1 p-1"
                  onClick={(e) => {
                    e.preventDefault();
                    urlPatterns.remove(i);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </div>
          </div>
        ))}

        <button
          className="btn btn-link mt-2"
          onClick={(e) => {
            e.preventDefault();
            urlPatterns.append({ pattern: "", type: "simple", include: true });
          }}
        >
          <GBAddCircle /> Add URL Target
        </button>
      </div>
    </Modal>
  );
};

export default VisualChangesetModal;
