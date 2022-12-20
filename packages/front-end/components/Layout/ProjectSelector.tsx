import clsx from "clsx";
import { FaCaretDown } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import Dropdown from "../Dropdown/Dropdown";
import DropdownLink from "../Dropdown/DropdownLink";
import LetterAvatar from "./LetterAvatar";

function ProjectName({
  display,
  avatarName,
  className,
  bold = false,
  caret = false,
}: {
  display: string;
  avatarName: string;
  className?: string;
  bold?: boolean;
  caret?: boolean;
}) {
  return (
    <div
      className={clsx(className, "d-flex align-items-center")}
      style={{ padding: "10px" }}
    >
      <LetterAvatar name={avatarName} defaultInitials="ALL" />
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

  if (!projects.length) return null;

  const current = getProjectById(project);

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
                />
              </DropdownLink>
            );
          })}
      </Dropdown>
    </li>
  );
}
