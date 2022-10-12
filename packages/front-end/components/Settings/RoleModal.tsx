import {
  EnvPermission,
  Permission,
  Permissions,
} from "back-end/types/permissions";
import React, { useState } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import useOrgSettings from "../../hooks/useOrgSettings";
import {
  DEFAULT_PERMISSIONS,
  ENV_PERMISSIONS,
  PERMISSIONS,
  isEnvPermission,
  getEnvPermissionBase,
  getEnvFromPermission,
} from "../../hooks/usePermissions";
import { FormRole } from "./TeamRoles";
import CheckBoxField from "../Forms/CheckBoxField";

interface RoleModalProps {
  type: "create" | "update";
  role: FormRole;
  close: () => void;
  mutate: () => void;
}

export default function RoleModal({
  type,
  role,
  close,
  mutate,
}: RoleModalProps) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const [roleId, setRoleId] = useState(role.id);
  const [roleDescription, setRoleDescription] = useState(role.description);

  const defaultValues: Record<Permission, boolean> = {} as Record<
    Permission,
    boolean
  >;

  // Positions form elements in correct order
  Object.keys(DEFAULT_PERMISSIONS).forEach((p) => {
    defaultValues[p] = role.permissions.includes(p as Permission);

    //Checks if the permission is an environment permission, if so it adds the environments to the defaultValues
    if (ENV_PERMISSIONS.find((ep) => ep === p)) {
      settings.environments.forEach((e) => {
        defaultValues[`${p}_${e.id}`] = role.permissions.includes(
          `${p as EnvPermission}_${e.id}`
        );
      });
    }
  });

  const form = useForm({ defaultValues: { ...defaultValues } });

  // Environment permissions are dropdowns that only show if the base permission is false.
  // We need to watch the base permission to show/hide the dropdowns
  form.watch(ENV_PERMISSIONS);

  async function handleSubmit(data: { [x: string]: boolean | string }) {
    if (!roleId.match(/^[a-zA-Z0-9-_ ]+$/))
      throw new Error(
        "Role ID must be alphanumeric (dashes, underscores, and spaces are allowed)"
      );

    if (roleDescription && !roleDescription.match(/^[a-zA-Z0-9-_ ]+$/))
      throw new Error(
        "Role description must be alphanumeric (dashes, underscores, and spaces are allowed)"
      );

    const permissions: Permissions = [];
    Object.keys(data).forEach((key) => {
      if (data[key]) permissions.push(key as Permission);
    });

    if (type === "create") {
      await apiCall(`/roles/${roleId}`, {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          description: roleDescription,
          permissions,
        }),
      });
      mutate();
    } else {
      await apiCall(`/roles/${role.id}`, {
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({
          description: roleDescription,
          permissions,
          newRoleId: roleId,
        }),
      });
      mutate();
    }

    close();
  }

  return (
    <Modal
      close={close}
      header={type === "update" ? `Update Role '${role.id}'` : `Create Role`}
      open={true}
      autoCloseOnSubmit={false}
      successMessage={type === "update" ? "Role updated" : "Role created"}
      cta={type === "update" ? "Update Role" : "Create Role"}
      submit={form.handleSubmit(async (data) => {
        await handleSubmit(data);
      })}
    >
      <div className="form-group">
        <label htmlFor="role-name">Role name:</label>
        <input
          id="role-name"
          type="text"
          className={"form-control"}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor="role-description">Role description:</label>
        <input
          id="role-description"
          type="text"
          className={"form-control"}
          value={roleDescription}
          onChange={(e) => setRoleDescription(e.target.value)}
        />
      </div>
      {Object.keys(defaultValues).map((p) => {
        let envName = "";
        if (isEnvPermission(p)) {
          //If the base permission is set to true, don't show the environment permissions
          if (form.getValues()[getEnvPermissionBase(p)]) return null;

          envName = getEnvFromPermission(p);
        }

        return (
          <>
            {PERMISSIONS[p]?.title && <h4>{PERMISSIONS[p].title}</h4>}
            <CheckBoxField
              key={p}
              id={`role-${p}`}
              tooltip={PERMISSIONS[p]?.description || ""}
              label={isEnvPermission(p) ? envName : PERMISSIONS[p]?.displayName}
              labelClassName="mx-2"
              containerClassName={`my-1 ${isEnvPermission(p) ? "ml-4" : ""}`}
              {...form.register(p as Permission)}
            />
          </>
        );
      })}
    </Modal>
  );
}
