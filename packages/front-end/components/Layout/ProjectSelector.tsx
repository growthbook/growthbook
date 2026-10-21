import clsx from "clsx";
import { FaCaretDown } from "react-icons/fa";
import { FC, useEffect, useState } from "react";
import { PiFolder, PiMagnifyingGlassBold } from "react-icons/pi";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import Dropdown from "@/components/Dropdown/Dropdown";
import DropdownLink from "@/components/Dropdown/DropdownLink";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import { TextField } from "@/ui/TextField";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import LetterAvatar from "./LetterAvatar";
import { usePrototypeExistingPageColors } from "./PrototypeControls";
import headerStyles from "./HeaderBreadcrumb.module.scss";

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

// The selector's state, shared by the sidebar's selector and the header's
// (HeaderProjectSelector): the projects, sorted and searchable, and the one
// project a user without global read access is held to.
function useProjectSelector() {
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

  return {
    projects,
    project,
    current,
    setProject,
    orgId,
    permissions,
    currentProjectIsDemoProject,
    items,
    searchInputProps,
  };
}

// The header's project selector (app header redesign): a ghost button (a
// folder icon, the project's name, a chevron) opening the same searchable
// list, All Projects first, as the sidebar's. Usable on every page that
// shows it, as main's (set in review; was disabled, with a tooltip, on pages
// that aren't project-scoped, e.g. Settings).
export function HeaderProjectSelector() {
  const {
    projects,
    project,
    current,
    setProject,
    orgId,
    permissions,
    items,
    searchInputProps,
  } = useProjectSelector();
  const [open, setOpen] = useState(false);
  // PROTOTYPE: with "Interim colors" on, the button's look before the
  // redesign (set in review): Button's own ghost, without the 400 label,
  // the --slate-12 text and the 6px corners below.
  const interimColors = usePrototypeExistingPageColors();

  if (!projects.length) return null;

  const isDemo = (id: string) =>
    isDemoDatasourceProject({ projectId: id, organizationId: orgId || "" });

  // Held to one project: its name, no list; with the Demo badge when it's
  // the demo project, as main's (set in review).
  if (projects.length === 1 && !permissions.check("readData", "")) {
    return (
      <span className={headerStyles.projectStatic}>
        <PiFolder size={14} className={headerStyles.projectIcon} />
        <span className={headerStyles.projectName}>{projects[0].name}</span>
        {isDemo(projects[0].id) ? (
          <span className={headerStyles.demoBadge} title={demoBadge.badgeTitle}>
            {demoBadge.badgeText}
          </span>
        ) : null}
      </span>
    );
  }

  const name = current?.name || "All Projects";
  // @/ui/Button, ghost and grey, small (set in review; was a hand-built
  // 32px button): the folder as its icon, then the name (no chevron; set in
  // review). The
  // label at 400 and --slate-12 (.ghostButton, as the redesign's grey
  // Cancel buttons), 6px corners. preventDefault off, so the click reaches
  // the popover's trigger.
  const button = (
    <Button
      variant="ghost"
      color="gray"
      size="sm"
      preventDefault={false}
      className={clsx(
        headerStyles.headerButton,
        !interimColors && modalStandardStyles.ghostButton,
      )}
      style={
        interimColors
          ? undefined
          : { borderRadius: "var(--radius-3)", color: "var(--slate-12)" }
      }
      icon={
        <PiFolder
          size={14}
          // Interim: the button's own text colour, not the redesign's grey.
          className={interimColors ? undefined : headerStyles.projectIcon}
        />
      }
      aria-label={`Project: ${name}`}
    >
      <span className={headerStyles.projectName}>{name}</span>
      {current && isDemo(current.id) ? (
        <span className={headerStyles.demoBadge} title={demoBadge.badgeTitle}>
          {demoBadge.badgeText}
        </span>
      ) : null}
    </Button>
  );

  const choose = (id: string) => {
    setProject(id);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={button}
      side="bottom"
      align="start"
      sideOffset={4}
      showArrow={false}
      contentClassName={clsx(
        headerStyles.projectMenu,
        listTableStyles.menuShadow,
        listTableStyles.menuOutline,
      )}
      // 12px all round (set in review; was none). Inline, as Popover sets
      // its own padding inline.
      contentStyle={{ padding: "var(--space-3)" }}
      content={
        <div className={headerStyles.projectMenuInner}>
          {/* The experiments list's search field (set in review; was a
            small one with "Search..."): @/ui/TextField at its default size,
            the magnifying glass before the placeholder in --slate-9. */}
          <TextField
            placeholder="Search"
            type="search"
            aria-label="Search projects"
            prepend={
              <PiMagnifyingGlassBold
                size={14}
                style={{ color: "var(--slate-9)" }}
              />
            }
            {...searchInputProps}
          />
          <div className={headerStyles.projectList} role="list">
            <button
              type="button"
              className={headerStyles.projectOption}
              aria-current={!project ? "true" : undefined}
              onClick={() => choose("")}
            >
              All Projects
            </button>
            {items.map((p) => (
              <button
                type="button"
                key={p.id}
                className={headerStyles.projectOption}
                aria-current={p.id === project ? "true" : undefined}
                onClick={() => choose(p.id)}
              >
                <span className={headerStyles.projectName}>{p.name}</span>
                {isDemo(p.id) ? (
                  <span
                    className={headerStyles.demoBadge}
                    title={demoBadge.badgeTitle}
                  >
                    {demoBadge.badgeText}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      }
    />
  );
}

export default function ProjectSelector() {
  const {
    projects,
    project,
    current,
    setProject,
    orgId,
    permissions,
    currentProjectIsDemoProject,
    items,
    searchInputProps,
  } = useProjectSelector();

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
          <Field
            size="legacy"
            placeholder="Search..."
            type="search"
            {...searchInputProps}
          />
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
