type DigestFilterConfig = {
  projects: string[];
  tags: string[];
  environments: string[];
  ids: string[];
};

type DigestEvent = {
  objectId?: string;
  data?: {
    projects?: string[];
    tags?: string[];
    environment?: string;
    environments?: string[];
    data?: {
      projects?: string[];
      tags?: string[];
      environment?: string;
      environments?: string[];
    };
  };
};

const overlaps = (wanted: string[], actual: string[]) =>
  wanted.length === 0 || wanted.some((value) => actual.includes(value));

export const digestEventPassesFilters = (
  event: DigestEvent,
  filters: DigestFilterConfig,
): boolean => {
  const data = event.data;
  const nested = data?.data;
  const projects = data?.projects ?? nested?.projects ?? [];
  const tags = data?.tags ?? nested?.tags ?? [];
  const environments =
    data?.environments ??
    nested?.environments ??
    (data?.environment || nested?.environment
      ? [data.environment || nested?.environment || ""]
      : []);
  return (
    (filters.ids.length === 0 ||
      (!!event.objectId && filters.ids.includes(event.objectId))) &&
    overlaps(filters.projects, projects) &&
    overlaps(filters.tags, tags) &&
    overlaps(filters.environments, environments)
  );
};
