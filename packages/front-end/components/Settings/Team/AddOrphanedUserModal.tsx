import { FC, useState } from "react";
import { MemberRoleWithProjects } from "back-end/types/organization";
import { useAuth } from "@front-end/services/auth";
import Modal from "@front-end/components/Modal";
import useOrgSettings from "@front-end/hooks/useOrgSettings";
import UpgradeModal from "@front-end/components/Settings/UpgradeModal";
import { useUser } from "@front-end/services/UserContext";
import RoleSelector from "./RoleSelector";

const AddOrphanedUserModal: FC<{
  mutate: () => void;
  close: () => void;
  name: string;
  email: string;
  id: string;
}> = ({ mutate, close, name, email, id }) => {
  const { defaultRole } = useOrgSettings();
  const { license, seatsInUse } = useUser();

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [value, setValue] = useState<MemberRoleWithProjects>({
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: [],
    ...defaultRole,
  });

  const { apiCall } = useAuth();

  if (showUpgradeModal) {
    return (
      <UpgradeModal
        close={close}
        source="add orphaned user"
        reason={"To enable advanced permissioning,"}
      />
    );
  }

  // Hit a hard cap and needs to contact sales to increase the number of seats on their license
  if (license && license.hardCap && license.seats < seatsInUse + 1) {
    return (
      <Modal open={true} close={close} size="md" header={"Reached seat limit"}>
        <div className="my-3">
          Whoops! You reached the seat limit on your license. To increase your
          number of seats, please contact{" "}
          <a href="mailto:sales@growthbook.io" target="_blank" rel="noreferrer">
            sales@growthbook.io
          </a>
          .
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      close={close}
      header="Add User"
      open={true}
      cta="Add"
      closeCta={"Cancel"}
      submit={async () => {
        await apiCall<{
          emailSent: boolean;
          inviteUrl: string;
          status: number;
          message?: string;
        }>(`/orphaned-users/${id}/add`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      }}
    >
      <div className="mb-3">
        <strong>{name}</strong> ({email})
      </div>
      <RoleSelector
        value={value}
        setValue={setValue}
        showUpgradeModal={() => setShowUpgradeModal(true)}
      />
    </Modal>
  );
};

export default AddOrphanedUserModal;
