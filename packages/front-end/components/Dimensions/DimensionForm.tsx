import { FC } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { DimensionInterface } from "back-end/types/dimension";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

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
    },
  });

  const datasource = form.watch("datasource");

  const dsProps = getDatasourceById(datasource)?.properties;

  return (
    <Modal
      close={close}
      open={true}
      header={current ? "Edit Dimension" : "New Dimension"}
      submit={form.handleSubmit(async (value) => {
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
      <Field
        label="Data Source"
        required
        {...form.register("datasource")}
        initialOption="Choose one..."
        options={datasources.map((d) => ({ value: d.id, display: d.name }))}
      />
      <Field
        label={dsProps?.events ? "Event Property" : "SQL"}
        required
        {...form.register("sql")}
        textarea
        minRows={3}
        placeholder={
          dsProps?.events
            ? "$browser"
            : "SELECT user_id, browser as value FROM users"
        }
        helpText={
          dsProps?.queryLanguage === "sql" ? (
            <>
              Select two columns named <code>user_id</code> and{" "}
              <code>value</code>
            </>
          ) : null
        }
      />
      <p>
        <strong>Important:</strong> Please limit dimensions to at most 50 unique
        values.
      </p>
    </Modal>
  );
};
export default DimensionForm;
