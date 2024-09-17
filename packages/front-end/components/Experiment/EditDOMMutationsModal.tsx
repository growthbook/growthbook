import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChange } from "back-end/types/visual-changeset";
import { FC, useCallback, useEffect, useState } from "react";
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

  const [newDOMMutationStr, setNewDOMMutationStr] = useState(
    visualChange.domMutations.map((m) => JSON.stringify(m))
  );
  const [newDOMMutationErrors, setNewDOMMutationErrors] = useState<string[]>(
    []
  );
  //update Dom mutations when visualChange changes
  useEffect(() => {
    setNewDOMMutationStr(
      newVisualChange.domMutations.map((m) => JSON.stringify(m))
    );
  }, [newVisualChange]);

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

  const setDOMMutationStr = useCallback(
    (index: number, str: string) => {
      setNewDOMMutationStr((strs) => {
        const newStrs = [...strs];
        newStrs[index] = str;
        return newStrs;
      });
    },
    [setNewDOMMutationStr]
  );

  const setDOMMutationErrors = useCallback(
    (index: number, error: string) => {
      setNewDOMMutationErrors((errors) => {
        const newErrors = [...errors];
        newErrors[index] = error;
        return newErrors;
      });
    },
    [setNewDOMMutationErrors]
  );

  const validateDOMMutations = useCallback(
    (index: number, mutation: string) => {
      try {
        const m = JSON.parse(mutation);
        /*
        valid DOM mutation object. No other keys are allowed:
          selector: string;
          attribute: string;
          action: 'append' | 'set' | 'remove';
          value?: string;
          parentSelector?: string;
          insertBeforeSelector?: string;
         */
        if (m.selector === undefined) {
          throw new Error("selector key is required");
        }
        if (m.attribute === undefined) {
          throw new Error("attribute key is required");
        }
        if (m.action === undefined) {
          throw new Error("action key is required");
        }
        if (!["append", "set", "remove"].includes(m.action)) {
          throw new Error("action must be one of 'append', 'set', or 'remove'");
        }
        // check to make sure the object has no non-defined keys
        if (Object.keys(m).length > 3) {
          Object.keys(m).forEach((key) => {
            if (
              ![
                "selector",
                "attribute",
                "action",
                "value",
                "parentSelector",
                "insertBeforeSelector",
              ].includes(key)
            ) {
              throw new Error(`Invalid key: ${key}`);
            }
          });
        }

        setDOMMutation(index, m);
        setDOMMutationErrors(index, "");
        return true;
      } catch (e) {
        setDOMMutationErrors(index, e.message);
        return false;
      }
    },
    [setDOMMutation, setDOMMutationErrors]
  );

  const checkValidDOMMutations = useCallback(() => {
    let valid = true;
    newDOMMutationStr.forEach((m, i) => {
      if (!validateDOMMutations(i, m)) {
        valid = false;
      }
    });
    return valid;
  }, [newDOMMutationStr, validateDOMMutations]);

  const onSubmit = () => {
    // make sure all DOM mutations are valid
    if (!checkValidDOMMutations()) {
      return;
    }
    onSave(newVisualChange);
  };

  return (
    <Modal
      trackingEventModalType=""
      open
      close={close}
      size="lg"
      header="Edit Visual Changes"
      submit={onSubmit}
      cta="Save"
      ctaEnabled={!newDOMMutationErrors.some((e) => e)}
      disabledMessage={
        newDOMMutationErrors.some((e) => e)
          ? "Please fix the errors with DOM mutators"
          : ""
      }
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
            value={newVisualChange.css}
            onChange={(e) => {
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
            value={newVisualChange.js}
            onChange={(e) => {
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
            newDOMMutationStr.map((m, i) => (
              <div key={i} className="my-3">
                <a
                  className="text-danger float-right"
                  href="#"
                  onClick={() => deleteDOMMutation(i)}
                  style={{ fontSize: "0.75rem" }}
                >
                  delete
                </a>
                <Field
                  textarea
                  minRows={2}
                  value={m}
                  className="w-100"
                  onChange={(e) => {
                    setDOMMutationStr(i, e.target.value);
                    validateDOMMutations(i, e.target.value);
                  }}
                />
                <div>
                  {newDOMMutationErrors[i] ? (
                    <div className="text-danger">
                      <small>{newDOMMutationErrors[i]}</small>
                    </div>
                  ) : null}
                </div>
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
