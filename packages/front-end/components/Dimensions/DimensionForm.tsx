import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { DimensionInterface } from "back-end/types/dimension";
import { FaExternalLinkAlt } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import { validateSQL } from "@/services/datasources";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Code from "@/components/SyntaxHighlighting/Code";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import SelectOwner from "../Owner/SelectOwner";
import MultiSelectField from "../Forms/MultiSelectField";
import Tooltip from "../Tooltip/Tooltip";

const DimensionForm: FC<{
  close: () => void;
  current: Partial<DimensionInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const {
    getDatasourceById,
    datasources,
    mutateDefinitions,
    project,
    projects,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
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
      owner: current?.owner || "",
      projects: current.id
        ? current.projects || []
        : validDatasources[0]?.projects || [],
    },
  });

  console.log("projects", projects);
  const [sqlOpen, setSqlOpen] = useState(false);

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");

  const dsObj = getDatasourceById(datasource);

  const filteredProjects = projects.filter((project) => {
    if (dsObj?.projects && dsObj.projects.length) {
      return (
        dsObj.projects.includes(project.id) ||
        form.watch("projects").includes(project.id)
      );
    }
  });

  const projectOptions = useProjectOptions(
    (project) => permissionsUtil.canCreateDimension({ projects: [project] }),
    form.watch("projects"),
    filteredProjects.length ? filteredProjects : undefined
  );

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
        trackingEventModalType=""
        close={close}
        open={true}
        size="md"
        header={current.id ? "Edit Dimension" : "New Dimension"}
        submit={form.handleSubmit(async (value) => {
          if (supportsSQL) {
            validateSQL(value.sql, [value.userIdType, "value"]);
          }

          // Prevent assigning "All Projects" when the connected data source is restricted to specific projects
          if (
            dsObj?.projects &&
            dsObj.projects.length > 0 &&
            !value.projects.length &&
            (!current.id || current.projects?.length)
          ) {
            throw new Error(
              `This dimension can not be in "All Projects" since the connected data source is limited to at least one project.`
            );
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
        <SelectOwner
          resourceType="dimension"
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
        <Field label="Description" textarea {...form.register("description")} />
        <SelectField
          label="Data Source"
          required
          value={form.watch("datasource")}
          disabled={!!current.id}
          onChange={(v) => {
            form.setValue("datasource", v);
            // When a new data source is selected, reset the projects field to match the selected data source's associated projects
            const newDsObj = getDatasourceById(v);
            form.setValue("projects", newDsObj?.projects || []);
          }}
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
        {projects?.length > 0 && (
          <div className="form-group">
            <MultiSelectField
              label={
                <>
                  Projects{" "}
                  <Tooltip
                    body={`The dropdown below has been filtered to only include projects where you have permission to ${
                      current.id ? "update" : "create"
                    } Dimensions and those that are a subset of the selected Data Source.`}
                  />
                </>
              }
              placeholder="All projects"
              value={form.watch("projects")}
              options={projectOptions}
              onChange={(v) => form.setValue("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Assign this dimension to specific projects"
            />
          </div>
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
