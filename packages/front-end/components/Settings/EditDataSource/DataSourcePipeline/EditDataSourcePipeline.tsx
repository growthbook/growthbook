import { FC } from "react";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";
import Field from "@/components/Forms/Field";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Tooltip from "@/components/Tooltip/Tooltip";
import { dataSourcePathNames } from "./DataSourcePipeline";

type EditDataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

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

  const form = useForm({
    defaultValues: {
      allowWriting: dataSource.settings.pipelineSettings?.allowWriting ?? false,
      writeDatabase: dataSource.settings.pipelineSettings?.writeDatabase ?? "",
      writeDataset: dataSource.settings.pipelineSettings?.writeDataset ?? "",
      unitsTableRetentionHours:
        dataSource.settings.pipelineSettings?.unitsTableRetentionHours ?? 24,
      unitsTableDeletion:
        dataSource.settings.pipelineSettings?.unitsTableDeletion ?? true,
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    copy.settings.pipelineSettings = value;
    await onSave(copy);
  });

  return (
    <Modal
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
          <label>
            {`Destination ${pathNames.databaseName} (optional)`}{" "}
            <Tooltip
              body={`If left blank will try to write to default ${pathNames.databaseName}`}
            />
          </label>
          <Field
            label={`Destination ${pathNames.schemaName} with write permissions`}
            className="ml-2"
            containerClassName="mb-2"
            type="text"
            {...form.register("writeDatabase")}
          />
          <label>{`Destination ${pathNames.schemaName}`} </label>
          <Field
            className="ml-2"
            containerClassName="mb-2"
            type="text"
            required
            {...form.register("writeDataset")}
          />
          {`Destination ${pathNames.databaseName} (optional)`}{" "}
          <Field
            label="Retention of temporary units table (hours)"
            helpText={
              dataSource.type === "snowflake"
                ? "Rounded up to nearest day for Snowflake"
                : ""
            }
            className="ml-2"
            containerClassName="mb-2"
            type="number"
            min={1}
            {...form.register("unitsTableRetentionHours")}
          />
        </div>
      ) : null}
    </Modal>
  );
};
