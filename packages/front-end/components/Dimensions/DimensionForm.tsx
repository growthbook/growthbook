import { FC } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import TextareaAutosize from "react-textarea-autosize";
import { useAuth } from "../../services/auth";
import { DimensionInterface } from "back-end/types/dimension";
import { useDefinitions } from "../../services/DefinitionsContext";

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

  const dsType = getDatasourceById(datasource)?.type || null;

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
      <div className="form-group">
        Name
        <input
          type="text"
          required
          className="form-control"
          {...form.register("name")}
        />
      </div>
      <div className="form-group">
        Data Source
        <select
          className="form-control"
          required
          {...form.register("datasource")}
        >
          <option value="">Choose one...</option>
          {datasources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        {dsType === "mixpanel" ? "Event Property" : "SQL"}
        <TextareaAutosize
          className="form-control"
          required
          {...form.register("sql")}
          minRows={3}
          placeholder={
            dsType === "mixpanel"
              ? "$browser"
              : "SELECT user_id, browser as value FROM users"
          }
        />
        {dsType !== "mixpanel" && (
          <small className="form-text text-muted">
            Select two columns named <code>user_id</code> and <code>value</code>
          </small>
        )}
      </div>
      <p>
        <strong>Important:</strong> Please limit dimensions to at most 50 unique
        values.
      </p>
    </Modal>
  );
};
export default DimensionForm;
