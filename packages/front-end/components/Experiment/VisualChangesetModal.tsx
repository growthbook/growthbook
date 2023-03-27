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
  type: "regex",
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
  const [editorUrl, setEditorUrl] = useState<string>(
    visualChangeset?.editorUrl ?? ""
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
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
        label="Visual Editor URL"
        helpText={"The web page to edit with the Visual Editor."}
        value={editorUrl}
        onChange={(e) => setEditorUrl(e.currentTarget.value)}
      />

      <div className="my-2 text-xs">
        <span
          className="btn-link cursor-pointer"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <small>{showAdvanced ? "Hide" : "Show"} Advanced Options</small>
        </span>
      </div>

      {showAdvanced && (
        <>
          <label>URL Targeting</label>
          {urlPatterns.map((p, i) => (
            <div key={i} className="row mb-2">
              <div className="col">
                <Field
                  helpText={
                    <>
                      Apply changes to all URLs matching this pattern for users.
                      Use regular expression to target multiple e.g.{" "}
                      <code>https://example.com/pricing</code> or{" "}
                      <code>^/post/[0-9]+</code>.
                    </>
                  }
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
              <div className="col-auto" style={{ width: 30 }}>
                {urlPatterns.length > 1 && (
                  <button
                    type="button"
                    className="close inline"
                    onClick={() => removeUrlPattern(i)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            className="btn btn-primary mt-2"
            onClick={(e) => {
              e.preventDefault();
              setUrlPatterns([...urlPatterns, { pattern: "", type: "regex" }]);
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
