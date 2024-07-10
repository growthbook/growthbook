import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "@back-end/types/datasource";
import { SegmentInterface } from "@back-end/types/segment";
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
  const form = useForm({
    defaultValues: {
      name: current?.name || "",
      datasource:
        (current?.id ? current?.datasource : filteredDatasources[0]?.id) || "",
      userIdType: current?.userIdType || "user_id",
      owner: current?.owner || "",
      description: current?.description || "",
      factTableId: current?.factTableId || "",
      filters: current?.filters || [],
      type: "FACT",
    },
  });

  console.log("current", current);
  const datasource = getDatasourceById(form.watch("datasource"));
  const factTable = getFactTableById(form.watch("factTableId"));

  return (
    <Modal
      close={close}
      open={true}
      size={"md"}
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
        {/* MKTODO: Filter based on which datasources have fact tables */}
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
        <SelectField
          label="Identifier"
          required
          value={form.watch("userIdType")}
          onChange={(v) => form.setValue("userIdType", v)}
          placeholder="Select an identifier"
          options={
            datasource?.settings.userIdTypes?.map((userIdType) => ({
              value: userIdType.userIdType,
              label: userIdType.userIdType,
            })) || []
          }
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
      </>
    </Modal>
  );
}
