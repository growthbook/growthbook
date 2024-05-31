import { FC, useMemo, useState } from "react";
import { SegmentInterface } from "back-end/types/segment";
import { useForm } from "react-hook-form";
import { FaExternalLinkAlt } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { validateSQL } from "@/services/datasources";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import useMembers from "@/hooks/useMembers";
import { useDefinitions } from "@/services/DefinitionsContext";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Code from "@/components/SyntaxHighlighting/Code";

export type CursorData = {
  row: number;
  column: number;
  input: string[];
};

const SegmentForm: FC<{
  close: () => void;
  current: Partial<SegmentInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();
  const {
    datasources,
    getDatasourceById,
    mutateDefinitions,
    project,
  } = useDefinitions();
  const filteredDatasources = datasources
    .filter((d) => d.properties?.segments)
    .filter(
      (d) =>
        d.id === current.datasource ||
        isProjectListValidForProject(d.projects, project)
    );
  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      datasource:
        (current.id ? current.datasource : filteredDatasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      owner: current.owner || "",
      description: current.description || "",
    },
  });
  const [sqlOpen, setSqlOpen] = useState(false);

  const userIdType = form.watch("userIdType");

  const datasource = getDatasourceById(form.watch("datasource"));

  const dsProps = datasource?.properties;
  const supportsSQL = dsProps?.queryLanguage === "sql";

  const sql = form.watch("sql");

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "date"]);
  }, [userIdType]);

  return (
    <>
      {sqlOpen && datasource && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          datasourceId={datasource.id || ""}
          placeholder={`SELECT\n      ${userIdType}, date\nFROM\n      mytable`}
          requiredColumns={requiredColumns}
          value={sql}
          save={async (sql) => form.setValue("sql", sql)}
        />
      )}
      <Modal
        close={close}
        open={true}
        size={"md"}
        header={current.id ? "Edit Segment" : "New Segment"}
        submit={form.handleSubmit(async (value) => {
          if (supportsSQL) {
            validateSQL(value.sql, [value.userIdType, "date"]);
          }

          await apiCall(current.id ? `/segments/${current.id}` : `/segments`, {
            method: current.id ? "PUT" : "POST",
            body: JSON.stringify(value),
          });
          mutateDefinitions({});
        })}
      >
        <Field label="Name" required {...form.register("name")} />
        <Field
          label="Owner"
          options={memberUsernameOptions}
          comboBox
          {...form.register("owner")}
        />
        <Field label="Description" {...form.register("description")} textarea />
        <SelectField
          label="Data Source"
          required
          value={form.watch("datasource")}
          onChange={(v) => form.setValue("datasource", v)}
          placeholder="Choose one..."
          options={filteredDatasources.map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
        />
        {datasource?.properties?.userIds && (
          <SelectField
            label="Identifier Type"
            required
            value={userIdType}
            onChange={(v) => form.setValue("userIdType", v)}
            options={(datasource?.settings?.userIdTypes || []).map((t) => {
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
            placeholder={"event.properties.$browser === 'Chrome'"}
            helpText={
              <>
                Javascript condition used to filter events. Has access to an{" "}
                <code>event</code> variable.
              </>
            }
          />
        )}
      </Modal>
    </>
  );
};
export default SegmentForm;
