import { FC, useEffect, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { validateAndFixCondition } from "shared/util";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaPlusCircle,
  FaRetweet,
} from "react-icons/fa";
import { SavedGroupInterface, SavedGroupType } from "shared/src/types";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import useMembers from "@/hooks/useMembers";
import { useAttributeSchema } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import ConditionInput from "@/components/Features/ConditionInput";

export const IdListMemberInput: FC<{
  values: string[];
  setValues: (newValues: string[]) => void;
  attributeKey: string;
}> = ({ values, setValues, attributeKey }) => {
  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState(values.join(", ") || "");
  useEffect(() => {
    setRawText(values.join(","));
  }, [values]);

  const [importMethod, setImportMethod] = useState<"file" | "values">("file");
  const [numValuesToImport, setNumValuesToImport] = useState<number | null>(
    null
  );
  const [fileName, setFileName] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  return (
    <>
      <label className="form-group font-weight-bold">
        Choose how to enter IDs for this group:
      </label>
      <div className="row ml-0 mr-0 form-group">
        <div
          className="cursor-pointer row align-items-center ml-0 mr-5"
          onClick={(e) => {
            e.preventDefault();
            setImportMethod("file");
          }}
        >
          <input
            type="radio"
            id="importCsv"
            readOnly={true}
            checked={importMethod === "file"}
            className="mr-1 radio-button-lg"
          />
          <label className="m-0" htmlFor="importCsv">
            Import CSV
          </label>
        </div>
        <div
          className="cursor-pointer row align-items-center ml-0 mr-0"
          onClick={(e) => {
            e.preventDefault();
            setImportMethod("values");
          }}
        >
          <input
            type="radio"
            id="enterValues"
            checked={importMethod === "values"}
            readOnly={true}
            className="mr-1 radio-button-lg"
          />
          <label className="m-0" htmlFor="enterValues">
            Manually enter values
          </label>
        </div>
      </div>
      {importMethod === "file" && (
        <>
          <div className="custom-file">
            <input
              type="file"
              required={false}
              className="custom-file-input"
              id="savedGroupFileInput"
              accept=".csv"
              onChange={(e) => {
                setNumValuesToImport(null);
                setFileName("");
                setFileErrorMessage("");

                const file: File | undefined = e.target?.files?.[0];
                if (!file) {
                  return;
                }
                if (!file.name.endsWith(".csv")) {
                  setFileErrorMessage("Only .csv file types are supported");
                  return;
                }
                if (file.size > 1024 * 1024) {
                  setFileErrorMessage("File size must be less than 1 MB");
                  return;
                }

                setFileName(file.name);

                const reader = new FileReader();
                reader.onload = function (e) {
                  try {
                    const str = e.target?.result;
                    if (typeof str !== "string") {
                      return;
                    }
                    const newValues = str.replaceAll(/[\n\s]/g, "").split(",");
                    setValues(newValues);
                    setNumValuesToImport(newValues.length);
                  } catch (e) {
                    console.error(e);
                    return;
                  }
                };
                reader.readAsText(file);
              }}
            />
            <label className="custom-file-label" htmlFor="savedGroupFileInput">
              {fileName || "Select file..."}
            </label>
            {numValuesToImport ? (
              <>
                <FaCheckCircle className="text-success-green" />{" "}
                {`${numValuesToImport} ${attributeKey}s ready to import`}
              </>
            ) : (
              <></>
            )}
            {fileErrorMessage ? (
              <p className="text-error-red">
                <FaExclamationTriangle /> {fileErrorMessage}
              </p>
            ) : (
              <></>
            )}
          </div>
        </>
      )}
      {importMethod === "values" && (
        <>
          {fileName && values.length > 1000 ? (
            <p>
              There are too many values being imported to edit them directly.
              Try uploading a new csv instead.
            </p>
          ) : (
            <>
              {rawTextMode ? (
                <Field
                  containerClassName="mb-0"
                  label="List Values to Include"
                  labelClassName="font-weight-bold"
                  required
                  textarea
                  value={rawText}
                  placeholder="Use commas to separate values"
                  minRows={1}
                  onChange={(e) => {
                    setValues(
                      e.target.value.split(",").map((val) => val.trim())
                    );
                  }}
                />
              ) : (
                <StringArrayField
                  containerClassName="mb-0"
                  label="List Values to Include"
                  labelClassName="font-weight-bold"
                  value={values}
                  onChange={(values) => {
                    setValues(values);
                  }}
                  placeholder="Separate values using the 'Enter' key"
                  delimiters={["Enter", "Tab"]}
                />
              )}
              <div className="row justify-content-end">
                <a
                  href="#"
                  style={{ fontSize: "0.8em" }}
                  onClick={(e) => {
                    e.preventDefault();
                    setRawTextMode((prev) => !prev);
                  }}
                >
                  <FaRetweet /> {rawTextMode ? "Token" : "Raw Text"} Mode
                </a>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

const SavedGroupForm: FC<{
  close: () => void;
  current: Partial<SavedGroupInterface>;
  type: SavedGroupType;
}> = ({ close, current, type }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions } = useDefinitions();

  const [errorMessage, setErrorMessage] = useState("");
  const [showDescription, setShowDescription] = useState(false);

  useEffect(() => {
    if (current.description) {
      setShowDescription(true);
    }
  }, [current]);

  const form = useForm<CreateSavedGroupProps>({
    defaultValues: {
      groupName: current.groupName || "",
      owner: current.owner || "",
      attributeKey: current.attributeKey || "",
      condition: current.condition || "",
      type,
      values: current.values || [],
      description: current.description || "",
    },
  });

  const isValid =
    !!form.watch("groupName") &&
    (type === "list"
      ? !!form.watch("attributeKey")
      : !!form.watch("condition"));

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header={`${current.id ? "Edit" : "Add"} ${
        type === "condition" ? "Condition Group" : "ID List"
      }`}
      cta={current.id ? "Save" : "Submit"}
      ctaEnabled={isValid}
      submit={form.handleSubmit(async (value) => {
        if (type === "condition") {
          const conditionRes = validateAndFixCondition(value.condition, (c) => {
            form.setValue("condition", c);
            forceConditionRender();
          });
          if (conditionRes.empty) {
            throw new Error("Condition cannot be empty");
          }
        }

        // Update existing saved group
        if (current.id) {
          const payload: UpdateSavedGroupProps = {
            condition: value.condition,
            groupName: value.groupName,
            owner: value.owner,
            values: value.values,
            description: value.description,
          };
          await apiCall(`/saved-groups/${current.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        }
        // Create new saved group
        else {
          const payload: CreateSavedGroupProps = {
            ...value,
          };
          setErrorMessage("");
          await apiCall(
            `/saved-groups`,
            {
              method: "POST",
              body: JSON.stringify(payload),
            },
            (responseData) => {
              if (responseData.status === 413) {
                setErrorMessage(
                  "Cannot import such a large CSV. Try again with a smaller payload"
                );
              }
            }
          );
        }
        mutateDefinitions({});
      })}
      error={errorMessage}
    >
      <Field
        label={`${type === "list" ? "List" : "Group"} Name`}
        labelClassName="font-weight-bold"
        required
        {...form.register("groupName")}
        placeholder="e.g. beta-users or internal-team-members"
      />
      {showDescription ? (
        <Field
          label="Description"
          labelClassName="font-weight-bold"
          required={false}
          textarea
          maxLength={100}
          value={form.watch("description")}
          onChange={(e) => {
            form.setValue("description", e.target.value);
          }}
        />
      ) : (
        <p
          className="cursor-pointer text-color-primary"
          onClick={() => setShowDescription(true)}
        >
          <FaPlusCircle /> Add a description
        </p>
      )}
      {current.id && (
        <SelectField
          label="Owner"
          labelClassName="font-weight-bold"
          value={form.watch("owner") || ""}
          onChange={(v) => form.setValue("owner", v)}
          placeholder="Optional"
          options={memberUsernameOptions.map((m) => ({
            value: m.display,
            label: m.display,
          }))}
        />
      )}
      {type === "condition" && (
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(v) => form.setValue("condition", v)}
          key={conditionKey}
          project={""}
          emptyText="No conditions specified."
          title="Include all users who match the following"
          require
        />
      )}
      {type === "list" && (
        <>
          <SelectField
            label="Attribute Key"
            labelClassName="font-weight-bold"
            required
            value={form.watch("attributeKey") || ""}
            disabled={!!current.attributeKey}
            onChange={(v) => form.setValue("attributeKey", v)}
            placeholder="Choose one..."
            options={attributeSchema.map((a) => ({
              value: a.property,
              label: a.property,
            }))}
            helpText={current.attributeKey && "This field cannot be edited."}
          />
          {!current.id && (
            <IdListMemberInput
              values={form.watch("values") || []}
              setValues={(newValues) => {
                form.setValue("values", newValues);
              }}
              attributeKey={form.watch("attributeKey") || "ID"}
            />
          )}
        </>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
