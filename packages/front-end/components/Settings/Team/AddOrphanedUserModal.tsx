import { FC, useState } from "react";
import { MemberRoleWithProjects } from "back-end/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import useOrgSettings from "@/hooks/useOrgSettings";
import UpgradeModal from "../UpgradeModal";
import RoleSelector from "./RoleSelector";

const AddOrphanedUserModal: FC<{
  mutate: () => void;
  close: () => void;
  name: string;
  email: string;
  id: string;
}> = ({ mutate, close, name, email, id }) => {
  const { defaultRole } = useOrgSettings();

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
