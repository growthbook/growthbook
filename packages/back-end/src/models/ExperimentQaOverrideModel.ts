import { difference, isEqual, uniq } from "lodash";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  experimentSupportsQaOverrides,
  isProductionEnvironment,
  reorderQaOverridesInEnvironment,
  sortQaOverrides,
  validateCondition,
} from "shared/util";
import {
  ExperimentQaOverrideInterface,
  QaOverrideFilters,
} from "shared/types/experiment-qa-override";
import { CreateProps } from "shared/types/base-model";
import { experimentQaOverrideValidator } from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getSavedGroupsForValidation } from "back-end/src/services/savedGroups";
import {
  assertCanUseSDKConnections,
  findSDKConnectionsByOrganization,
} from "back-end/src/models/SdkConnectionModel";
import { getEnvironments } from "back-end/src/util/organization.util";
import { ConflictError } from "back-end/src/util/errors";
import { CasConflictError, MakeModelClass } from "./BaseModel";

type WriteOptions = {
  skipSDKRefresh?: boolean;
};

const BaseClass = MakeModelClass({
  schema: experimentQaOverrideValidator,
  collectionName: "experimentqaoverrides",
  idPrefix: "eqo_",
  auditLog: {
    entity: "experimentQaOverride",
    createEvent: "experimentQaOverride.create",
    updateEvent: "experimentQaOverride.update",
    deleteEvent: "experimentQaOverride.delete",
  },
  globallyUniquePrimaryKeys: false,
  readonlyFields: ["experiment", "environment", "createdBy"],
  additionalIndexes: [
    { fields: { organization: 1, experiment: 1 } },
    { fields: { organization: 1, environment: 1 } },
  ],
});

export class ExperimentQaOverrideModel extends BaseClass<WriteOptions> {
  public findByExperiment(experiment: string) {
    return this.findSorted({ experiment });
  }

  public findByEnvironment(environment: string) {
    return this.findSorted({ environment });
  }

  public getAllForPayload() {
    return this.findSorted({});
  }

  // Callers authorize against the experiment or environment themselves.
  private async findSorted(filter: {
    experiment?: string;
    environment?: string;
  }) {
    const docs = await this._find(filter, { bypassReadPermissionChecks: true });
    return sortQaOverrides(docs);
  }

  // Priority is per environment; a new override goes last in its own.
  public async createLast(
    props: Omit<CreateProps<ExperimentQaOverrideInterface>, "order">,
  ) {
    const siblings = (await this.findByExperiment(props.experiment)).filter(
      (o) => o.environment === props.environment,
    );
    return this.create({
      ...props,
      order: siblings.reduce((max, o) => Math.max(max, o.order + 1), 0),
    });
  }

  public async reorder(
    experiment: string,
    environment: string,
    overrideIds: string[],
  ) {
    const changes = reorderQaOverridesInEnvironment(
      await this.findByExperiment(experiment),
      environment,
      overrideIds,
    );
    if (!changes) {
      return this.context.throwBadRequestError(
        "overrideIds must list every QA override in this environment exactly once",
      );
    }

    const conflict = () =>
      new ConflictError(
        "The order of these QA overrides changed. Reload and try again.",
      );

    // Each write is guarded on the row as it was read, so a reorder that
    // overlaps a concurrent one is refused instead of interleaving with it.
    let applied = 0;
    try {
      for (const { override, order } of changes) {
        await this.updateIfUnchanged(
          override,
          { order },
          { skipSDKRefresh: true },
        );
        applied++;
      }

      // The guards only cover the rows this request wrote; an overlapping
      // reorder that failed part way can have moved others. Only succeed when
      // the stored order is exactly the requested one. Anything left behind
      // is rewritten by the next reorder.
      const remaining = reorderQaOverridesInEnvironment(
        await this.findByExperiment(experiment),
        environment,
        overrideIds,
      );
      if (remaining?.length !== 0) throw conflict();
    } catch (e) {
      if (e instanceof CasConflictError) throw conflict();
      throw e;
    } finally {
      if (applied) await this.refreshEnvironments([environment]);
    }
  }

  // No permission check on these two: the actor already changed the
  // experiment or environment, which may no longer exist.
  public async deleteByExperiment(
    experiment: string,
    writeOptions?: WriteOptions,
  ) {
    return this.deleteAll(
      await this.findByExperiment(experiment),
      writeOptions,
    );
  }

  public async deleteByEnvironment(
    environment: string,
    writeOptions?: WriteOptions,
  ) {
    return this.deleteAll(
      await this.findByEnvironment(environment),
      writeOptions,
    );
  }

  private async deleteAll(
    docs: ExperimentQaOverrideInterface[],
    writeOptions?: WriteOptions,
  ) {
    for (const doc of docs) {
      await this._deleteOne(
        doc,
        { ...writeOptions, skipSDKRefresh: true },
        true,
      );
    }
    await this.refreshEnvironments(
      docs.map((d) => d.environment),
      writeOptions,
    );
    return docs;
  }

  private getExperiment(doc: ExperimentQaOverrideInterface) {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    return experiment;
  }

  protected canRead(doc: ExperimentQaOverrideInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(
      this.getExperiment(doc).project,
    );
  }

