import { FC, useMemo, useState } from "react";
import { SegmentInterface } from "back-end/types/segment";
import { useForm } from "react-hook-form";
import { FaArrowRight, FaExternalLinkAlt } from "react-icons/fa";
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
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MultiSelectField from "../Forms/MultiSelectField";
import Tooltip from "../Tooltip/Tooltip";
import SelectOwner from "../Owner/SelectOwner";
import FactSegmentForm from "./FactSegmentForm";

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
    projects,
    factTables,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  // If the segment is externally managed, automatically set it as read-only, even if the user has create/update permissions
  let isReadOnly = !!current?.managedBy;

  // If the segment is not externally managed, check the user's permissions
  if (isReadOnly === false) {
    if (current?.id) {
      // if the current segment has an id, this is an update
      isReadOnly = !permissionsUtil.canUpdateSegment(current, {});
    } else {
      // otherwise, the user is trying to create a new segment
      isReadOnly = !permissionsUtil.canCreateSegment({ projects: [project] });
    }
  }
  const filteredDatasources = datasources
    .filter((d) => d.properties?.segments)
    .filter(
      (d) =>
        d.id === current.datasource ||
        isProjectListValidForProject(d.projects, project),
    );

  const currentOwner = memberUsernameOptions.find(
    (member) => member.display === current.owner,
  );
  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      datasource:
        (current.id ? current.datasource : filteredDatasources[0]?.id) || "",
      userIdType: current.userIdType || "user_id",
      owner: currentOwner?.display || "",
      description: current.description || "",
      projects: current.id
        ? current.projects || []
        : filteredDatasources[0]?.projects || [],
    },
  });
  const [sqlOpen, setSqlOpen] = useState(false);
  const [createFactSegment, setCreateFactSegment] = useState(
    () => current?.type === "FACT",
  );

  const userIdType = form.watch("userIdType");

  const datasource = getDatasourceById(form.watch("datasource"));

  const filteredProjects = projects.filter((project) => {
    // only filter projects is the data source isn't in All Projects (aka, projects is an empty array)
    if (datasource?.projects && datasource.projects.length) {
      return (
        datasource.projects.includes(project.id) ||
        form.watch("projects").includes(project.id)
      );
    }
  });

  const projectOptions = useProjectOptions(
    (project) => permissionsUtil.canCreateSegment({ projects: [project] }),
    form.watch("projects"),
    filteredProjects.length ? filteredProjects : undefined,
  );

  const dsProps = datasource?.properties;
  const supportsSQL = dsProps?.queryLanguage === "sql";

  const sql = form.watch("sql");

  const requiredColumns = useMemo(() => {
    return new Set([userIdType, "date"]);
  }, [userIdType]);

  if (createFactSegment) {
    return (
      <FactSegmentForm
        goBack={() => setCreateFactSegment(false)}
        current={current}
        filteredDatasources={filteredDatasources}
        close={close}
      />
    );
  }

  return (
    <>
      {sqlOpen && datasource && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          sqlObjectInfo={{
            objectType: "Segment",
            objectName: form.watch("name"),
          }}
          datasourceId={datasource.id || ""}
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
        size={"lg"}
        ctaEnabled={!isReadOnly}
        cta={current.id ? "Update Segment" : "Create Segment"}
        header={current.id ? "Edit Segment" : "New Segment"}
        submit={form.handleSubmit(async (value) => {
          if (supportsSQL) {
            validateSQL(value.sql, [value.userIdType, "date"]);
          }

          // Block creating a new segment if the connected data source has projects and the segment doesn't
          if (
            !current.id &&
            datasource?.projects &&
            datasource.projects.length > 0 &&
            !value.projects.length
          ) {
            throw new Error(
              `This segment can not be in "All Projects" since the connected data source is limited to at least one project.`,
            );
          }

          // Block updating an existing Segment with projects to "All Projects" if the connected data source isn't in "All Projects"
          if (
            current.id &&
            datasource?.projects &&
            datasource.projects.length > 0 &&
            !value.projects.length &&
            current.projects?.length
          ) {
            throw new Error(
              `This segment can not be in "All Projects" since the connected data source is limited to at least one project.`,
            );
          }

          await apiCall(current.id ? `/segments/${current.id}` : `/segments`, {
            method: current.id ? "PUT" : "POST",
            body: JSON.stringify({ ...value, type: "SQL" }),
          });
          mutateDefinitions({});
        })}
      >
        {!current.id && factTables.length > 0 ? (
          <div className="alert border badge-purple text-center d-flex align-items-center">
            Want to use Fact Tables to create your segments instead?{" "}
            <a
              href="#"
              className="ml-2 btn btn-primary btn-sm"
              onClick={(e) => {
                e.preventDefault();
                setCreateFactSegment(true);
              }}
            >
              Use Fact Tables <FaArrowRight />
            </a>
          </div>
        ) : null}
        <Field
          label="Name"
          required
          {...form.register("name")}
          disabled={isReadOnly}
        />
        <SelectOwner
          resourceType="segment"
          disabled={isReadOnly}
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
        <Field
          label="Description"
          {...form.register("description")}
          textarea
          disabled={isReadOnly}
        />
        <SelectField
          label="Data Source"
          required
          value={form.watch("datasource")}
          disabled={!!current.id || isReadOnly}
          onChange={(v) => {
            form.setValue("datasource", v);
            // When a new data source is selected, update the projects so they equal the data source's project list
            const newDataSourceObj = getDatasourceById(v);
            form.setValue("projects", newDataSourceObj?.projects || []);
          }}
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
            disabled={isReadOnly}
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
        {projects?.length > 0 && (
          <div className="form-group">
            <MultiSelectField
              label={
                <>
                  Projects{" "}
                  <Tooltip
                    body={`The dropdown below has been filtered to only include projects where you have permission to ${
                      current.id ? "update" : "create"
                    } Segments and those that are a subset of the selected Data Source.`}
                  />
                </>
              }
              placeholder="All projects"
              value={form.watch("projects")}
              disabled={isReadOnly}
              options={projectOptions}
              onChange={(v) => form.setValue("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Assign this segment to specific projects"
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
                disabled={isReadOnly}
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
            disabled={isReadOnly}
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
