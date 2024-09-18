import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { SegmentInterface } from "back-end/types/segment";
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
  } = useDefinitions();

  // Build a list of unique data source ids that have atleast 1 fact table built on it
  const uniqueDatasourcesWithFactTables = Array.from(
    new Set(factTables.map((ft) => ft.datasource))
  );

  // Filter the list of datasources to only show those that have atleast 1 fact built on it
  const datasourceOptions = filteredDatasources.filter((filteredDs) =>
    uniqueDatasourcesWithFactTables.includes(filteredDs.id)
  );

  const form = useForm({
    defaultValues: {
      name: current?.name || "",
      datasource:
        (current?.id ? current?.datasource : datasourceOptions[0]?.id) || "",
      userIdType: current?.userIdType || "user_id",
      owner: current?.owner || "",
      description: current?.description || "",
      factTableId: current?.factTableId || "",
      filters: current?.filters || [],
      type: "FACT",
    },
  });

  const datasource = getDatasourceById(form.watch("datasource"));
  const factTable = getFactTableById(form.watch("factTableId"));

  return (
    <Modal
      trackingEventModalType=""
      close={close}
      open={true}
      size={"lg"}
      cta={current?.factTableId ? "Update Segment" : "Create Segment"}
      header={current?.factTableId ? "Edit Segment" : "Create Segment"}
      submit={form.handleSubmit(async (value) => {
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
          options={datasourceOptions.map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
          helpText="This list has been filtered to only show data sources that have at least one Fact Table built on top of it"
        />
        <div className="appbox px-3 pt-3 bg-light">
          <div className="row align-items-center">
            <div className="col-auto">
              <SelectField
                label={"Fact Table"}
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
                  placeholder="All Rows"
                  closeMenuOnSelect={true}
                  formatOptionLabel={({ value, label }) => {
                    const filter = factTable?.filters.find(
                      (f) => f.id === value
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
