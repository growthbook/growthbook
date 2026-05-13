import {
  BuiltInDashboardTemplate,
  DashboardTemplateMetadata,
  TemplateBuildContext,
} from "back-end/src/enterprise/services/dashboard-templates/types";
import { ga4StarterTemplate } from "back-end/src/enterprise/services/dashboard-templates/templates/ga4";

export * from "back-end/src/enterprise/services/dashboard-templates/types";
export { instantiateTemplate } from "back-end/src/enterprise/services/dashboard-templates/instantiate";

const BUILT_IN_DASHBOARD_TEMPLATES: BuiltInDashboardTemplate[] = [
  ga4StarterTemplate,
];

// Public metadata for a template. Stripped of internal fields like the
// build function so we can safely return it over the wire.
function toMetadata(
  template: BuiltInDashboardTemplate,
): DashboardTemplateMetadata {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
  };
}

export function getEligibleTemplates(
  ctx: TemplateBuildContext,
): DashboardTemplateMetadata[] {
  return BUILT_IN_DASHBOARD_TEMPLATES.filter((t) => t.isEligible(ctx)).map(
    toMetadata,
  );
}

export function getTemplateById(
  id: string,
): BuiltInDashboardTemplate | undefined {
  return BUILT_IN_DASHBOARD_TEMPLATES.find((t) => t.id === id);
}
