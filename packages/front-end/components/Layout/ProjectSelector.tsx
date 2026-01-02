import clsx from "clsx";
import { FaCaretDown } from "react-icons/fa";
import { FC, useEffect } from "react";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import Dropdown from "@/components/Dropdown/Dropdown";
import DropdownLink from "@/components/Dropdown/DropdownLink";
import LetterAvatar from "./LetterAvatar";

const demoBadge = {
  badgeText: "Demo",
  badgeColor: "#EB8045",
  badgeTitle: "This is a demo project with sample data",
};

type ProjectDropdownBadgeProps = {
  badgeText: string;
  badgeColor: string;
  badgeTitle: string;
};

const ProjectDropdownBadge: FC<ProjectDropdownBadgeProps> = ({
  badgeText,
  badgeColor,
  badgeTitle,
}) => {
  return (
    <div
      className="badge badge-pill position-absolute text-white"
      title={badgeTitle}
      style={{
        backgroundColor: badgeColor,
        bottom: -6,
        left: -6,
        fontSize: "0.7em",
      }}
    >
      {badgeText}
    </div>
  );
};

function ProjectName({
  display,
  avatarName,
  className,
  bold = false,
  caret = false,
  size = "small",
  badge,
}: {
  display: string;
  avatarName: string;
  className?: string;
  bold?: boolean;
  caret?: boolean;
  size?: "small" | "large";
  badge: ProjectDropdownBadgeProps | null;
}) {
  return (
    <div
      className={clsx(className, "d-flex align-items-center")}
      style={{ padding: "5px 10px" }}
    >
      <div className="position-relative">
        <LetterAvatar name={avatarName} defaultInitials="ALL" size={size} />
        {badge ? <ProjectDropdownBadge {...badge} /> : null}
      </div>
      <div
        style={{
          flex: 1,
          lineHeight: 1.2,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {bold ? (
          <strong style={{ fontWeight: 600 }}>{display}</strong>
        ) : (
          display
        )}
      </div>
      {caret && <FaCaretDown />}
    </div>
  );
}

export default function ProjectSelector() {
  const { projects, project, getProjectById, setProject } = useDefinitions();
  const { orgId } = useAuth();
  const current = getProjectById(project);
  const permissions = usePermissions();

  const currentProjectIsDemoProject = isDemoDatasourceProject({
    projectId: current?.id || "",
    organizationId: orgId || "",
  });

  const { items, searchInputProps } = useSearch({
    items: projects.slice().sort((a, b) => (a.name > b.name ? 1 : -1)),
    defaultSortField: "name",
    localStorageKey: "project-selector",
    searchFields: ["name^3", "description"],
  });

  useEffect(() => {
    if (projects?.length === 1 && !permissions.check("readData", "")) {
      setProject(projects[0].id);
    }
  }, [projects, permissions, setProject]);

  if (!projects.length) return null;

  // If globalRole doesn't give readAccess & user can only access 1 project, don't show dropdown
  if (projects.length === 1 && !permissions.check("readData", "")) {
    return (
      <li
        style={{
          marginTop: 0,
          marginBottom: "20px",
          textTransform: "none",
          maxWidth: 240,
        }}
      >
        <ProjectName
          caret={false}
          avatarName={projects[0].name}
          display={projects[0].name}
          badge={
            isDemoDatasourceProject({
              projectId: projects[0].id,
              organizationId: orgId || "",
            })
              ? demoBadge
              : null
          }
        />
      </li>
    );
  }

  return (
    <li
      style={{
        marginTop: 0,
        marginBottom: "20px",
        textTransform: "none",
        maxWidth: 240,
      }}
    >
      <Dropdown
        uuid="project-selector"
        caret={false}
        right={false}
        width={220}
        className={"p-0 pb-2"}
        toggle={
          <ProjectName
            caret
            avatarName={current?.name || ""}
            display={current?.name || "All Projects"}
            bold={true}
            badge={currentProjectIsDemoProject ? demoBadge : null}
            size="large"
          />
        }
      >
        <div className="mt-2 mx-2">
          <Field placeholder="Search..." type="search" {...searchInputProps} />
        </div>
        <DropdownLink
          onClick={() => {
            setProject("");
          }}
          className="p-0 px-1"
        >
          <ProjectName
            badge={null}
            className="text-dark"
            avatarName={""}
            display={"All Projects"}
            bold={!project}
          />
        </DropdownLink>
        {items.map((p) => {
          return (
            <DropdownLink
              className="p-0 px-1"
              key={p.id}
              onClick={() => {
                setProject(p.id);
              }}
            >
              <ProjectName
                className="text-dark"
                avatarName={p.name}
                display={p.name}
                bold={p.id === project}
                badge={
                  isDemoDatasourceProject({
                    projectId: p.id,
                    organizationId: orgId || "",
                  })
                    ? demoBadge
                    : null
                }
              />
            </DropdownLink>
          );
        })}
      </Dropdown>
    </li>
  );
}
