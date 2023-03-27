import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { DimensionInterface } from "back-end/types/dimension";
import { FaExternalLinkAlt } from "react-icons/fa";
import { validateSQL } from "@/services/datasources";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import useMembers from "@/hooks/useMembers";
import EditSqlModal from "../SchemaBrowser/EditSqlModal";
import Code from "../SyntaxHighlighting/Code";
import SQLInputField from "../SQLInputField";

const DimensionForm: FC<{
  close: () => void;
  current: Partial<DimensionInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();
  const {
    getDatasourceById,
    datasources,
    mutateDefinitions,
  } = useDefinitions();

  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      datasource: (current.id ? current.datasource : datasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      owner: current.owner || "",
    },
  });
  const [sqlOpen, setSqlOpen] = useState(false);

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");

  const dsObj = getDatasourceById(datasource);
  const supportsSchemaBrowser = dsObj?.properties.supportsInformationSchema;

  const dsProps = dsObj?.properties;
  const supportsSQL = dsProps?.queryLanguage === "sql";

  const sql = form.watch("sql");

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "value"]);
  }, [userIdType]);

  return (
    <>
      {sqlOpen && datasource && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          datasourceId={dsObj.id || ""}
          placeholder={`SELECT\n      ${userIdType}, date\nFROM\n      mytable`}
          requiredColumns={Array.from(requiredColumns)}
          value={sql}
          save={async (sql) => form.setValue("sql", sql)}
        />
      )}
      <Modal
        close={close}
        open={true}
        size="md"
        header={current.id ? "Edit Dimension" : "New Dimension"}
        submit={form.handleSubmit(async (value) => {
          if (supportsSQL) {
            if (!sql) throw new Error("SQL cannot be empty");
            validateSQL(value.sql, [value.userIdType, "date"]);
          }

          await apiCall(
            current.id ? `/dimensions/${current.id}` : `/dimensions`,
            {
              method: current.id ? "PUT" : "POST",
              body: JSON.stringify(value),
            }
          );
          mutateDefinitions();
        })}
      >
        <Field label="Name" required {...form.register("name")} />
        <Field
          label="Owner"
          options={memberUsernameOptions}
          comboBox
          {...form.register("owner")}
        />
        <SelectField
          label="Data Source"
          required
          value={form.watch("datasource")}
          onChange={(v) => form.setValue("datasource", v)}
          placeholder="Choose one..."
          options={datasources.map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
        />
        {dsProps?.userIds && (
          <SelectField
            label="Identifier Type"
            required
            value={userIdType}
            onChange={(v) => form.setValue("userIdType", v)}
            options={(dsObj.settings.userIdTypes || []).map((t) => {
              return {
                label: t.userIdType,
                value: t.userIdType,
              };
            })}
          />
        )}
        {supportsSQL ? (
          <>
            {supportsSchemaBrowser ? (
              <div className="form-group">
                <label>Query</label>
                {sql && <Code language="sql" code={sql} expandable={true} />}
                <div>
                  <button
                    className="btn btn-outline-primary"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setSqlOpen(true);
                    }}
                  >
                    {sql ? "Edit" : "Add"} SQL <FaExternalLinkAlt />
                  </button>
                </div>
              </div>
            ) : (
              <SQLInputField
                userEnteredQuery={form.watch("sql")}
                datasourceId={dsObj.id}
                form={form}
                requiredColumns={requiredColumns}
                placeholder={`SELECT\n      ${userIdType}, browser as value\nFROM\n      users`}
                helpText={
                  <>
                    Select two columns named <code>{userIdType}</code> and{" "}
                    <code>value</code>
                  </>
                }
                queryType="dimension"
              />
            )}
          </>
        ) : (
          <Field
            label="Event Condition"
            required
            {...form.register("sql")}
            textarea
            minRows={3}
            placeholder={"$browser"}
          />
        )}
        <p>
          <strong>Important:</strong> Please limit dimensions to at most 50
          unique values.
        </p>
      </Modal>
    </>
  );
};
export default DimensionForm;
