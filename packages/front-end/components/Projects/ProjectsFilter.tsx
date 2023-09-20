import { useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import ProjectsInput from "./ProjectsInput";

interface ItemWithProjects {
  projects?: string[];
  project?: string;
}

interface ProjectsFilter {
  projects: string[];
  setProjects: (projects: string[]) => void;
}

export interface Props {
  filter: ProjectsFilter;
  items?: ItemWithProjects[];
  initialOpen?: boolean;
}

export function filterByProjects<T extends ItemWithProjects>(
  items: T[],
  projects: string[]
): T[] {
  if (!projects.length) return items;

  return items.filter((item) => {
    if (!item.projects) return false;
    for (let i = 0; i < projects.length; i++) {
      if (!item.projects.includes(projects[i])) return false;
    }
    return true;
  });
}

export function useProjectsFilter(page: string): ProjectsFilter {
  const [projects, setProjects] = useLocalStorage<string[]>(
    page + ":projects-filter",
    []
  );
  return {
    projects,
    setProjects,
  };
}

export default function ProjectsFilter({
  filter: { projects, setProjects },
  items,
  initialOpen = false,
}: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [autofocus, setAutofocus] = useState(false);
  const counts: Record<string, number> = {};
  const availableProjects: string[] = [];
  items?.forEach((item) => {
    if (item?.projects) {
      item.projects.forEach((p) => {
        counts[p] = counts[p] || 0;
        counts[p]++;
        if (!availableProjects.includes(p)) {
          availableProjects.push(p);
        }
      });
    }
  });

  // Only turn `autofocus` on briefly after clicking "fitler by tags"
  useEffect(() => {
    if (!autofocus) return;
    const timer = setTimeout(() => {
      setAutofocus(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [autofocus]);

  availableProjects.sort((a, b) => {
    return (counts[b] || 0) - (counts[a] || 0);
  });
  //if (!projects.length && !availableProjects.length) return null;

  if (!open && !projects.length) {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
          setAutofocus(true);
        }}
      >
        Filter by project...
      </a>
    );
  }

  return (
    <div style={{ minWidth: 207 }}>
      <ProjectsInput
        value={projects}
        onChange={(value) => {
          setProjects(value);
        }}
        prompt={"Filter by project..."}
        autoFocus={open && autofocus}
        closeMenuOnSelect={true}
        creatable={false}
      />
    </div>
  );
}
