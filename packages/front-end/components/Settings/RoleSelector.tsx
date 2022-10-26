import { FC, ReactNode, useState } from "react";
import {
  MemberRole,
  MemberRoleInfo,
  MemberRoleWithProjects,
} from "back-end/types/organization";
import { useUser } from "../../services/UserContext";
import { useEnvironments } from "../../services/features";
import MultiSelectField from "../Forms/MultiSelectField";
import { isCloud } from "../../services/env";
import Toggle from "../Forms/Toggle";
import SelectField from "../Forms/SelectField";
import RoleDisplay from "./RoleDisplay";
import { roleSupportsEnvLimit } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import cloneDeep from "lodash/cloneDeep";

function SingleRoleSelector({
  value,
  setValue,
  label,
  includeAdminRole = false,
}: {
  value: MemberRoleInfo;
  setValue: (value: MemberRoleInfo) => void;
  label: ReactNode;
  includeAdminRole?: boolean;
}) {
  const { roles } = useUser();

  const availableEnvs = useEnvironments();

  const { hasCommercialFeature } = useUser();

  const canUseAdvancedPermissions = hasCommercialFeature(
    "advanced-permissions"
  );

  const limitEnvAccess =
    canUseAdvancedPermissions && value.limitAccessByEnvironment;

  return (
    <div>
      <SelectField
        label={label}
        value={value.role}
        onChange={(role: MemberRole) => {
          setValue({
            ...value,
            role,
          });
        }}
        options={roles
          .filter((r) => includeAdminRole || r.id !== "admin")
          .map((r) => ({
            label: r.id,
            value: r.id,
          }))}
        sort={false}
        formatOptionLabel={(value) => {
          const r = roles.find((r) => r.id === value.label);
          return (
            <div>
              <RoleDisplay role={r.id} />
              <small className="ml-2">
                <em>{r.description}</em>
              </small>
            </div>
          );
        }}
      />

      {roleSupportsEnvLimit(value.role) && (
        <div>
          <div className="form-group">
            <Toggle
              disabled={!canUseAdvancedPermissions}
              id={"role-modal"}
              value={limitEnvAccess}
              setValue={(limitAccessByEnvironment) => {
                setValue({
                  ...value,
                  limitAccessByEnvironment,
                });
              }}
              disabledMessage="Upgrade to limit access by environment"
            />{" "}
            Restrict Access to Specific Environments
          </div>
          {canUseAdvancedPermissions && (
            <>
              {limitEnvAccess && (
                <MultiSelectField
                  label="Environments"
                  helpText="Select all environments you want the person to have permissions for"
                  value={value.environments}
                  onChange={(environments) => {
                    setValue({
                      ...value,
                      environments,
                    });
                  }}
                  options={availableEnvs.map((env) => ({
                    label: env.id,
                    value: env.id,
                    tooltip: env.description,
                  }))}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const RoleSelector: FC<{
  value: MemberRoleWithProjects;
  setValue: (value: MemberRoleWithProjects) => void;
  showUpgradeModal?: () => void;
}> = ({ value, setValue, showUpgradeModal }) => {
  const { hasCommercialFeature, settings } = useUser();
  const { projects, getProjectById } = useDefinitions();

  const canUseAdvancedPermissions = hasCommercialFeature(
    "advanced-permissions"
  );
  const projectRoles = value.projectRoles || [];

  const usedProjectIds = projectRoles.map((r) => r.project) || [];
  const unusedProjects = projects.filter((p) => !usedProjectIds.includes(p.id));

  const [newProject, setNewProject] = useState("");

  return (
    <div>
      <SingleRoleSelector
        value={{
          role: value.role,
          environments: value.environments,
          limitAccessByEnvironment: value.limitAccessByEnvironment,
        }}
        setValue={(newRoleInfo) => {
          setValue({
            ...value,
            ...newRoleInfo,
          });
        }}
        label="Global Role"
        includeAdminRole={true}
      />

      {canUseAdvancedPermissions && projects?.length > 0 && (
        <>
          <div className="text-muted mb-2">Project Roles (optional)</div>
          {projectRoles.map((projectRole, i) => (
            <div className="appbox px-3 pt-3 bg-light" key={i}>
              <div style={{ float: "right" }}>
                <a
                  href="#"
                  className="text-danger"
                  onClick={(e) => {
                    e.preventDefault();
                    const newProjectRoles = [...projectRoles];
                    newProjectRoles.splice(i, 1);
                    setValue({
                      ...value,
                      projectRoles: newProjectRoles,
                    });
                  }}
                >
                  remove
                </a>
              </div>
              <SingleRoleSelector
                value={{
                  role: projectRole.role,
                  environments: projectRole.environments,
                  limitAccessByEnvironment:
                    projectRole.limitAccessByEnvironment,
                }}
                setValue={(newRoleInfo) => {
                  const newProjectRoles = [...projectRoles];
                  newProjectRoles[i] = {
                    ...projectRole,
                    ...newRoleInfo,
                  };
                  setValue({
                    ...value,
                    projectRoles: newProjectRoles,
                  });
                }}
                label={
                  <>
                    Project:{" "}
                    <strong>{getProjectById(projectRole.project)?.name}</strong>
                  </>
                }
                includeAdminRole={false}
              />
            </div>
          ))}
          {unusedProjects.length > 0 && (
            <div className="row">
              <div className="col">
                <SelectField
                  value={newProject}
                  onChange={(p) => setNewProject(p)}
                  initialOption="Choose Project..."
                  options={unusedProjects.map((p) => ({
                    label: p.name,
                    value: p.id,
                  }))}
                />
              </div>
              <div className="col-auto">
                <button
                  className="btn btn-outline-primary"
                  disabled={!newProject}
                  onClick={(e) => {
                    e.preventDefault();
                    if (!newProject) return;
                    setValue({
                      ...value,
                      projectRoles: [
                        ...projectRoles,
                        cloneDeep({
                          project: newProject,
                          ...settings.defaultRole,
                        }),
                      ],
                    });
                    setNewProject("");
                  }}
                >
                  Add Project Role
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showUpgradeModal && !canUseAdvancedPermissions && (
        <div className="alert alert-info">
          {isCloud() ? (
            <>
              Upgrade your plan to enable advanced, per-environment and
              per-project permissioning.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  showUpgradeModal();
                }}
              >
                Learn More
              </a>
            </>
          ) : (
            <>
              Purchase a commercial license key to enable advanced,
              per-environment and per-project permissioning. Contact{" "}
              <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> for
              more info.
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RoleSelector;
