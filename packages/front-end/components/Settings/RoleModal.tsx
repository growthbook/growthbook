import { Permission, Permissions } from "back-end/types/permissions";
import { permissionsList, envLevelPermissions } from "shared";
import React, { useState } from "react";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import useOrgSettings from "../../hooks/useOrgSettings";
import { MemberInfo } from "./MemberList";

const permissionDescritpions: Record<Permission, string> = {
  addComments: "",
  createPresentations: "",
  createIdeas: "",
  createFeatures: "",
  createFeatureDrafts: "",
  createAnalyses: "",
  createMetrics: "",
  createDimensions: "",
  createSegments: "",
  createDatasources: "",
  editDatasourceSettings: "",
  organizationSettings:
    "Allows member to edit organization settings (e.g. team roles). Essentially the same as being an admin.",
  publishFeatures:
    "Allows member to publish features. Filterable by environment if set to false.",
  runQueries: "",
  superDelete:
    "Allows member to delete reports created by anyone in the organization.",
};

interface RoleModalProps {
  type: "create" | "update";
  role: {
    name: string;
    rolePermissions: Permissions;
    members: MemberInfo[];
  };
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
  const [roleName, setRoleName] = useState("");

  const defaultValues: Record<string, boolean | string> = {};
  permissionsList.forEach((p) => {
    defaultValues[p] = role.rolePermissions.includes(p);
  });

  settings.environments.forEach((e) => {
    envLevelPermissions.forEach(
      (p) =>
        (defaultValues[`${p}_${e.id}`] = role.rolePermissions.includes(
          `${p}_${e.id}`
        ))
    );
  });

  const form = useForm({ defaultValues: { ...defaultValues } });
  form.watch(envLevelPermissions);

  async function handleSubmit(data: { [x: string]: boolean | string }) {
    const permissions: Permissions = [];
    Object.keys(data).forEach((key) => {
      if (data[key]) permissions.push(key as Permission);
    });

    if (type === "create") {
      await apiCall(`/roles/${roleName}`, {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          permissions,
        }),
      });
      mutate();
    } else {
      await apiCall(`/roles/${role.name}`, {
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({
          permissions,
        }),
      });
      mutate();
    }

    close();
  }

  return (
    <Modal
      close={close}
      header={type === "update" ? "Update Role" : "Create Role"}
      open={true}
      autoCloseOnSubmit={false}
      successMessage={type === "update" ? "Role updated" : "Role created"}
      cta={type === "update" ? "Update Role" : "Create Role"}
      submit={form.handleSubmit(async (data) => {
        await handleSubmit(data);
      })}
    >
      {type === "update" && (
        <p>
          Editing role <strong>{role.name}</strong>
        </p>
      )}
      {type === "create" && (
        <div className="form-group">
          <label htmlFor="role-name">Role name:</label>
          <input
            id="role-name"
            type="text"
            className={"form-control"}
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
          />
        </div>
      )}
      {Object.keys(defaultValues)
        .filter((p) => p !== "name")
        .sort((a, b) => a.localeCompare(b))
        .map((permission) => {
          if (permission.includes("_")) {
            const basePermission = permission.split("_")[0];
            if (form.getValues()[basePermission]) {
              return null;
            }
          }

          return (
            <Field
              checkBox
              key={permission}
              tooltip={permissionDescritpions[permission as Permission]}
              label={permission}
              labelClassName="mx-2"
              containerClassName={permission.includes("_") ? "ml-4" : ""}
              {...form.register(permission)}
            />
          );
        })}
    </Modal>
  );
}
