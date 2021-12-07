import { FC } from "react";
import Modal from "../Modal";
import { SegmentInterface } from "back-end/types/segment";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";

const SegmentForm: FC<{
  close: () => void;
  current: Partial<SegmentInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const {
    datasources,
    getDatasourceById,
    mutateDefinitions,
  } = useDefinitions();
  const form = useForm({
    defaultValues: {
      name: current.name || "",
      sql: current.sql || "",
      datasource: (current.id ? current.datasource : datasources[0]?.id) || "",
    },
  });
  const filteredDatasources = datasources.filter((d) => d.properties?.segments);

  const datasource = getDatasourceById(form.watch("datasource"));

  return (
    <Modal
      close={close}
      open={true}
      header={current ? "Edit Segment" : "New Segment"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(current.id ? `/segments/${current.id}` : `/segments`, {
          method: current.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        mutateDefinitions({});
      })}
    >
      <Field label="Name" required {...form.register("name")} />
      <SelectField
        label="Data Source"
        required
        value={form.watch("datasource")}
        onChange={(v) => form.setValue("datasource", v)}
        placeholder="Choose one..."
        options={filteredDatasources.map((d) => ({
          value: d.id,
          label: d.name,
        }))}
      />
      <Field
        label={datasource?.properties?.events ? "Event Condition" : "SQL"}
        required
        textarea
        {...form.register("sql")}
        placeholder={
          datasource?.properties?.events
            ? "event.properties.$browser === 'Chrome'"
            : "SELECT user_id, date FROM mytable"
        }
        helpText={
          datasource?.properties?.events ? (
            <>
              Javascript condition used to filter events. Has access to an{" "}
              <code>event</code> variable.
            </>
          ) : (
            <>
              Select two columns named <code>user_id</code> and{" "}
              <code>date</code>
            </>
          )
        }
      />
    </Modal>
  );
};
export default SegmentForm;
