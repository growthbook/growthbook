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
      userIdType: current.userIdType || "user_id",
    },
  });
  const filteredDatasources = datasources.filter((d) => d.properties?.segments);

  const userIdType = form.watch("userIdType");

  const datasource = getDatasourceById(form.watch("datasource"));
  const dsProps = datasource?.properties;
  const sql = dsProps?.queryLanguage === "sql";

  return (
    <Modal
      close={close}
      open={true}
      header={current ? "Edit Segment" : "New Segment"}
      submit={form.handleSubmit(async (value) => {
        if (sql && !value.sql.toLowerCase().includes("select")) {
          throw new Error(`Invalid SELECT statement`);
        }
        if (
          sql &&
          !value.sql.toLowerCase().includes(value.userIdType.toLowerCase())
        ) {
          throw new Error(`Must select a column named '${value.userIdType}'`);
        }
        if (sql && !value.sql.toLowerCase().includes("date")) {
          throw new Error("Must select a column named 'date'");
        }

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
      {datasource.properties.userIds && (
        <SelectField
          label="User Id Type"
          required
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
      <Field
        label={sql ? "SQL" : "Event Condition"}
        required
        textarea
        {...form.register("sql")}
        placeholder={
          sql
            ? `SELECT ${userIdType}, date FROM mytable`
            : "event.properties.$browser === 'Chrome'"
        }
        helpText={
          sql ? (
            <>
              Select two columns named <code>{userIdType}</code> and{" "}
              <code>date</code>
            </>
          ) : (
            <>
              Javascript condition used to filter events. Has access to an{" "}
              <code>event</code> variable.
            </>
          )
        }
      />
    </Modal>
  );
};
export default SegmentForm;
