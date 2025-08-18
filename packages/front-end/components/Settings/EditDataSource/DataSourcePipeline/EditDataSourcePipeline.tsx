import { FC } from "react";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  DataSourcePipelineSettings,
} from "back-end/types/datasource";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Tooltip from "@/components/Tooltip/Tooltip";
import { dataSourcePathNames } from "./DataSourcePipeline";

type EditDataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

type FormValues = Required<
  Pick<
    DataSourcePipelineSettings,
    | "mode"
    | "allowWriting"
    | "writeDatabase"
    | "writeDataset"
    | "unitsTableRetentionHours"
    | "unitsTableDeletion"
  >
> & {
  partitionSettings?: DataSourcePipelineSettings["partitionSettings"];
};

export const EditDataSourcePipeline: FC<EditDataSourcePipelineProps> = ({
  dataSource,
  onSave,
  onCancel,
}: {
  dataSource: DataSourceInterfaceWithParams;
  onSave: (dataSource: DataSourceInterfaceWithParams) => Promise<void>;
  onCancel: () => void;
}) => {
  if (!dataSource) {
    throw new Error("ImplementationError: dataSource cannot be null");
  }
  const pathNames = dataSourcePathNames(dataSource.type);

  const form = useForm<FormValues>({
    defaultValues: {
      mode: dataSource.settings.pipelineSettings?.mode ?? "temporary",
      allowWriting: dataSource.settings.pipelineSettings?.allowWriting ?? false,
      writeDatabase: dataSource.settings.pipelineSettings?.writeDatabase ?? "",
      writeDataset: dataSource.settings.pipelineSettings?.writeDataset ?? "",
      unitsTableRetentionHours:
        dataSource.settings.pipelineSettings?.unitsTableRetentionHours ?? 24,
      unitsTableDeletion:
        dataSource.settings.pipelineSettings?.unitsTableDeletion ?? true,
      partitionSettings:
        dataSource.settings.pipelineSettings?.partitionSettings,
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    // Only include partitionSettings if defined; otherwise remove it
    const { partitionSettings, ...rest } = value;
    copy.settings.pipelineSettings = {
      ...rest,
      ...(partitionSettings ? { partitionSettings } : {}),
    };
    await onSave(copy);
    onCancel();
  });

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      submit={handleSubmit}
      close={onCancel}
      header="Edit Data Source Pipeline Settings"
      cta="Save"
    >
      <div>
        <label className="mr-2">
          Allow GrowthBook to write tables during experiment analyses?
        </label>
        <Toggle
          id={"toggle-allowWriting"}
          value={!!form.watch("allowWriting")}
          setValue={(value) => {
            form.setValue("allowWriting", value);
          }}
        />
      </div>
      {form.watch("allowWriting") ? (
        <div className="form-inline flex-column align-items-start mb-4 mt-4">
          <SelectField
            label="Pipeline Mode"
            className="ml-2"
            containerClassName="mb-3"
            required
            value={form.watch("mode")}
            onChange={(v) =>
              form.setValue("mode", v as "temporary" | "incremental")
            }
            options={[
              {
                label: "Incremental (persist units table)",
                value: "incremental",
              },
              { label: "Temporary (per-analysis)", value: "temporary" },
            ]}
          />
          <label>
            {`Destination ${pathNames.databaseName} (optional)`}{" "}
            <Tooltip
              body={`If left blank will try to write to default ${pathNames.databaseName}`}
            />
          </label>
          <Field
            className="ml-2"
            containerClassName="mb-2"
            type="text"
            {...form.register("writeDatabase")}
          />
          <label>{`Destination ${pathNames.schemaName}`} </label>
          <Field
            className="ml-2"
            containerClassName="mb-4"
            type="text"
            required
            {...form.register("writeDataset")}
          />
          {dataSource.type === "databricks" ? (
            <>
              <div className="mt-4">
                <label>Delete temporary units table (recommended)</label>
                <Toggle
                  id={"toggle-unitsTableDeletion"}
                  value={!!form.watch("unitsTableDeletion")}
                  setValue={(value) => {
                    form.setValue("unitsTableDeletion", value);
                  }}
                />
              </div>
              {!form.watch("unitsTableDeletion") ? (
                <div className="small text-muted mt-1">
                  Disabling this will require you to periodically remove
                  temporary tables from your Databricks Warehouse
                </div>
              ) : null}
            </>
          ) : form.watch("mode") === "temporary" ? (
            <>
              <Field
                label="Retention of temporary units table (hours)"
                className="ml-2"
                containerClassName="mb-2"
                type="number"
                min={1}
                {...form.register("unitsTableRetentionHours")}
              />
              {dataSource.type === "snowflake" ? (
                <div className="small text-muted">
                  Rounded up to nearest day for Snowflake
                </div>
              ) : null}
            </>
          ) : null}

          {
            <>
              <hr className="w-100" />
              <SelectField
                label="Partition Type (optional)"
                className="ml-2"
                containerClassName="mb-2"
                value={form.watch("partitionSettings")?.type || ""}
                onChange={(v) => {
                  if (!v) {
                    // Clear partition settings
                    form.setValue("partitionSettings", undefined);
                    return;
                  }
                  if (v === "timestamp") {
                    form.setValue("partitionSettings", { type: "timestamp" });
                  } else if (v === "yearMonthDate") {
                    const current = form.getValues("partitionSettings");
                    form.setValue("partitionSettings", {
                      type: "yearMonthDate",
                      yearColumn: current?.yearColumn || "",
                      monthColumn: current?.monthColumn || "",
                      dateColumn: current?.dateColumn || "",
                    });
                  }
                }}
                initialOption="None"
                isClearable
                options={[
                  { label: "Timestamp", value: "timestamp" },
                  { label: "Year/Month/Date", value: "yearMonthDate" },
                ]}
              />
              {form.watch("partitionSettings")?.type === "yearMonthDate" ? (
                <div className="ml-2 w-100">
                  <Field
                    label="Year column"
                    type="text"
                    required
                    {...form.register("partitionSettings.yearColumn")}
                  />
                  <Field
                    label="Month column"
                    type="text"
                    required
                    {...form.register("partitionSettings.monthColumn")}
                  />
                  <Field
                    label="Date column"
                    type="text"
                    required
                    {...form.register("partitionSettings.dateColumn")}
                  />
                </div>
              ) : null}
            </>
          }
        </div>
      ) : null}
    </Modal>
  );
};
