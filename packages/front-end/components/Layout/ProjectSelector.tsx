import clsx from "clsx";
import { FaCaretDown } from "react-icons/fa";
import { FC } from "react";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Dropdown from "../Dropdown/Dropdown";
import DropdownLink from "../Dropdown/DropdownLink";
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
  badge,
}: {
  display: string;
  avatarName: string;
  className?: string;
  bold?: boolean;
  caret?: boolean;
  badge: ProjectDropdownBadgeProps | null;
}) {
  return (
    <div
      className={clsx(className, "d-flex align-items-center")}
      style={{ padding: "10px" }}
    >
      <div className="position-relative">
        <LetterAvatar name={avatarName} defaultInitials="ALL" />
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
        {bold ? <strong>{display}</strong> : display}
      </div>
      {caret && <FaCaretDown />}
    </div>
  );
}

export default function ProjectSelector() {
  const { projects, project, getProjectById, setProject } = useDefinitions();
  const { orgId } = useAuth();
  const current = getProjectById(project);

  const currentProjectIsDemoProject = isDemoDatasourceProject({
    projectId: current?.id || "",
    organizationId: orgId || "",
  });

  if (!projects.length) return null;

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
        className={"p-0"}
        toggle={
          <ProjectName
            caret
            avatarName={current?.name || ""}
            display={current?.name || "All Projects"}
            badge={currentProjectIsDemoProject ? demoBadge : null}
          />
        }
      >
        <DropdownLink
          onClick={() => {
            setProject("");
          }}
          className="p-0"
        >
          <ProjectName
            badge={null}
            className="text-dark"
            avatarName={""}
            display={"All Projects"}
            bold={!project}
          />
        </DropdownLink>
        {projects
          .slice()
          .sort((a, b) => (a.name > b.name ? 1 : -1))
          .map((p) => {
            return (
              <DropdownLink
                className="p-0"
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
