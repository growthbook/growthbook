import { FC } from "react";
import { useForm } from "react-hook-form";
import {
  DataSourceEvents,
  DataSourceInterfaceWithParams,
} from "back-end/types/datasource";
import Field from "../../../Forms/Field";
import Modal from "../../../Modal";

type DataSourceEditExperimentPropertiesProps = {
  dataSource: DataSourceInterfaceWithParams;
  onSave: (experimentProps: DataSourceEvents) => void;
  onCancel: () => void;
};

export const DataSourceEditExperimentPropertiesModal: FC<DataSourceEditExperimentPropertiesProps> = ({
  dataSource,
  onCancel,
  onSave,
}) => {
  const form = useForm<DataSourceEvents>({
    defaultValues: {
      experimentEvent: dataSource.settings?.events?.experimentEvent || "",
      experimentIdProperty:
        dataSource.settings?.events?.experimentIdProperty || "",
      variationIdProperty:
        dataSource.settings?.events?.variationIdProperty || "",
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    onSave(value);

    form.reset({
      experimentEvent: "",
      experimentIdProperty: "",
      variationIdProperty: "",
    });
  });

  const dataSourceEvents = dataSource.settings.events;
  if (!dataSourceEvents) {
    console.error(
      "ImplementationError: dataSource.settings.events cannot be null"
    );
    return null;
  }

  const saveEnabled = !!(
    form.watch("experimentEvent") &&
    form.watch("experimentIdProperty") &&
    form.watch("variationIdProperty")
  );

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="md"
      header="Edit Query Settings"
      cta="Save"
      ctaEnabled={saveEnabled}
      autoFocusSelector="#id-modal-identify-joins-heading"
    >
      <div className="my-2">
        <div className="row">
          <div className="col">
            {dataSourceEvents && (
              <div className="">
                <h4 className="font-weight-bold">Experiments</h4>
                <Field
                  label="View Experiment Event"
                  placeholder="$experiment_started"
                  {...form.register("experimentEvent")}
                />
                <Field
                  label="Experiment Id Property"
                  placeholder="Experiment name"
                  {...form.register("experimentIdProperty")}
                />
                <Field
                  label="Variation Id Property"
                  placeholder="Variant name"
                  {...form.register("variationIdProperty")}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
