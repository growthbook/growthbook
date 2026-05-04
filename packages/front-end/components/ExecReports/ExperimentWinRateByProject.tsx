import React, { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";

interface ExperimentWinRateByProjectProps {
  experiments: ExperimentInterfaceStringDates[];
  selectedProjects: string[];
  projectsToShow?: number;
}

const ExperimentWinRateByProject: React.FC<ExperimentWinRateByProjectProps> = ({
  experiments,
  selectedProjects,
  projectsToShow = 5, // Default to showing 5 projects
}) => {
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  // get all projects in the organization:
  const { projects } = useDefinitions();
  // Calculate win rates by project
  const projectWinRates = useMemo(() => {
    const projectMap: Record<
      string,
      {
        id: string;
        name: string;
        wins: number;
        losses: number;
        total: number;
      }
    > = projects.reduce(
      (map, project) => {
        map[project.id] = {
          id: project.id,
          name: project.name,
          wins: 0,
          losses: 0,
          total: 0,
        };
        return map;
      },
      {} as Record<
        string,
        {
          id: string;
          name: string;
          wins: number;
          losses: number;
          total: number;
        }
      >,
    );

    let allWins = 0;
    let allLosses = 0;
    let allTotal = 0;

    experiments.forEach((exp) => {
      if (exp.status === "stopped") {
        if (exp.project) {
          if (!projectMap[exp.project]) {
            projectMap[exp.project] = {
              id: exp.project,
              name: exp.project,
              wins: 0,
              losses: 0,
              total: 0,
            };
          }
          projectMap[exp.project].total += 1;
          allTotal += 1;
          if (exp.results === "won") {
            projectMap[exp.project].wins += 1;
            allWins += 1;
          }
          if (exp.results === "lost") {
            projectMap[exp.project].losses += 1;
            allLosses += 1;
          }
        } else {
          // If no project is specified, count it as "all" project
          allTotal += 1;
          if (exp.results === "won") {
            allWins += 1;
          }
          if (exp.results === "lost") {
            allLosses += 1;
          }
        }
      }
    });

    // if any projects are specified, filter the projectMap
    if (selectedProjects && selectedProjects.length > 0) {
      // Filter to only include specified projects
      Object.keys(projectMap).forEach((key) => {
        if (!selectedProjects.includes(projectMap[key].id)) {
          delete projectMap[key];
        }
      });
    }

    const projectList = Object.values(projectMap).map((project) => ({
      id: project.id,
      name: project.name,
      wins: project.wins,
      losses: project.losses,
      winRate: project.total > 0 ? (project.wins / project.total) * 100 : 0,
      total: project.total,
    }));

    if (!selectedProjects || selectedProjects.length === 0) {
      projectList.unshift({
        id: "all",
        name: "All Projects",
        winRate: allTotal > 0 ? (allWins / allTotal) * 100 : 0,
        losses: allLosses,
        wins: allWins,
        total: allTotal,
      });
    }

    return projectList;
  }, [experiments, projects, selectedProjects]);

  return (
    <Box width="100%" mt="5">
      <Flex width="100%" direction="column">
        <table className="table gbtable w-100">
          <thead>
            <tr>
              <th>Project</th>
              <th style={{ textAlign: "right" }}>Won/Lost/other</th>
              <th style={{ textAlign: "right" }}>Win rate</th>
            </tr>
          </thead>
          <tbody>
            {projectWinRates.map((project, i) => {
              if (!showAllProjects && i >= projectsToShow) {
                return;
              }
              return (
                <tr key={project.id}>
                  <td>{project.name}</td>
                  <td style={{ textAlign: "right" }}>
                    {project.wins}/{project.losses}/
                    {project.total - project.wins - project.losses}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {project.total > 0 ? `${project.winRate.toFixed(0)}%` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Box>
          {projectWinRates.length > projectsToShow && (
            <a
              href="#"
              className="ml-2"
              onClick={(e) => {
                e.preventDefault();
                setShowAllProjects(!showAllProjects);
              }}
              style={{ fontSize: "0.9em" }}
            >
              {showAllProjects ? "Show less" : "Show all"}
            </a>
          )}
        </Box>
      </Flex>
      {}
    </Box>
  );
};

export default ExperimentWinRateByProject;
