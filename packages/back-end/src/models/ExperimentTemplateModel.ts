import {
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import { ApiTemplate } from "shared/types/openapi";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentTemplateInterface,
  collectionName: "experimenttemplates",
  idPrefix: "tmplt__",
  auditLog: {
    entity: "experimentTemplate",
    createEvent: "experimentTemplate.create",
    updateEvent: "experimentTemplate.update",
    deleteEvent: "experimentTemplate.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    targeting: {
      condition: "{}",
    },
  },
});

export class ExperimentTemplatesModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: ExperimentTemplateInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: ExperimentTemplateInterface,
    updates: ExperimentTemplateInterface,
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      updates,
    );
  }
  protected canDelete(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("templates");
  }

  public toApiInterface(template: ExperimentTemplateInterface): ApiTemplate {
    return {
      id: template.id,
      dateCreated: template.dateCreated.toISOString(),
      dateUpdated: template.dateUpdated.toISOString(),
      project: template.project,
      owner: template.owner,
      templateMetadata: {
        name: template.templateMetadata.name,
        description: template.templateMetadata.description,
      },
      type: template.type,
      hypothesis: template.hypothesis,
      description: template.description,
      tags: template.tags,
      customFields: template.customFields,
      datasource: template.datasource,
      exposureQueryId: template.exposureQueryId,
      hashAttribute: template.hashAttribute,
      fallbackAttribute: template.fallbackAttribute,
      disableStickyBucketing: template.disableStickyBucketing,
      goalMetrics: template.goalMetrics,
      secondaryMetrics: template.secondaryMetrics,
      guardrailMetrics: template.guardrailMetrics,
      activationMetric: template.activationMetric,
      statsEngine: template.statsEngine,
      segment: template.segment,
      skipPartialData: template.skipPartialData,
      targeting: {
        coverage: template.targeting.coverage,
        condition: template.targeting.condition,
        savedGroups: template.targeting.savedGroups,
        prerequisites: template.targeting.prerequisites,
      },
      customMetricSlices: template.customMetricSlices,
    };
  }
}
