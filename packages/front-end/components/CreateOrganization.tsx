import { useState, FC } from "react";
import { useAuth } from "../services/auth";
import Modal from "./Modal";

const CreateOrganization: FC<{
  onCreate: () => void;
  close?: () => void;
  isAdmin?: boolean;
}> = ({ onCreate, close, isAdmin }) => {
  const [company, setCompany] = useState("");

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
      }),
    });
    onCreate();
  };

  return (
    <Modal
      submit={handleSubmit}
      open={true}
      header={
        isAdmin ? (
          "Create New Organization"
        ) : (
          <img
            alt="Growth Book"
            src="/logo/growthbook-logo.png"
            style={{ height: 40 }}
          />
        )
      }
      cta={"Create"}
      close={close}
      inline={!close}
    >
      {!isAdmin && (
        <p className="text-muted">
          It looks like you don&apos;t belong to an organization yet. Create one
          below.
        </p>
      )}
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
      </div>
    </Modal>
  );
};

export default CreateOrganization;
