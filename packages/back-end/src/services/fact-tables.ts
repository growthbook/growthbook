export function validateFactTableProjects(
  datasourceProjects: string[],
  factTableProjects: string[]
): void {
  // if data source is in 'All Projects' the fact table can be in all or any projects - fact table projects are valid
  if (!datasourceProjects.length) {
    return;
  }
  // if the data source has projects the fact table can't be in 'All Projects'
  if (!factTableProjects.length) {
    throw new Error(
      "Fact Table projects must be a subset of the connected data source's projects. Can't be in all projects."
    );
  } else {
    // if the data source has projects - the fact table's project list must be subset of that
    factTableProjects.forEach((project) => {
      if (!datasourceProjects.includes(project)) {
        throw new Error(
          `Fact Table projects must be subset of connected data source's projects. ${project} is not associated with connected data source.`
        );
      }
    });
  }
}
