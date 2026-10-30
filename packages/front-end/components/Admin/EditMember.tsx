import { FC, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ExpandedMember } from "shared/types/organization";
import { UserInterface } from "shared/types/user";
import {
  SUPER_ADMIN_PERMISSIONS,
  SuperAdmin,
  SuperAdminPermission,
} from "shared/validators";
import {
  canChangeSuperAdmin,
  hasSuperAdminPermission,
  holdsAllSuperAdminPermissions,
  normalizeSuperAdmin,
} from "shared/permissions";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export type AdminMember = ExpandedMember &
  Pick<UserInterface, "superAdmin" | "authSubject">;

const SUPER_ADMIN_PERMISSION_LABELS: Record<SuperAdminPermission, string> = {
  view: "View the admin page",
  impersonate: "Impersonate organizations",
  sso: "Manage SSO and email domain auto-join",
  billing: "Manage license keys and billing",
  messages: "Manage organization messages",
  provision: "Provision Managed Warehouses and event forwarders",
  metadata: "Edit organization details",
  suspend: "Suspend and disable organizations",
  create: "Create organizations",
  users: "Edit user names and login methods",
  grant: "Grant super admin access",
};

export function formatSuperAdmin(superAdmin: SuperAdmin | undefined) {
  const normalized = normalizeSuperAdmin(superAdmin);
  if (normalized === true) return "Full access";
  return normalized ? normalized.join(", ") : "-";
}

const EditMember: FC<{
  onEdit: () => void;
  close: () => void;
  member: AdminMember;
}> = ({ onEdit, close, member }) => {
  const [verified, setVerified] = useState(member.verified);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [resetAuthSubject, setResetAuthSubject] = useState(false);
  const [memberSuperAdmin, setMemberSuperAdmin] = useState<SuperAdmin>(
    normalizeSuperAdmin(member.superAdmin),
  );

  const { apiCall } = useAuth();
  const { superAdmin, userId } = useUser();

  // Mirrors the server checks in _dangerousAdminPutMember
  const canEditDetails =
    hasSuperAdminPermission(superAdmin, "users") &&
    holdsAllSuperAdminPermissions(superAdmin, member.superAdmin);
  const canGrant = hasSuperAdminPermission(superAdmin, "grant");
  const isSelf = member.id === userId;
  const canSet = (next: SuperAdmin) =>
    !isSelf && canChangeSuperAdmin(superAdmin, member.superAdmin, next);
  const selfMessage = isSelf
    ? "You cannot change your own super admin access"
    : undefined;
  const grantedList = Array.isArray(memberSuperAdmin) ? memberSuperAdmin : [];

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/member", {
      method: "PUT",
      body: JSON.stringify({
        userId: member.id,
        verified: verified,
        email: email,
        name: name,
        ...(resetAuthSubject ? { resetAuthSubject: true } : {}),
        ...(canGrant && !isSelf ? { superAdmin: memberSuperAdmin } : {}),
      }),
    });
    onEdit();
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header="Edit Member"
      cta="Update"
      close={close}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Name"
          value={name}
          required
          minLength={3}
          disabled={!canEditDetails}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          required
          disabled={superAdmin !== true}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Checkbox
          id="verified"
          label="Verified email"
          value={verified}
          setValue={setVerified}
          disabled={!canEditDetails || (member.verified && superAdmin !== true)}
          disabledMessage={
            canEditDetails
              ? "Only full super admins can clear a verified email"
              : undefined
          }
        />
        {member.authSubject && (
          <>
            <TextField
              label="Sign-in identity"
              value={member.authSubject}
              readOnly
            />
            <Checkbox
              id="reset-auth-subject"
              label="Reset sign-in identity"
              value={resetAuthSubject}
              setValue={setResetAuthSubject}
              disabled={!canEditDetails}
            />
          </>
        )}
        {canGrant && (
          <Flex direction="column" gap="3" mt="2">
            <Text weight="semibold">Super admin access</Text>
            <Checkbox
              id="super-admin-full"
              label="Full access"
              weight="bold"
              value={memberSuperAdmin === true}
              disabled={!canSet(memberSuperAdmin === true ? false : true)}
              disabledMessage={
                selfMessage ?? "Only full super admins can change this"
              }
              setValue={(v) => setMemberSuperAdmin(v)}
            />
            <Flex direction="column" gap="2" pl="5">
              {SUPER_ADMIN_PERMISSIONS.map((p) => {
                const next = normalizeSuperAdmin(
                  grantedList.includes(p)
                    ? grantedList.filter((g) => g !== p)
                    : [...grantedList, p],
                );
                // View comes with any other permission, so show it as granted
                const included =
                  memberSuperAdmin === true ||
                  (p === "view" && grantedList.some((g) => g !== "view"));
                return (
                  <Checkbox
                    key={p}
                    id={`super-admin-${p}`}
                    label={SUPER_ADMIN_PERMISSION_LABELS[p]}
                    weight="regular"
                    value={included || grantedList.includes(p)}
                    disabled={included || !canSet(next)}
                    disabledMessage={
                      selfMessage ??
                      (memberSuperAdmin === true
                        ? "Included in full access"
                        : included
                          ? "Included with any other permission"
                          : "You don't have permission to change this")
                    }
                    setValue={() => setMemberSuperAdmin(next)}
                  />
                );
              })}
            </Flex>
          </Flex>
        )}
      </Flex>
    </ModalStandard>
  );
};

export default EditMember;
