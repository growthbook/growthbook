import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { SegmentInterface } from "shared/types/segment";
import { GBArrowLeft } from "@/components/Icons";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import useMembers from "@/hooks/useMembers";
import { useDefinitions } from "@/services/DefinitionsContext";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SelectOwner from "../Owner/SelectOwner";

type Props = {
  goBack: () => void;
  current: Partial<SegmentInterface> | null;
  filteredDatasources: DataSourceInterfaceWithParams[];
  close: () => void;
};

export default function FactSegmentForm({
  goBack,
  current,
  filteredDatasources,
  close,
}: Props) {
  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();
  const {
    getDatasourceById,
    factTables,
    getFactTableById,
    mutateDefinitions,
    projects,
    project,
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

  // Build a list of unique data source ids that have atleast 1 fact table built on it
  const uniqueDatasourcesWithFactTables = Array.from(
    new Set(factTables.map((ft) => ft.datasource)),
  );

  // Filter the list of datasources to only show those that have atleast 1 fact built on it
  const datasourceOptions = filteredDatasources.filter((filteredDs) =>
    uniqueDatasourcesWithFactTables.includes(filteredDs.id),
  );

  const currentOwner = memberUsernameOptions.find(
    (member) => member.display === current?.owner,
  );

  const form = useForm({
    defaultValues: {
      name: current?.name || "",
      datasource:
        (current?.id ? current?.datasource : datasourceOptions[0]?.id) || "",
      userIdType: current?.userIdType || "user_id",
      owner: currentOwner?.display || "",
      description: current?.description || "",
      factTableId: current?.factTableId || "",
      filters: current?.filters || [],
      type: "FACT",
      projects: current?.id
        ? current.projects || []
        : filteredDatasources[0]?.projects || [],
    },
  });

  const datasource = getDatasourceById(form.watch("datasource"));
  const factTable = getFactTableById(form.watch("factTableId"));

  // Projects must be a subset of a data source's projects
  const filteredProjects = projects.filter((project) => {
    // only filter projects if the data source isn't in All Projects (aka, projects is an empty array)
    if (datasource?.projects && datasource.projects.length) {
      return (
        datasource.projects.includes(project.id) ||
        form.watch("projects").includes(project.id)
      );
    }
  });

  const projectOptions = useProjectOptions(
    (project) => permissionsUtil.canCreateSegment({ projects: [project] }),
    form.watch("projects") || [],
    filteredProjects.length ? filteredProjects : undefined,
  );

  return (
    <Modal
      trackingEventModalType=""
      close={close}
      open={true}
      size={"lg"}
      ctaEnabled={!isReadOnly}
      cta={current?.factTableId ? "Update Segment" : "Create Segment"}
      header={current?.factTableId ? "Edit Segment" : "Create Segment"}
      submit={form.handleSubmit(async (value) => {
        // Block creating a new segment if the selected data source has projects, and the segment is in 'All Projects'
        // If the user is updating an existing segment, we can ignore this
        if (
          !current?.id &&
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
          current?.id &&
          datasource?.projects &&
          datasource.projects.length > 0 &&
          !value.projects.length &&
          current?.projects?.length
        ) {
          throw new Error(
            `This segment can not be in "All Projects" since the connected data source is limited to at least one project.`,
          );
        }

        if (current?.id) {
          await apiCall(`/segments/${current.id}`, {
            method: "PUT",
            body: JSON.stringify(value),
          });
        } else {
          await apiCall(`/segments`, {
            method: "POST",
            body: JSON.stringify(value),
          });
        }
        mutateDefinitions();
      })}
    >
      <>
        {!current?.id ? (
          <div className="mb-3">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goBack();
              }}
            >
              <GBArrowLeft /> Go Back
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
          resourceType="factSegment"
          value={form.watch("owner")}
          disabled={isReadOnly}
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
          onChange={(v) => {
            form.setValue("datasource", v);
            // When a new data source is selected, update the projects so they equal the data source's project list
            const newDataSourceObj = getDatasourceById(v);
            form.setValue("projects", newDataSourceObj?.projects || []);
          }}
          placeholder="Choose one..."
          options={datasourceOptions.map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
          disabled={!!current?.id || isReadOnly}
          helpText="This list has been filtered to only show data sources that have at least one Fact Table built on top of it"
        />
        {projects?.length > 0 && (
          <div className="form-group">
            <MultiSelectField
              label={
                <>
                  Projects{" "}
                  <Tooltip
                    body={`The dropdown below has been filtered to only include projects where you have permission to ${
                      current?.factTableId ? "update" : "create"
                    } Segments.`}
                  />
                </>
              }
              placeholder="All projects"
              value={form.watch("projects")}
              options={projectOptions}
              disabled={isReadOnly}
              onChange={(v) => form.setValue("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Assign this segment to specific projects"
            />
          </div>
        )}
        <div className="appbox px-3 pt-3 bg-light">
          <div className="row align-items-center">
            <div className="col-auto">
              <SelectField
                label={"Fact Table"}
                disabled={isReadOnly}
                value={form.watch("factTableId")}
                onChange={(factTableId) =>
                  form.setValue("factTableId", factTableId)
                }
                options={factTables
                  .filter((t) => t.datasource === datasource?.id)
                  .map((t) => ({
                    label: t.name,
                    value: t.id,
                  }))}
                formatOptionLabel={({ value, label }) => {
                  const factTable = getFactTableById(value);
                  if (factTable) {
                    return (
                      <>
                        {factTable.name}
                        <OfficialBadge
                          managedBy={factTable.managedBy}
                          type="fact table"
                        />
                      </>
                    );
                  }
                  return label;
                }}
                placeholder="Select..."
                required
              />
            </div>
            {factTable && factTable.filters.length > 0 ? (
              <div className="col-auto">
                <MultiSelectField
                  label={
                    <>
                      Included Rows{" "}
                      <Tooltip body="Only rows that satisfy ALL selected filters will be included" />
                    </>
                  }
                  value={form.watch("filters")}
                  onChange={(filters) => form.setValue("filters", filters)}
                  options={factTable.filters.map((f) => ({
                    label: f.name,
                    value: f.id,
                  }))}
                  disabled={isReadOnly}
                  placeholder="All Rows"
                  closeMenuOnSelect={true}
                  formatOptionLabel={({ value, label }) => {
                    const filter = factTable?.filters.find(
                      (f) => f.id === value,
                    );
                    if (filter) {
                      return (
                        <>
                          {filter.name}
                          <OfficialBadge
                            managedBy={filter.managedBy}
                            type="filter"
                          />
                        </>
                      );
                    }
                    return label;
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <SelectField
          label="Identifier"
          required
          disabled={isReadOnly}
          value={form.watch("userIdType")}
          onChange={(v) => form.setValue("userIdType", v)}
          placeholder="Select an identifier"
          options={
            factTable?.userIdTypes.map((userIdType) => ({
              value: userIdType,
              label: userIdType,
            })) || []
          }
        />
      </>
    </Modal>
  );
}
