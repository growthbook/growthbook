import { ExperimentTemplateInterface } from "back-end/types/experiment";
import { useMemo } from "react";
import useApi from "./useApi";

export function useTemplates(
  project?: string,
  includeArchived: boolean = false
) {
  const { data, error, mutate } = useApi<{
    templates: ExperimentTemplateInterface[];
    hasArchived: boolean;
  }>("/templates");

  const templates = useMemo(() => data?.templates || [], [data]);

  const templatesMap = useMemo(() => new Map(templates.map((t) => [t.id, t])), [
    templates,
  ]);

  return {
    loading: !error && !data,
    templates: templates,
    templatesMap,
    error: error,
    mutateTemplates: mutate,
    hasArchived: data?.hasArchived || false,
  };
}
