import { ReactElement, useContext } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import track from "../../services/track";
import Modal from "../Modal";
import { UserContext } from "../ProtectedPage";

export default function CreateOrganization(): ReactElement {
  const [value, inputProps] = useForm({
    company: "",
  });

  const { apiCall } = useAuth();
  const { update } = useContext(UserContext);

  return (
    <Modal
      header={
        <img
          alt="Growth Book"
          src="/logo/growthbook-logo.png"
          style={{ height: 40 }}
        />
      }
      solidOverlay={true}
      open={true}
      submit={async () => {
        await apiCall("/organization", {
          method: "POST",
          body: JSON.stringify({
            company: value.company,
          }),
        });
        track("Create Organization");
        update();
      }}
      cta={"Submit"}
    >
      <h3>Create Organization</h3>
      <p>
        It looks like you aren&apos;t part of an organization yet. Create a new
        one below.
      </p>

      <div className="form-group">
        Company Name
        <input
          required
          minLength={3}
          type="text"
          {...inputProps.company}
          className="form-control"
        />
      </div>
    </Modal>
  );
}
