import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { DOMMutation, VisualChange } from "shared/types/visual-changeset";
import React, { FC, useCallback, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";

const actionValues = ["append", "set", "remove"];

const EditDOMMutationsModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  visualChange: VisualChange;
  close: () => void;
  onSave: (newVisualChange: VisualChange) => void;
}> = ({ experiment, close, visualChange, onSave }) => {
  const [newVisualChange, setNewVisualChange] =
    useState<VisualChange>(visualChange);
  const [useAdvanced, setUseAdvanced] = useState(false);

  const [newDOMMutationErrors, setNewDOMMutationErrors] = useState<string[]>(
    [],
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
          (_m, i) => i !== index,
        ),
      });
    },
    [newVisualChange, setNewVisualChange],
  );

  const setDOMMutation = useCallback(
    (index: number, updates: DOMMutation) => {
      setNewVisualChange((prevVisualChange) => ({
        ...prevVisualChange,
        domMutations: prevVisualChange.domMutations.map((m, i) =>
          i === index ? updates : m,
        ),
      }));
    },
    [setNewVisualChange],
  );

  const addDOMMutation = useCallback(
    (updates: DOMMutation) => {
      setNewVisualChange((prevVisualChange) => ({
        ...prevVisualChange,
        domMutations: [...prevVisualChange.domMutations, updates],
      }));
    },
    [setNewVisualChange],
  );

  const setDOMMutationErrors = useCallback(
    (index: number, error: string) => {
      setNewDOMMutationErrors((errors) => {
        const newErrors = [...errors];
        newErrors[index] = error;
        return newErrors;
      });
    },
    [setNewDOMMutationErrors],
  );

  const validateDOMMutations = useCallback(
    (index: number, mutations) => {
      try {
        /*
        valid DOM mutation object. No other keys are allowed:
          selector: string;
          attribute: string;
          action: 'append' | 'set' | 'remove';
          value?: string;
          parentSelector?: string;
          insertBeforeSelector?: string;
         */
        if (mutations.selector === undefined) {
          throw new Error("selector key is required");
        }
        if (mutations.attribute === undefined) {
          throw new Error("attribute key is required");
        }
        if (mutations.action === undefined) {
          throw new Error("action key is required");
        }
        if (!["append", "set", "remove"].includes(mutations.action)) {
          throw new Error("action must be one of 'append', 'set', or 'remove'");
        }
        // check to make sure the object has no non-defined keys
        if (Object.keys(mutations).length > 3) {
          Object.keys(mutations).forEach((key) => {
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

        setDOMMutation(index, mutations);
        setDOMMutationErrors(index, "");
        return true;
      } catch (e) {
        setDOMMutationErrors(index, e.message);
        return false;
      }
    },
    [setDOMMutation, setDOMMutationErrors],
  );

  const checkValidDOMMutations = useCallback(() => {
    let valid = true;
    newVisualChange?.domMutations.forEach((m, i) => {
      if (!validateDOMMutations(i, m)) {
        valid = false;
      }
    });
    return valid;
  }, [newVisualChange?.domMutations, validateDOMMutations]);

  const editableDomEditFields = useCallback(
    (i: number, domChanges: DOMMutation) => {
      try {
        return (
          <Box p="3" px="4" className="appbox">
            <Flex justify="between" gap="4" align="start" mb="2">
              <Box flexGrow="1">
                <Flex justify="start" gap="6">
                  <Box flexBasis="50%">
                    <Field
                      label="Selector"
                      labelClassName="mb-1"
                      helpText="CSS selector for the element to modify"
                      value={domChanges?.selector || ""}
                      onChange={(e) => {
                        const newMutation = {
                          ...domChanges,
                          selector: e.target.value,
                        };
                        setDOMMutation(i, newMutation);
                      }}
                    />
                  </Box>
                  <Box flexBasis="25%">
                    <SelectField
                      label="Action"
                      labelClassName="mb-1"
                      options={[
                        { value: "append", label: "Append" },
                        { value: "set", label: "Set" },
                        { value: "remove", label: "Remove" },
                      ]}
                      value={domChanges?.action}
                      onChange={(val: "append" | "set" | "remove") => {
                        if (!actionValues.includes(val)) {
                          return;
                        }
                        const newMutation = { ...domChanges, action: val };
                        setDOMMutation(i, newMutation);
                      }}
                    />
                  </Box>
                  <Box flexBasis="25%">
                    <Field
                      label="Attribute"
                      labelClassName="mb-1"
                      value={domChanges?.attribute}
                      helpText={
                        <>
                          DOM attribute to modify{" "}
                          <Tooltip body="Use 'html' to set the contents of this DOM element" />
                        </>
                      }
                      onChange={(e) => {
                        const newMutation = {
                          ...domChanges,
                          attribute: e.target.value,
                        };
                        setDOMMutation(i, newMutation);
                      }}
                    />
                  </Box>
                </Flex>
                <Field
                  label="Value"
                  labelClassName="mb-1"
                  textarea
                  value={domChanges?.value}
                  onChange={(e) => {
                    const newMutation = {
                      ...domChanges,
                      value: e.target.value,
                    };
                    setDOMMutation(i, newMutation);
                  }}
                />
                <Flex justify="end">
                  <a
                    className="small"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setUseAdvanced(!useAdvanced);
                    }}
                  >
                    {useAdvanced ||
                    domChanges?.insertBeforeSelector ||
                    domChanges?.parentSelector
                      ? "Hide advanced"
                      : "Show advanced"}
                  </a>
                </Flex>
                {(useAdvanced ||
                  domChanges?.insertBeforeSelector ||
                  domChanges?.parentSelector) && (
                  <Flex gap="6">
                    <Box flexBasis="50%">
                      <Field
                        label="Insert Before Selector"
                        labelClassName="mb-1"
                        value={domChanges?.insertBeforeSelector || ""}
                        onChange={(e) => {
                          if (!e.target.value) {
                            // remove the key if it's empty
                            const newMutation = domChanges;
                            if (newMutation?.insertBeforeSelector) {
                              delete newMutation.insertBeforeSelector;
                            }
                            setDOMMutation(i, newMutation);
                          } else {
                            const newMutation = {
                              ...domChanges,
                              insertBeforeSelector: e.target.value,
                            };
                            setDOMMutation(i, newMutation);
                          }
                        }}
                      />
                    </Box>
                    <Box flexBasis="50%">
                      <Field
                        label="Parent Selector"
                        labelClassName="mb-1"
                        value={domChanges?.parentSelector || ""}
                        onChange={(e) => {
                          if (!e.target.value) {
                            // remove the key if it's empty
                            const newMutation = domChanges;
                            if (newMutation?.parentSelector) {
                              delete newMutation.parentSelector;
                            }
                            setDOMMutation(i, newMutation);
                          } else {
                            const newMutation = {
                              ...domChanges,
                              parentSelector: e.target.value,
                            };
                            setDOMMutation(i, newMutation);
                          }
                        }}
                      />
                    </Box>
                  </Flex>
                )}
              </Box>
              <Button
                variant="ghost"
                color="red"
                onClick={() => {
                  deleteDOMMutation(i);
                }}
              >
                Delete
              </Button>
            </Flex>

            {newDOMMutationErrors[i] && (
              <div className="text-danger">
                <small>{newDOMMutationErrors[i]}</small>
              </div>
            )}
          </Box>
        );
      } catch (e) {
        return (
          <div className="text-danger">
            <small>Invalid JSON</small>
          </div>
        );
      }
    },
    [deleteDOMMutation, newDOMMutationErrors, setDOMMutation, useAdvanced],
  );

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
          <Box>
            <Box>
              {newVisualChange?.domMutations.length ? (
                newVisualChange.domMutations.map((dm, i) => (
                  <Box key={i}>{editableDomEditFields(i, dm)}</Box>
                ))
              ) : (
                <div className="text-muted">No DOM mutations</div>
              )}
            </Box>
            <Button
              variant="soft"
              onClick={() => {
                addDOMMutation({ selector: "", action: "set", attribute: "" });
              }}
            >
              Add DOM Mutation
            </Button>
          </Box>
        </div>
      </div>
    </Modal>
  );
};

export default EditDOMMutationsModal;
