import { FC, useEffect, useState } from "react";
import {
  CreateSavedGroupProps,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import {
  LARGE_GROUP_SIZE_LIMIT_BYTES,
  SMALL_GROUP_SIZE_LIMIT,
  validateAndFixCondition,
} from "shared/util";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaPlusCircle,
  FaRetweet,
} from "react-icons/fa";
import { SavedGroupInterface, SavedGroupType } from "shared/src/types";
import clsx from "clsx";
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
import LargeSavedGroupSupportWarning, {
  useLargeSavedGroupSupport,
} from "./LargeSavedGroupSupportWarning";

export const IdListMemberInput: FC<{
  values: string[];
  attributeKey: string;
  passByReferenceOnly: boolean;
  limit?: number;
  setValues: (newValues: string[]) => void;
  setPassByReferenceOnly: (passByReferenceOnly: boolean) => void;
  setDisableSubmit: (disabled: boolean) => void;
}> = ({
  values,
  attributeKey,
  passByReferenceOnly,
  limit = SMALL_GROUP_SIZE_LIMIT,
  setValues,
  setPassByReferenceOnly,
  setDisableSubmit,
}) => {
  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState(values.join(", ") || "");
  useEffect(() => {
    setRawText(values.join(","));
  }, [values]);

  const [importMethod, setImportMethod] = useState<"file" | "values">("values");
  const [numValuesToImport, setNumValuesToImport] = useState<number | null>(
    null
  );
  const [fileName, setFileName] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const {
    supportedConnections,
    unsupportedConnections,
    unversionedConnections,
  } = useLargeSavedGroupSupport();

  const resetFile = () => {
    setValues([]);
    setNumValuesToImport(null);
    setFileName("");
    setFileErrorMessage("");
    setNonLegacyImport(false);
  };

  const [nonLegacyImport, setNonLegacyImport] = useState(false);

  useEffect(() => {
    if (values.length > limit) {
      setNonLegacyImport(true);
      setPassByReferenceOnly(true);
    } else {
      setNonLegacyImport(false);
      setPassByReferenceOnly(false);
    }
  }, [values, limit, setPassByReferenceOnly]);

  useEffect(() => {
    if (supportedConnections.length > 0) {
      setDisableSubmit(false);
    } else if (nonLegacyImport && !passByReferenceOnly) {
      setDisableSubmit(true);
    } else {
      setDisableSubmit(false);
    }
  }, [
    setDisableSubmit,
    supportedConnections,
    nonLegacyImport,
    passByReferenceOnly,
  ]);

  return (
    <>
      <label className="form-group font-weight-bold">
        Choose how to enter items for this list:
      </label>
      <div className="row ml-0 mr-0 form-group">
        <div className="cursor-pointer row align-items-center ml-0 mr-5">
          <input
            type="radio"
            id="enterValues"
            checked={importMethod === "values"}
            readOnly={true}
            className="mr-1 radio-button-lg"
            onChange={() => {
              setImportMethod("values");
              resetFile();
            }}
          />
          <label className="m-0" htmlFor="enterValues">
            Manually enter values (Limit: 100)
          </label>
        </div>
        <div className="cursor-pointer row align-items-center ml-0 mr-0">
          <input
            type="radio"
            id="importCsv"
            checked={importMethod === "file"}
            readOnly={true}
            className="mr-1 radio-button-lg"
            onChange={() => {
              setImportMethod("file");
              resetFile();
            }}
          />
          <label className="m-0" htmlFor="importCsv">
            Import CSV
          </label>
        </div>
      </div>
      {importMethod === "file" && (
        <>
          {!passByReferenceOnly && (
            <LargeSavedGroupSupportWarning
              type="saved_group_creation"
              supportedConnections={supportedConnections}
              unsupportedConnections={unsupportedConnections}
              unversionedConnections={unversionedConnections}
            />
          )}
          {(passByReferenceOnly || supportedConnections.length > 0) && (
            <>
              <div
                className="custom-file height:"
                onClick={(e) => {
                  if (fileName) {
                    e.stopPropagation();
                    e.preventDefault();
                    resetFile();
                  }
                }}
              >
                <input
                  type="file"
                  key={fileName}
                  required={false}
                  className="custom-file-input cursor-pointer"
                  id="savedGroupFileInput"
                  accept=".csv"
                  onChange={(e) => {
                    resetFile();

                    const file: File | undefined = e.target?.files?.[0];
                    if (!file) {
                      return;
                    }
                    if (!file.name.endsWith(".csv")) {
                      setFileErrorMessage("Only .csv file types are supported");
                      return;
                    }
                    if (file.size > LARGE_GROUP_SIZE_LIMIT_BYTES) {
                      setFileErrorMessage("File size must be less than 1 MB");
                      return;
                    }

                    const reader = new FileReader();
                    reader.onload = function (e) {
                      try {
                        const str = e.target?.result;
                        if (typeof str !== "string") {
                          setFileErrorMessage(
                            "Failed to import file. Please try again"
                          );
                          return;
                        }
                        const newValues = str
                          .replaceAll(/[\n\s]/g, "")
                          .split(",");
                        setFileName(file.name);
                        setValues(newValues);
                        setNumValuesToImport(newValues.length);
                        setNonLegacyImport(true);
                      } catch (e) {
                        console.error(e);
                        return;
                      }
                    };
                    reader.readAsText(file);
                  }}
                />
                <label
                  className={clsx([
                    "custom-file-label",
                    fileName ? "remove-file" : "",
                  ])}
                  htmlFor="savedGroupFileInput"
                  data-browse={fileName ? "Remove" : "Browse"}
                >
                  {fileName || "Select file..."}
                </label>
              </div>
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
            </>
          )}
        </>
      )}
      {importMethod === "values" && (
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
                  e.target.value
                    .split(",")
                    .map((val) => val.trim())
                    .slice(0, 100)
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
                setValues(values.slice(0, 100));
              }}
              placeholder="Separate values using the 'Enter' key"
              delimiters={["Enter", "Tab"]}
            />
          )}
          <div className="row justify-content-end">
            <span className="mr-1">
              Items remaining: {limit - values.length}
            </span>
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
      passByReferenceOnly: current.passByReferenceOnly || false,
    },
  });

  const [disableSubmit, setDisableSubmit] = useState(false);

  const [
    attributeTargetingSdkIssues,
    setAttributeTargetingSdkIssues,
  ] = useState(false);

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
      ctaEnabled={isValid && !disableSubmit && !attributeTargetingSdkIssues}
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
            passByReferenceOnly: value.passByReferenceOnly,
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
      {current.type === "condition" && (
        <div className="form-group">
          Updating this group will automatically update any associated Features
          and Experiments.
        </div>
      )}
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
          setAttributeTargetingSdkIssues={setAttributeTargetingSdkIssues}
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
              attributeKey={form.watch("attributeKey") || "ID"}
              passByReferenceOnly={current?.passByReferenceOnly || false}
              setValues={(newValues) => {
                form.setValue("values", newValues);
              }}
              setPassByReferenceOnly={(passByReferenceOnly) =>
                form.setValue("passByReferenceOnly", passByReferenceOnly)
              }
              setDisableSubmit={setDisableSubmit}
            />
          )}
        </>
      )}
    </Modal>
  );
};
export default SavedGroupForm;
