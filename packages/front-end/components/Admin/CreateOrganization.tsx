import { useState, FC } from "react";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

const CreateOrganization: FC<{
  onCreate: () => void;
  close: () => void;
  showExternalId?: boolean;
}> = ({ onCreate, close, showExternalId }) => {
  const [company, setCompany] = useState("");
  const [externalId, setExternalId] = useState("");

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
      orgId?: string;
    }>("/organization", {
      method: "POST",
      body: JSON.stringify({
        company,
        externalId,
      }),
    });
    onCreate();
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header={"Create New Organization"}
      cta={"Create"}
      close={close}
    >
      <div className="form-group">
        Company Name
        <input
          type="text"
          className="form-control"
          value={company}
          required
          minLength={3}
          onChange={(e) => setCompany(e.target.value)}
        />
        {showExternalId && (
          <div className="mt-3">
            External Id: Id used for the organization within your company
            (optional)
            <input
              type="text"
              className="form-control"
              value={externalId}
              minLength={3}
              onChange={(e) => setExternalId(e.target.value)}
            />
          </div>
        )}
      </div>
    </ModalStandard>
  );
};

export default CreateOrganization;
