import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { FC, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import { isURLTargeted, UrlTarget } from "@growthbook/growthbook";
import SelectField from "@/components/Forms/SelectField";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import { GBAddCircle } from "@/components/Icons";
import Modal from "@/components/Modal";

const defaultType = "simple";

const VisualChangesetModal: FC<{
  mode: "add" | "edit";
  experiment: ExperimentInterfaceStringDates;
  visualChangeset?: VisualChangesetInterface;
  mutate: () => void;
  close: () => void;
  onCreate?: (vc: VisualChangesetInterface) => void;
  cta?: string;
  source?: string;
}> = ({
  mode,
  experiment,
  visualChangeset,
  mutate,
  close,
  onCreate,
  cta,
  source,
}) => {
  const { apiCall } = useAuth();

  let forceAdvancedMode = false;
  if ((visualChangeset?.urlPatterns?.length ?? 0) > 0) {
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
      urlPatterns: visualChangeset?.urlPatterns ?? [
        { pattern: "", type: defaultType, include: true },
      ],
    },
  });
  const urlPatterns = useFieldArray({
    control: form.control,
    name: "urlPatterns",
  });

  const onSubmit = form.handleSubmit(async (value) => {
    const payload = {
      editorUrl: value.editorUrl,
      urlPatterns: value.urlPatterns,
    };
    if (!showAdvanced) {
      payload.urlPatterns = [
        { pattern: value.editorUrl, type: defaultType, include: true },
      ];
    }
    if (mode === "add") {
      const res = await apiCall<{ visualChangeset: VisualChangesetInterface }>(
        `/experiments/${experiment.id}/visual-changeset`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      mutate();
      res.visualChangeset && onCreate && onCreate(res.visualChangeset);
    } else {
      await apiCall(`/visual-changesets/${visualChangeset?.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      mutate();
    }
  });

  const editorUrlLabel = !showAdvanced
    ? "Target URL"
    : "URL to edit with Visual Editor";
  const editorUrlHelpText = !showAdvanced ? undefined : (
    <>
      Clicking the <strong>Open Visual Editor</strong> button will open this URL
    </>
  );

  const patternsMatchUrl =
    !showAdvanced ||
    isURLTargeted(
      form.watch("editorUrl"),
      form.watch("urlPatterns") as UrlTarget[],
    );

  return (
    <Modal
      trackingEventModalType="visual-changeset-modal"
      trackingEventModalSource={source}
      open
      close={close}
      size="lg"
      header={`${
        mode === "add" ? "Add" : "Modify"
      } Visual Changes URL targeting`}
      submit={onSubmit}
      cta={cta}
    >
      <Field
        required
        label={editorUrlLabel}
        containerClassName="mb-2"
        helpText={editorUrlHelpText}
        {...form.register("editorUrl", {
          required: true,
          onChange: () => {
            if (!showAdvanced) {
              form.setValue("urlPatterns.0.pattern", form.watch("editorUrl"));
              form.setValue("urlPatterns.0.type", defaultType);
              form.setValue("urlPatterns.0.include", true);
            }
          },
        })}
      />
      {!forceAdvancedMode && (
        <div className="my-3 text-xs">
          <span
            className="btn-link cursor-pointer"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <small>{showAdvanced ? "Hide" : "Show"} advanced options</small>
          </span>
        </div>
      )}

      <div
        className="mt-4"
        style={{ display: showAdvanced ? "block" : "none" }}
      >
        <label>URL Targeting</label>
        {urlPatterns.fields.map((p, i) => (
          <div key={i} className="mb-2">
            <div className="row">
              <div className="col-2">
                <SelectField
                  value={
                    !form.watch(`urlPatterns.${i}.include`) ? "false" : "true"
                  }
                  options={[
                    { label: "Include", value: "true" },
                    { label: "Exclude", value: "false" },
                  ]}
                  onChange={(v) =>
                    form.setValue(`urlPatterns.${i}.include`, v !== "false")
                  }
                />
              </div>
              <div className="col">
                <Field {...form.register(`urlPatterns.${i}.pattern`)} />
              </div>
              <div className="col-2">
                <SelectField
                  value={form.watch(`urlPatterns.${i}.type`)}
                  options={[
                    { label: "Simple", value: "simple" },
                    { label: "Regex", value: "regex" },
                  ]}
                  sort={false}
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
            <div className="row">
              <div className="col-2"></div>
              <div className="col-7 px-3">
                <div className="small text-muted">
                  {form.watch(`urlPatterns.${i}.type`) === "simple" ? (
                    <Tooltip
                      body={
                        <>
                          Example Patterns:
                          <ul className="px-4">
                            <li>
                              <code>https://www.example.com/pricing</code>
                            </li>
                            <li>
                              <code>/sale?utm_source=email</code>
                            </li>
                            <li>
                              <code>/items/*</code>
                            </li>
                          </ul>
                        </>
                      }
                    >
                      <strong>Simple</strong>: Matches a full URL or path.
                      Supports <code>*</code> as a wildcard <FaInfoCircle />
                    </Tooltip>
                  ) : form.watch(`urlPatterns.${i}.type`) === "regex" ? (
                    <Tooltip
                      tipMinWidth={"500px"}
                      body={
                        <>
                          <ul className="px-4">
                            <li>
                              <code style={{ whiteSpace: "nowrap" }}>
                                https?:\/\/(www\.)?example\.com\/pricing\/?
                              </code>{" "}
                              will match both
                              &quot;https://www.example.com/pricing&quot; and
                              &quot;http://example.com/pricing/&quot;
                            </li>
                            <li>
                              <code style={{ whiteSpace: "nowrap" }}>
                                \/pricing\/?
                              </code>{" "}
                              will <em>also</em> match both
                              &quot;https://www.example.com/pricing&quot; and
                              &quot;http://example.com/pricing/&quot; (matching
                              by path)
                            </li>
                          </ul>
                        </>
                      }
                    >
                      <strong>Regex</strong>: Matches a URL or path via regular
                      expression <FaInfoCircle />
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ))}

        <button
          className="btn btn-link mt-1"
          onClick={(e) => {
            e.preventDefault();
            urlPatterns.append({
              pattern: "",
              type: defaultType,
              include: true,
            });
          }}
        >
          <GBAddCircle className="mr-1" />
          Add URL Target
        </button>
      </div>

      {!patternsMatchUrl && (
        <div className="alert alert-warning mt-3">
          <FaExclamationCircle /> Your URL patterns do not match the target URL
        </div>
      )}
    </Modal>
  );
};

export default VisualChangesetModal;