  private canWrite(doc: ExperimentQaOverrideInterface): boolean {
    return this.context.permissions.canRunExperiment(this.getExperiment(doc), [
      doc.environment,
    ]);
  }
  protected canCreate(doc: ExperimentQaOverrideInterface): boolean {
    return this.canWrite(doc);
  }
  protected canUpdate(existing: ExperimentQaOverrideInterface): boolean {
    return this.canWrite(existing);
  }
  protected canDelete(doc: ExperimentQaOverrideInterface): boolean {
    return this.canWrite(doc);
  }

  // The experiment and environment gates always apply. References are only
  // checked when they change: one that has since gone stale (a removed
  // variation, a deleted SDK Connection) is reported as a status and must not
  // block reordering or editing the rest of the override.
  protected async customValidation(
    doc: ExperimentQaOverrideInterface,
    previousDoc?: ExperimentQaOverrideInterface,
  ) {
    const experiment = this.getExperiment(doc);
    if (experiment.archived) {
      throw new Error("Cannot add a QA override to an archived experiment");
    }
    if (experiment.status !== "draft") {
      throw new Error(
        "QA overrides are only available while the experiment is in draft",
      );
    }
    if (!experimentSupportsQaOverrides(experiment)) {
      throw new Error(
        "QA overrides are not supported for this experiment type",
      );
    }

    const env = getEnvironments(this.context.org).find(
      (e) => e.id === doc.environment,
    );
    if (!env) throw new Error("Could not find environment");
    if (isProductionEnvironment(env)) {
      throw new Error(
        `QA overrides aren't allowed on production environments. To use ${env.id}, turn off "This is a production environment" in Settings → Environments.`,
      );
    }

    const { assignment } = doc;
    if (
      assignment.type === "forced" &&
      !isEqual(assignment, previousDoc?.assignment) &&
      !getLatestPhaseVariations(experiment).some(
        (v) => v.id === assignment.variationId,
      )
    ) {
      throw new Error("Invalid variation for forced assignment");
    }

    await this.validateFilters(doc, previousDoc?.filters ?? {});
  }

  private async validateFilters(
    doc: ExperimentQaOverrideInterface,
    previous: QaOverrideFilters,
  ) {
    const { condition, savedGroups, sdkConnections, projects } = doc.filters;

    if ((condition ?? "") !== (previous.condition ?? "")) {
      const result = validateCondition(
        condition,
        await getSavedGroupsForValidation(this.context, [{ condition }]),
      );
      if (!result.success) {
        throw new Error(`Invalid targeting condition: ${result.error}`);
      }
      // validateCondition accepts arrays, and an empty one matches everyone.
      if (!result.empty && Array.isArray(JSON.parse(condition ?? ""))) {
        throw new Error("Targeting condition must be a JSON object");
      }
    }

    const groupIds = (filters: QaOverrideFilters["savedGroups"]) =>
      uniq((filters ?? []).flatMap((g) => g.ids));
    const addedGroups = difference(
      groupIds(savedGroups),
      groupIds(previous.savedGroups),
    );
    if (addedGroups.length) {
      const found = await this.context.models.savedGroups.getByIds(addedGroups);
      const missing = addedGroups.filter(
        (id) => !found.some((g) => g.id === id),
      );
      if (missing.length) {
        throw new Error(`Unknown Saved Group(s): ${missing.join(", ")}`);
      }
    }

    const addedConnections = difference(
      uniq(sdkConnections ?? []),
      previous.sdkConnections ?? [],
    );
    if (addedConnections.length) {
      const connections = await assertCanUseSDKConnections(
        this.context,
        addedConnections,
        (c) => this.context.permissions.canReadMultiProjectResource(c.projects),
      );
      const wrongEnv = connections.filter(
        (c) => c.environment !== doc.environment,
      );
      if (wrongEnv.length) {
        throw new Error(
          `SDK Connection(s) not in the ${doc.environment} environment: ${wrongEnv
            .map((c) => c.name)
            .join(", ")}`,
        );
      }
    }

    const addedProjects = difference(
      uniq(projects ?? []),
      previous.projects ?? [],
    );
    if (addedProjects.length) {
      await this.context.models.projects.ensureProjectsExist(addedProjects);
    }
  }

  private async refreshEnvironments(
    environments: string[],
    writeOptions?: WriteOptions,
  ) {
    if (writeOptions?.skipSDKRefresh) return;
    const envs = new Set(environments);
    if (!envs.size) return;
    const connections = (
      await findSDKConnectionsByOrganization(this.context)
    ).filter((c) => envs.has(c.environment));
    if (!connections.length) return;
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: [],
      sdkConnections: connections,
      auditContext: {
        event: "updated",
        model: "experimentQaOverride",
      },
    });
  }

  protected async afterCreateOrUpdate(
    doc: ExperimentQaOverrideInterface,
    writeOptions?: WriteOptions,
  ) {
    await this.refreshEnvironments([doc.environment], writeOptions);
  }

  protected async afterDelete(
    doc: ExperimentQaOverrideInterface,
    writeOptions?: WriteOptions,
  ) {
    await this.refreshEnvironments([doc.environment], writeOptions);
  }
}
