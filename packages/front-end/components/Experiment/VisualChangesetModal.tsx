import { VisualChangesetURLPattern } from "@/../back-end/types/visual-changeset";
import { FC, useState } from "react";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";
import Modal from "../Modal";

const VisualChangesetModal: FC<{
  onClose: () => void;
  onSubmit: (args: {
    editorUrl: string;
    urlPatterns: VisualChangesetURLPattern[];
  }) => void;
  editorUrl?: string;
  urlPatterns?: VisualChangesetURLPattern[];
}> = ({
  onClose,
  onSubmit,
  editorUrl: _editorUrl,
  urlPatterns: _urlPatterns,
}) => {
  const [editorUrl, setEditorUrl] = useState<string>(_editorUrl ?? "");
  const [urlPatterns, setUrlPatterns] = useState<VisualChangesetURLPattern[]>(
    _urlPatterns ?? [
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

  return (
    <Modal
      open
      close={() => onClose()}
      size="lg"
      header="Add Visual Changes"
      submit={() => onSubmit({ editorUrl, urlPatterns })}
    >
      <Field
        required
        label="Visual Editor Target URL"
        helpText={
          "The web page the Visual Editor will make changes to. These changes can be applied to any site that matches your URL targeting rule."
        }
        value={editorUrl}
        onChange={(e) => setEditorUrl(e.currentTarget.value)}
      />
      {urlPatterns.map((p, i) => (
        <div key={i} className="d-flex align-items-center">
          <div className="flex-1">
            <Field
              required
              label="URL Targeting"
              helpText={
                <>
                  Target multiple URLs using regular expression. e.g.{" "}
                  <code>https://example.com/pricing</code> or{" "}
                  <code>^/post/[0-9]+</code>
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
        className="btn btn-primary"
        onClick={() =>
          setUrlPatterns([...urlPatterns, { pattern: "", type: "regex" }])
        }
      >
        <GBAddCircle /> Add URL pattern
      </button>
    </Modal>
  );
};

export default VisualChangesetModal;
