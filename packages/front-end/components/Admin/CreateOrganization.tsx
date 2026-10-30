import { useState, FC } from "react";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import TextField from "@/ui/TextField";
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
      header="Create Organization"
      cta="Create"
      close={close}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Name"
          value={company}
          required
          minLength={3}
          onChange={(e) => setCompany(e.target.value)}
        />
        {showExternalId && (
          <TextField
            label="External ID"
            value={externalId}
            minLength={3}
            helpText="Identifies the organization within your company. Optional."
            onChange={(e) => setExternalId(e.target.value)}
          />
        )}
      </Flex>
    </ModalStandard>
  );
};

export default CreateOrganization;
