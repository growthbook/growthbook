import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { getRoles } from "shared/permissions";
import { MemberRoleWithProjects } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import RoleSelector from "@/components/Settings/Team/RoleSelector";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  personalAccessToken: boolean;
  defaultDescription?: string;
}> = ({ close, personalAccessToken, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const { organization } = useUser();

  const defaultRole = useMemo(() => {
    const deactivated = new Set(organization.deactivatedRoles ?? []);
    const roles = getRoles(organization);
    return (
      roles.find((r) => r.id !== "noaccess" && !deactivated.has(r.id))?.id ??
      "readonly"
    );
  }, [organization]);

  const form = useForm<{
    description: string;
  }>({
    defaultValues: {
      description: defaultDescription,
    },
  });

  const [roleState, setRoleState] = useState<MemberRoleWithProjects>({
    role: defaultRole,
    limitAccessByEnvironment: false,
    environments: [],
  });

  const onSubmit = form.handleSubmit(async (value) => {
    const { role, ...roleStateData } = roleState;
    const key = personalAccessToken
      ? {
          description: value.description,
          type: "user",
        }
      : {
          description: value.description,
          type: role,
          ...roleStateData,
        };
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(key),
    });
    track("Create API Key", {
      isSecret: !personalAccessToken,
    });
    onCreate();
  });

  return (
    <Modal
      trackingEventModalType=""
      close={close}
      header={"Create API Key"}
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <Field
        label="Description"
        required={true}
        {...form.register("description")}
      />
      {!personalAccessToken && (
        <RoleSelector value={roleState} setValue={setRoleState} />
      )}
    </Modal>
  );
};

export default ApiKeysModal;
