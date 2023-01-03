import { FC } from "react";
import { useForm } from "react-hook-form";
import {
  DataSourceEvents,
  DataSourceInterfaceWithParams,
} from "back-end/types/datasource";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";

type DataSourceEditExperimentEventPropertiesProps = {
  dataSource: DataSourceInterfaceWithParams;
  onSave: (experimentProps: DataSourceEvents) => Promise<void>;
  onCancel: () => void;
};

export const DataSourceEditExperimentEventPropertiesModal: FC<DataSourceEditExperimentEventPropertiesProps> = ({
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
      extraUserIdProperty:
        dataSource.settings?.events?.extraUserIdProperty || "",
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      experimentEvent: "",
      experimentIdProperty: "",
      variationIdProperty: "",
      extraUserIdProperty: "",
    });
  });

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
              <Field
                label="Extra UserId Property (optional)"
                placeholder=""
                {...form.register("extraUserIdProperty")}
                helpText={
                  <>
                    Will be added to the groupBy along with{" "}
                    <code>distinct_id</code>.
                  </>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
