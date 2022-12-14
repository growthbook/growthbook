import { useState } from "react";
import { ProjectMemberRole } from "back-end/types/organization";
import cloneDeep from "lodash/cloneDeep";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import PremiumTooltip from "../../Marketing/PremiumTooltip";
import SingleRoleSelector from "./SingleRoleSelector";

export default function ProjectRolesSelector({
  projectRoles,
  setProjectRoles,
}: {
  projectRoles: ProjectMemberRole[];
  setProjectRoles: (roles: ProjectMemberRole[]) => void;
}) {
  const { projects, getProjectById } = useDefinitions();
  const { hasCommercialFeature, settings } = useUser();
  const [newProject, setNewProject] = useState("");

  const hasFeature = hasCommercialFeature("advanced-permissions");
  if (!projects?.length) return null;

  const usedProjectIds = projectRoles.map((r) => r.project) || [];
  const unusedProjects = projects.filter((p) => !usedProjectIds.includes(p.id));

  return (
    <>
      <label className="mb-2">
        <PremiumTooltip commercialFeature="advanced-permissions">
          Project Roles (optional)
        </PremiumTooltip>
      </label>
      {projectRoles.map((projectRole, i) => (
        <div className="appbox px-3 pt-2 bg-light" key={i}>
          <div style={{ float: "right" }}>
            <a
              href="#"
              className="text-danger"
              onClick={(e) => {
                e.preventDefault();
                const newProjectRoles = [...projectRoles];
                newProjectRoles.splice(i, 1);
                setProjectRoles(newProjectRoles);
              }}
            >
              remove
            </a>
          </div>
          <SingleRoleSelector
            value={{
              role: projectRole.role,
              environments: projectRole.environments,
              limitAccessByEnvironment: projectRole.limitAccessByEnvironment,
            }}
            setValue={(newRoleInfo) => {
              const newProjectRoles = [...projectRoles];
              newProjectRoles[i] = {
                ...projectRole,
                ...newRoleInfo,
              };
              setProjectRoles(newProjectRoles);
            }}
            label={
              <>
                Project:{" "}
                <strong>{getProjectById(projectRole.project)?.name}</strong>
              </>
            }
            disabled={!hasFeature}
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
              disabled={!hasFeature}
            />
          </div>
          <div className="col-auto">
            <button
              className="btn btn-outline-primary"
              disabled={!newProject || !hasFeature}
              onClick={(e) => {
                e.preventDefault();
                if (!newProject) return;
                setProjectRoles([
                  ...projectRoles,
                  cloneDeep({
                    project: newProject,
                    ...settings.defaultRole,
                  }),
                ]);
                setNewProject("");
              }}
            >
              Add Project Role
            </button>
          </div>
        </div>
      )}
    </>
  );
}
