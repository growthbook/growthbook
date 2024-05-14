import { useFormContext } from "react-hook-form";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";

export default function DatasourceSettings() {
  const form = useFormContext();
  const { datasources } = useDefinitions();

  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>Data Source Settings</h4>
      </div>
      <div className="col-sm-9">
        <SelectField
          label="Default Data Source (Optional)"
          value={form.watch("defaultDataSource") || ""}
          options={datasources.map((d) => ({
            label: d.name,
            value: d.id,
          }))}
          onChange={(v: string) => form.setValue("defaultDataSource", v)}
          isClearable={true}
          placeholder="Select a data source..."
          helpText="The default data source is the default data source selected when creating metrics and experiments."
        />
        <div>
          <div className="form-inline">
            <Field
              label="Test Query Lookback Length"
              type="number"
              min="1"
              append="days"
              className="ml-2"
              containerClassName="mt-2"
              {...form.register("testQueryDays", {
                valueAsNumber: true,
              })}
            />
          </div>
          <small className="form-text text-muted">
            {`The number of days to look back when running test queries that have date filters. If
                empty, uses default of ${DEFAULT_TEST_QUERY_DAYS} days.`}
          </small>
        </div>
      </div>
    </div>
  );
}
