import { FC } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { DimensionInterface } from "back-end/types/dimension";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";

const DimensionForm: FC<{
  close: () => void;
  current: Partial<DimensionInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const {
    getDatasourceById,
    datasources,
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

  const datasource = form.watch("datasource");
  const userIdType = form.watch("userIdType");

  const dsObj = getDatasourceById(datasource);
  const dsProps = dsObj?.properties;
  const sql = dsProps?.queryLanguage === "sql";

  return (
    <Modal
      close={close}
      open={true}
      header={current ? "Edit Dimension" : "New Dimension"}
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
        if (sql && !value.sql.toLowerCase().includes("value")) {
          throw new Error("Must select a column named 'value'");
        }

        await apiCall(
          current.id ? `/dimensions/${current.id}` : `/dimensions`,
          {
            method: current.id ? "PUT" : "POST",
            body: JSON.stringify(value),
          }
        );
        mutateDefinitions();
      })}
    >
      <Field label="Name" required {...form.register("name")} />
      <SelectField
        label="Data Source"
        required
        value={form.watch("datasource")}
        onChange={(v) => form.setValue("datasource", v)}
        placeholder="Choose one..."
        options={datasources.map((d) => ({
          value: d.id,
          label: d.name,
        }))}
      />
      {dsProps.userIds && (
        <SelectField
          label="Identifier Type"
          required
          value={userIdType}
          onChange={(v) => form.setValue("userIdType", v)}
          options={(dsObj.settings.userIdTypes || []).map((t) => {
            return {
              label: t.userIdType,
              value: t.userIdType,
            };
          })}
        />
      )}
      {sql ? (
        <Field
          label="SQL"
          required
          sqltextarea
          value={form.watch("sql")}
          setValue={(sql) => form.setValue("sql", sql)}
          placeholder={`SELECT ${userIdType}, browser as value FROM users`}
          helpText={
            <>
              Select two columns named <code>{userIdType}</code> and{" "}
              <code>value</code>
            </>
          }
        />
      ) : (
        <Field
          label="Event Condition"
          required
          {...form.register("sql")}
          textarea
          minRows={3}
          placeholder={"$browser"}
        />
      )}
      <p>
        <strong>Important:</strong> Please limit dimensions to at most 50 unique
        values.
      </p>
    </Modal>
  );
};
export default DimensionForm;
