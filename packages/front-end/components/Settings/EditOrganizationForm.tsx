import { FC } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";

const EditOrganizationForm: FC<{
  name: string;
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate, name }) => {
  const { apiCall, setOrgName } = useAuth();

  const [value, inputProps] = useForm({
    name,
  });

  return (
    <Modal
      header="Edit Organization Name"
      open={true}
      close={close}
      submit={async () => {
        await apiCall("/organization", {
          method: "PUT",
          body: JSON.stringify(value),
        });
        // Update org name in global context (e.g. top nav)
        setOrgName(value.name);
        // Update org name on settings page
        await mutate();
      }}
      cta="Save"
    >
      <div className="form-group">
        <label>Organization Name</label>
        <input
          type="text"
          className="form-control"
          required
          {...inputProps.name}
        />
      </div>
    </Modal>
  );
};
export default EditOrganizationForm;
