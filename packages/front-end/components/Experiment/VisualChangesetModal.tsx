import {
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "@/../back-end/types/visual-changeset";
import { FC, useState } from "react";
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
        type: "regex",
      },
    ]
  );
  const setUrlPattern = (p: string, i: number) => {
    const newUrlPatterns = [...urlPatterns];
    newUrlPatterns[i] = {
      pattern: p,
      type: "regex",
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
        helpText={
          "The web page to edit with the Visual Editor. Will not affect users."
        }
        value={editorUrl}
        onChange={(e) => setEditorUrl(e.currentTarget.value)}
      />

      <div className="my-2 text-xs">
        <a href="#" onClick={() => setShowAdvanced(!showAdvanced)}>
          <small>{showAdvanced ? "Hide" : "Show"} Advanced Options</small>
        </a>
      </div>

      {showAdvanced && (
        <>
          <label>URL Targeting</label>
          {urlPatterns.map((p, i) => (
            <div key={i} className="d-flex align-items-start mb-2">
              <div className="flex-1">
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
                  onChange={(e) => setUrlPattern(e.currentTarget.value, i)}
                />
              </div>
              {urlPatterns.length > 1 && (
                <div className="flex-shrink-1 pl-2">
                  <button
                    type="button"
                    className="close inline"
                    onClick={() => removeUrlPattern(i)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              )}
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
