import { getLatestPhaseVariations } from "shared/experiments";
import {
  experimentSupportsQaOverrides,
  isProductionEnvironment,
  qaOverrideAppliesToConnection,
  qaOverrideHasCondition,
  sortQaOverrides,
} from "shared/util";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { experimentQaOverrideValidator } from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  findSDKConnectionsByIds,
  findSDKConnectionsByOrganization,
} from "back-end/src/models/SdkConnectionModel";
import { getEnvironments } from "back-end/src/util/organization.util";
import { MakeModelClass } from "./BaseModel";

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
  public async findByExperiment(experiment: string) {
    const docs = await this._find(
      { experiment },
      { bypassReadPermissionChecks: true },
    );
    return sortQaOverrides(docs);
  }

  public async findByEnvironment(environment: string) {
    const docs = await this._find(
      { environment },
      { bypassReadPermissionChecks: true },
    );
    return sortQaOverrides(docs);
  }

  public async getAllForPayload() {
    const docs = await this._find({}, { bypassReadPermissionChecks: true });
    return sortQaOverrides(docs);
  }

  // Overrides a connection receives: its environment, plus any connection or
  // project filter that names it.
  public async findForSdkConnection(connection: SDKConnectionInterface) {
    const docs = await this._find(
      { environment: connection.environment },
      { bypassReadPermissionChecks: true },
    );
    return sortQaOverrides(docs).filter((o) =>
      qaOverrideAppliesToConnection(o, connection),
    );
  }

  public countByExperiment(experiment: string): Promise<number> {
    return this._countDocuments({ experiment });
  }

  public async deleteByExperiment(
    experiment: string,
    writeOptions?: WriteOptions,
  ) {
    const docs = await this.findByExperiment(experiment);
    for (const doc of docs) {
      await this._deleteOne(doc, { ...writeOptions, skipSDKRefresh: true });
    }
    await this.refreshEnvironments(
      docs.map((d) => d.environment),
      writeOptions,
    );
    return docs;
  }

  public async deleteByEnvironment(
    environment: string,
    writeOptions?: WriteOptions,
  ) {
    const docs = await this.findByEnvironment(environment);
    for (const doc of docs) {
      await this._deleteOne(
        doc,
        { ...writeOptions, skipSDKRefresh: true },
        true,
      );
    }
    if (docs.length)
      await this.refreshEnvironments([environment], writeOptions);
    return docs;
  }

  // Called when a connection is deleted or moves to another environment. An
  // override that only named this connection is deleted rather than widened
  // to the whole environment.
  public async removeSdkConnectionFromFilters(
    connectionId: string,
    writeOptions?: WriteOptions,
  ) {
    const docs = (await this.getAllForPayload()).filter((o) =>
      o.filters.sdkConnections?.includes(connectionId),
    );
    const touched: ExperimentQaOverrideInterface[] = [];
    for (const doc of docs) {
      const sdkConnections = (doc.filters.sdkConnections ?? []).filter(
        (id) => id !== connectionId,
      );
      if (sdkConnections.length) {
        await this._updateOne(
          doc,
          { filters: { ...doc.filters, sdkConnections } },
          {
            writeOptions: { ...writeOptions, skipSDKRefresh: true },
            forceCanUpdate: true,
          },
        );
      } else {
        await this._deleteOne(
          doc,
          { ...writeOptions, skipSDKRefresh: true },
          true,
        );
      }
      touched.push(doc);
    }
    await this.refreshEnvironments(
      touched.map((d) => d.environment),
      writeOptions,
    );
    return touched;
  }

  protected canRead(doc: ExperimentQaOverrideInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  private canWrite(doc: ExperimentQaOverrideInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    return this.context.permissions.canRunExperiment(experiment, [
      doc.environment,
    ]);
  }
  protected canCreate(doc: ExperimentQaOverrideInterface): boolean {
    return this.canWrite(doc);
  }
  protected canUpdate(doc: ExperimentQaOverrideInterface): boolean {
    return this.canWrite(doc);
  }
  protected canDelete(doc: ExperimentQaOverrideInterface): boolean {
    return this.canWrite(doc);
  }

  protected async customValidation(doc: ExperimentQaOverrideInterface) {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
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
      throw new Error("QA overrides aren't allowed on production environments");
    }

    if (doc.assignment.type === "forced") {
      const variationId = doc.assignment.variationId;
      const valid = getLatestPhaseVariations(experiment).some(
        (v) => v.id === variationId,
      );
      if (!valid) throw new Error("Invalid variation for forced assignment");
    }

    await this.validateFilters(doc);
  }

  private async validateFilters(doc: ExperimentQaOverrideInterface) {
    const { condition, savedGroups, sdkConnections, projects } = doc.filters;

    if (qaOverrideHasCondition(doc.filters)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(condition ?? "");
      } catch (e) {
        throw new Error("Targeting condition is not valid JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Targeting condition must be a JSON object");
      }
    }

    if (savedGroups?.length) {
      const ids = [...new Set(savedGroups.flatMap((g) => g.ids))];
      const found = await this.context.models.savedGroups.getByIds(ids);
      const missing = ids.filter((id) => !found.some((g) => g.id === id));
      if (missing.length) {
        throw new Error(`Unknown saved group(s): ${missing.join(", ")}`);
      }
    }

    if (sdkConnections?.length) {
      const connections = await findSDKConnectionsByIds(
        this.context,
        sdkConnections,
      );
      const missing = sdkConnections.filter(
        (id) => !connections.some((c) => c.id === id),
      );
      if (missing.length) {
        throw new Error(`Unknown SDK Connection(s): ${missing.join(", ")}`);
      }
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

    if (projects?.length) {
      const all = await this.context.models.projects.getAll();
      const missing = projects.filter((p) => !all.some((a) => a.id === p));
      if (missing.length) {
        throw new Error(`Unknown project(s): ${missing.join(", ")}`);
      }
    }
  }

  // Every connection in the environment may be affected: with no connection
  // filter the override reaches all of them.
  public async refreshEnvironments(
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
