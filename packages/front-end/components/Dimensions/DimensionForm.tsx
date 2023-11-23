import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { DimensionInterface } from "back-end/types/dimension";
import { FaExternalLinkAlt } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import { validateSQL, validateKQL } from "@/services/datasources";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import useMembers from "@/hooks/useMembers";
import EditSqlModal from "../SchemaBrowser/EditSqlModal";
import EditKqlModal from "../SchemaBrowser/EditKqlModal";
import Code from "../SyntaxHighlighting/Code";

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
  const [kqlOpen, setKqlOpen] = useState(false);

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");

  const dsObj = getDatasourceById(datasource);

  const dsProps = dsObj?.properties;
  const supportsSQL = dsProps?.queryLanguage === "sql";
  const supportsKQL = dsProps?.queryLanguage === "kusto";

  const sql = form.watch("sql");

  const requiredColumns = useMemo(() => {
    if (supportsKQL) return new Set([]);
    return new Set([userIdType, "value"]);
  }, [supportsKQL, userIdType]);

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
      {kqlOpen && dsObj && (
        <EditKqlModal
          close={() => setKqlOpen(false)}
          datasourceId={dsObj.id || ""}
          placeholder={`customEvents\n| project ${userIdType} = tostring(customDimensions["user_Id"]), customDimensions, timestamp`}
          requiredColumns={new Set()}
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

          if (supportsKQL) {
            validateKQL(value.sql, [value.userIdType, "value"]);
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
        {(supportsSQL || supportsKQL) && (
          <div className="form-group">
            <label>Query</label>
            {sql && (
              <Code
                language={supportsKQL ? "kusto" : "sql"}
                code={sql}
                expandable={true}
              />
            )}
            <div>
              <button
                className="btn btn-outline-primary"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  supportsKQL && setKqlOpen(true);
                  supportsSQL && setSqlOpen(true);
                }}
              >
                {`${sql ? "Edit" : "Add"} ${supportsKQL ? "kusto" : "sql"} `}
                <FaExternalLinkAlt />
              </button>
            </div>
          </div>
        )}
        {!supportsKQL && !supportsSQL && (
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
