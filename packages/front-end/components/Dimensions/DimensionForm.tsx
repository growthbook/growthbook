import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { DimensionInterface } from "back-end/types/dimension";
import { FaExternalLinkAlt } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import { validateSQL } from "@front-end/services/datasources";
import { useAuth } from "@front-end/services/auth";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import Modal from "@front-end/components/Modal";
import Field from "@front-end/components/Forms/Field";
import SelectField from "@front-end/components/Forms/SelectField";
import useMembers from "@front-end/hooks/useMembers";
import EditSqlModal from "@front-end/components/SchemaBrowser/EditSqlModal";
import Code from "@front-end/components/SyntaxHighlighting/Code";

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
    project,
  } = useDefinitions();

  const validDatasources = datasources.filter(
    (d) =>
      d.id === current.datasource ||
      isProjectListValidForProject(d.projects, project)
  );

  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      description: current.description || "",
      datasource:
        (current.id ? current.datasource : validDatasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      owner: current.owner || "",
    },
  });
  const [sqlOpen, setSqlOpen] = useState(false);

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");

  const dsObj = getDatasourceById(datasource);

  const dsProps = dsObj?.properties;
  const supportsSQL = dsProps?.queryLanguage === "sql";

  const sql = form.watch("sql");

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "value"]);
  }, [userIdType]);

  return (
    <>
      {sqlOpen && dsObj && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          datasourceId={dsObj.id || ""}
          placeholder={`SELECT\n      ${userIdType}, date\nFROM\n      mytable`}
          requiredColumns={requiredColumns}
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
            validateSQL(value.sql, [value.userIdType, "value"]);
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
        <Field label="Description" textarea {...form.register("description")} />
        <SelectField
          label="Data Source"
          required
          value={form.watch("datasource")}
          onChange={(v) => form.setValue("datasource", v)}
          placeholder="Choose one..."
          options={validDatasources.map((d) => ({
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
            options={(dsObj?.settings?.userIdTypes || []).map((t) => {
              return {
                label: t.userIdType,
                value: t.userIdType,
              };
            })}
          />
        )}
        {supportsSQL ? (
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
