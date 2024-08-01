import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChange } from "back-end/types/visual-changeset";
import { FC, Fragment, useCallback, useState } from "react";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

const EditDOMMutatonsModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  visualChange: VisualChange;
  close: () => void;
  onSave: (newVisualChange: VisualChange) => void;
}> = ({ experiment, close, visualChange, onSave }) => {
  const [newVisualChange, setNewVisualChange] = useState<VisualChange>(
    visualChange
  );
  const [css, setCss] = useState(visualChange.css);
  const [js, setJs] = useState(visualChange.js);

  const deleteCustomJS = useCallback(() => {
    setNewVisualChange({
      ...newVisualChange,
      js: "",
    });
    setJs("");
  }, [newVisualChange, setNewVisualChange]);

  const deleteGlobalCSS = useCallback(() => {
    setNewVisualChange({
      ...newVisualChange,
      css: "",
    });
    setCss("");
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

  const setDOMMutation = useCallback(
    (index: number, updates) => {
      setNewVisualChange({
        ...newVisualChange,
        domMutations: newVisualChange.domMutations.map((m, i) =>
          i === index ? updates : m
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
      header="Edit Visual Changes"
      submit={onSubmit}
      cta="Save"
    >
      <div>
        {experiment.status === "running" && (
          <div className="alert alert-warning">
            <strong>Warning:</strong> This experiment is currently running. Any
            changes made here may introduce unpredictable effects in your
            experiment results.
          </div>
        )}
        <div className="mb-4">
          <h4>
            Global CSS
            {newVisualChange.css ? (
              <small className="ml-2 float-right">
                <a href="#" className="text-danger" onClick={deleteGlobalCSS}>
                  clear
                </a>
              </small>
            ) : null}
          </h4>

          <Field
            textarea
            minRows={5}
            value={css}
            onChange={(e) => {
              setCss(e.target.value);
              setNewVisualChange({
                ...newVisualChange,
                css: e.target.value,
              });
            }}
          />
        </div>

        <div className="mb-4">
          <h4>
            Custom JS
            {newVisualChange.js ? (
              <small className="ml-2 float-right">
                <a href="#" className="text-danger" onClick={deleteCustomJS}>
                  clear
                </a>
              </small>
            ) : null}
          </h4>

          <Field
            textarea
            minRows={5}
            value={js}
            onChange={(e) => {
              setJs(e.target.value);
              setNewVisualChange({
                ...newVisualChange,
                js: e.target.value,
              });
            }}
          />
        </div>

        <div className="mb-4">
          <h4>DOM Mutations</h4>
          {newVisualChange.domMutations.length ? (
            newVisualChange.domMutations.map((m, i) => (
              <Fragment key={i}>
                <a
                  className="text-danger float-right"
                  href="#"
                  onClick={() => deleteDOMMutation(i)}
                  style={{ marginBottom: "-.5rem", fontSize: "0.75rem" }}
                >
                  delete
                </a>
                <Field
                  textarea
                  minRows={2}
                  value={JSON.stringify(m)}
                  className="w-100 my-3"
                  onChange={(e) => {
                    try {
                      const newMutation = JSON.parse(e.target.value);
                      setDOMMutation(i, newMutation);
                    } catch (e) {
                      // ignore
                    }
                  }}
                />
              </Fragment>
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
