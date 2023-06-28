import { VisualChange } from "back-end/types/visual-changeset";
import { FC, useCallback, useState } from "react";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "../Modal";

const EditDOMMutatonsModal: FC<{
  visualChange: VisualChange;
  close: () => void;
  onSave: (newVisualChange: VisualChange) => void;
}> = ({ close, visualChange, onSave }) => {
  const [newVisualChange, setNewVisualChange] = useState<VisualChange>(
    visualChange
  );

  const deleteCustomJS = useCallback(() => {
    setNewVisualChange({
      ...newVisualChange,
      js: "",
    });
  }, [newVisualChange, setNewVisualChange]);

  const deleteGlobalCSS = useCallback(() => {
    setNewVisualChange({
      ...newVisualChange,
      css: "",
    });
  }, [newVisualChange, setNewVisualChange]);

  const deleteDOMMutation = useCallback(
    (index: number) => {
      setNewVisualChange({
        ...newVisualChange,
        domMutations: newVisualChange.domMutations.filter(
          (_m, i) => i !== index
        ),
      });
    },
    [newVisualChange, setNewVisualChange]
  );

  const onSubmit = () => {
    onSave(newVisualChange);
  };

  return (
    <Modal
      open
      close={close}
      size="lg"
      header="Remove Visual Changes"
      submit={onSubmit}
      cta="Save"
    >
      <div className="col">
        <div className="mb-4">
          <h4>
            Global CSS
            {newVisualChange.css ? (
              <small className="ml-2">
                <a href="#" className="text-danger" onClick={deleteGlobalCSS}>
                  delete
                </a>
              </small>
            ) : null}
          </h4>
          {newVisualChange.css ? (
            <Code
              language="css"
              code={newVisualChange.css}
              className="disabled"
            />
          ) : (
            <div className="text-muted font-italic">(None)</div>
          )}
        </div>

        <div className="mb-4">
          <h4>
            Custom JS
            {newVisualChange.js ? (
              <small className="ml-2">
                <a href="#" className="text-danger" onClick={deleteCustomJS}>
                  delete
                </a>
              </small>
            ) : null}
          </h4>
          {newVisualChange.js ? (
            <Code
              language="javascript"
              code={newVisualChange.js ?? ""}
              className="disabled"
            />
          ) : (
            <div className="text-muted font-italic">(None)</div>
          )}
        </div>

        <div className="mb-4">
          <h4>DOM Mutations</h4>

          {newVisualChange.domMutations.length ? (
            newVisualChange.domMutations.map((m, i) => (
              <div key={i} className="d-flex">
                <Code
                  language="json"
                  code={JSON.stringify(m)}
                  className="disabled"
                />
                <button
                  className="btn text-danger"
                  onClick={() => deleteDOMMutation(i)}
                  style={{ fontSize: "1.2rem", paddingLeft: "0.3rem" }}
                >
                  &times;
                </button>
              </div>
            ))
          ) : (
            <div className="text-muted font-italic">(None)</div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default EditDOMMutatonsModal;
