import {
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "@/../back-end/types/visual-changeset";
import { FC, useState } from "react";
import SelectField from "@/components/Forms/SelectField";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";
import Modal from "../Modal";

const genDefaultUrlPattern = (
  editorUrl: string
): VisualChangesetURLPattern => ({
  pattern: editorUrl,
  type: "exact",
  include: true,
});

const VisualChangesetModal: FC<{
  onClose: () => void;
  onSubmit: (args: {
    id: string;
    editorUrl: string;
    urlPatterns: VisualChangesetURLPattern[];
  }) => void;
  visualChangeset?: VisualChangesetInterface;
}> = ({ onClose, onSubmit: _onSubmit, visualChangeset }) => {
  let forceAdvancedMode = false;
  if (visualChangeset?.urlPatterns?.length > 0) {
    forceAdvancedMode = true;
  }
  if (visualChangeset?.urlPatterns?.length === 1) {
    const p = visualChangeset.urlPatterns[0];
    if (
      p.pattern === visualChangeset.editorUrl &&
      p.type === "exact" &&
      p.include
    ) {
      forceAdvancedMode = false;
    }
  }

  const [editorUrl, setEditorUrl] = useState<string>(
    visualChangeset?.editorUrl ?? ""
  );
  const [showAdvanced, setShowAdvanced] = useState(forceAdvancedMode);
  const [urlPatterns, setUrlPatterns] = useState<VisualChangesetURLPattern[]>(
    visualChangeset?.urlPatterns ?? [
      {
        pattern: "",
        type: "exact",
        include: true,
      },
    ]
  );
  // todo: this should really be a form with hooks
  const setUrlPattern = ({
    i,
    pattern,
    type,
    include,
  }: {
    i: number;
    pattern?: string;
    type?: "simple" | "exact" | "regex";
    include?: boolean;
  }) => {
    const newUrlPatterns = [...urlPatterns];
    newUrlPatterns[i] = {
      pattern: pattern ?? newUrlPatterns[i].pattern,
      type: type ?? newUrlPatterns[i].type,
      include: include ?? newUrlPatterns[i].include ?? true,
    };
    setUrlPatterns(newUrlPatterns);
  };
  const removeUrlPattern = (i: number) => {
    const newUrlPatterns = [...urlPatterns];
    newUrlPatterns.splice(i, 1);
    setUrlPatterns(newUrlPatterns);
  };

  const onSubmit = async () => {
    const validPatterns = urlPatterns.filter((p) => p.pattern.length > 0);
    _onSubmit({
      id: visualChangeset?.id,
      editorUrl,
      urlPatterns:
        validPatterns.length > 0
          ? validPatterns
          : [genDefaultUrlPattern(editorUrl)],
    });
  };

  const editorUrlLabel = !showAdvanced
    ? "Target URL"
    : "URL to edit with Visual Editor";
  const editorUrlHelpText = !showAdvanced
    ? "Exact match of the URL to edit"
    : "When clicking the Open Visual Editor button, this page will be opened.";

  return (
    <Modal
      open
      close={() => onClose()}
      size="lg"
      header="Add Visual Changes"
      submit={onSubmit}
    >
      <Field
        required
        label={editorUrlLabel}
        helpText={editorUrlHelpText}
        value={editorUrl}
        onChange={(e) => setEditorUrl(e.currentTarget.value)}
      />

      {!forceAdvancedMode && (
        <div className="mt-1 mb-3 text-xs">
          <span
            className="btn-link cursor-pointer"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <small>{showAdvanced ? "Hide" : "Show"} Advanced Options</small>
          </span>
        </div>
      )}

      {showAdvanced && (
        <>
          <label>URL Targeting</label>
          {urlPatterns.map((p, i) => (
            <div key={i} className="row mb-2">
              <div className="col-2">
                <SelectField
                  value={p.include ?? true ? "true" : "false"}
                  options={[
                    { label: "Include", value: "true" },
                    { label: "Exclude", value: "false" },
                  ]}
                  onChange={(v) => setUrlPattern({ i, include: v === "true" })}
                />
              </div>
              <div className="col">
                <Field
                  value={p.pattern}
                  onChange={(e) =>
                    setUrlPattern({ i, pattern: e.currentTarget.value })
                  }
                />
              </div>
              <div className="col-2">
                <SelectField
                  value={p.type}
                  options={[
                    { label: "Exact", value: "exact" },
                    { label: "Regex", value: "regex" },
                  ]}
                  onChange={(v) =>
                    setUrlPattern({ i, type: v as "exact" | "regex" })
                  }
                />
              </div>
              <div className="col-auto" style={{ width: 30 }}>
                {urlPatterns.length > 1 && (
                  <button
                    type="button"
                    className="close inline mt-1 p-1"
                    onClick={() => removeUrlPattern(i)}
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
              setUrlPatterns([...urlPatterns, { pattern: "", type: "exact" }]);
            }}
          >
            <GBAddCircle /> Add URL Target
          </button>
        </>
      )}
    </Modal>
  );
};

export default VisualChangesetModal;
