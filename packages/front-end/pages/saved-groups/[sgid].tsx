import { type } from "os";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  CreateSavedGroupProps,
  SavedGroupInterface,
  SavedGroupType,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { useForm } from "react-hook-form";
import { FaCheck } from "react-icons/fa";
import IdLists from "@/components/SavedGroups/IdLists";
import ConditionGroups from "@/components/SavedGroups/ConditionGroups";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import ConditionInput from "@/components/Features/ConditionInput";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import useMembers from "@/hooks/useMembers";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAttributeSchema } from "@/services/features";

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { savedGroups, error } = useDefinitions();
  const { memberUsernameOptions } = useMembers();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema();

  const { mutateDefinitions } = useDefinitions();

  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [importMethod, setImportMethod] = useState<null | "file" | "values">(
    null
  );
  const [successText, setSuccessText] = useState("");

  const form = useForm<UpdateSavedGroupProps>({
    defaultValues: {
      groupName: "",
      owner: "",
      condition: "",
      values: [],
    },
  });

  if (!savedGroups) return <LoadingOverlay />;

  const current = savedGroups.filter((sg) => sg.id === sgid)[0];
  if (!current) return <>TODO - 404</>;

  return (
    <div className="p-3 container-fluid pagecontents">
      <div className="row">
        <div className="col">
          <h1>Saved Group: {current.groupName}</h1>
        </div>
      </div>
      {error ? (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      ) : (
        <>
          <Field
            label="Group Name"
            required
            {...form.register("groupName")}
            placeholder="e.g. beta-users or internal-team-members"
          />
          {current.id && (
            <SelectField
              label="Owner"
              value={form.watch("owner") || ""}
              onChange={(v) => form.setValue("owner", v)}
              placeholder="Optional"
              options={memberUsernameOptions.map((m) => ({
                value: m.display,
                label: m.display,
              }))}
            />
          )}
          {current.type === "condition" ? (
            <ConditionInput
              defaultValue={form.watch("condition") || ""}
              onChange={(v) => form.setValue("condition", v)}
              key={conditionKey}
              project={""}
              emptyText="No conditions specified."
              title="Include all users who match the following"
              require
            />
          ) : (
            <>
              <SelectField
                label="Attribute Key"
                required={false}
                value={current.attributeKey || ""}
                disabled={true}
                onChange={(v) => {}}
                options={attributeSchema.map((a) => ({
                  value: a.property,
                  label: a.property,
                }))}
                helpText="This field can not be edited."
              />
              <div>How would you like to enter the IDs in this group?</div>
              <button onClick={() => setImportMethod("file")}>
                Import CSV
              </button>
              <button onClick={() => setImportMethod("values")}>
                Enter values manually
              </button>
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
                        setSuccessText("");
                        const file: File | undefined = e.target?.files?.[0];
                        if (!file) {
                          return;
                        }

                        const reader = new FileReader();
                        reader.onload = function (e) {
                          try {
                            const str = e.target?.result;
                            if (typeof str !== "string") {
                              return;
                            }
                            const values = str.split(/\s*,\s*/);
                            form.setValue("values", values);
                            setSuccessText(
                              `${values.length} IDs ready to import`
                            );
                          } catch (e) {
                            console.error(e);
                            return;
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                    <label
                      className="custom-file-label"
                      htmlFor="savedGroupFileInput"
                    >
                      Upload CSV with ids to include...
                    </label>
                    {successText ? (
                      <>
                        <FaCheck /> {successText}
                      </>
                    ) : (
                      <></>
                    )}
                  </div>
                </>
              )}
              {importMethod === "values" && (
                <>
                  {rawTextMode ? (
                    <Field
                      containerClassName="mb-0"
                      label="Create list of comma separated values"
                      required
                      textarea
                      value={rawText}
                      onChange={(e) => {
                        setRawText(e.target.value);
                        form.setValue(
                          "values",
                          e.target.value.split(",").map((val) => val.trim())
                        );
                      }}
                    />
                  ) : (
                    <StringArrayField
                      containerClassName="mb-0"
                      label="Create list of values"
                      value={form.watch("values") || []}
                      onChange={(values) => {
                        form.setValue("values", values);
                        setRawText(values.join(","));
                      }}
                      placeholder="Enter some values..."
                      delimiters={["Enter", "Tab"]}
                    />
                  )}
                  <a
                    className="d-flex flex-column align-items-end"
                    href="#"
                    style={{ fontSize: "0.8em" }}
                    onClick={(e) => {
                      e.preventDefault();
                      setRawTextMode((prev) => !prev);
                    }}
                  >
                    Switch to {rawTextMode ? "token" : "raw text"} mode
                  </a>
                </>
              )}
            </>
          )}
          {current.id && (
            <div className="alert alert-warning mt-2">
              <b>Warning:</b> Updating this group will automatically update any
              feature or experiment that references it.
            </div>
          )}
        </>
      )}
    </div>
  );
}
