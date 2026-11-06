import { getLatestPhaseVariations } from "shared/experiments";
import {
  experimentSupportsQaOverrides,
  isProductionEnvironment,
} from "shared/util";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { experimentQaOverrideValidator } from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { findSDKConnectionsByIds } from "back-end/src/models/SdkConnectionModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
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
  readonlyFields: ["experiment", "sdkConnection", "environment", "createdBy"],
  additionalIndexes: [
    {
      fields: { organization: 1, experiment: 1, sdkConnection: 1 },
      unique: true,
    },
    { fields: { organization: 1, sdkConnection: 1 } },
    { fields: { organization: 1, environment: 1 } },
  ],
});

export class ExperimentQaOverrideModel extends BaseClass<WriteOptions> {
  public findByExperiment(experiment: string) {
    return this._find({ experiment }, { bypassReadPermissionChecks: true });
  }

  public findBySdkConnection(sdkConnection: string) {
    return this._find({ sdkConnection });
  }

  public findBySdkConnectionForPayload(sdkConnection: string) {
    return this._find({ sdkConnection }, { bypassReadPermissionChecks: true });
  }

  public getAllForPayload() {
    return this._find({}, { bypassReadPermissionChecks: true });
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
      await this._deleteOne(doc, writeOptions, true);
    }
    return docs;
  }

  public async deleteBySdkConnection(
    sdkConnection: string,
    writeOptions?: WriteOptions,
  ) {
    const docs = await this.findBySdkConnectionForPayload(sdkConnection);
    for (const doc of docs) {
      await this._deleteOne(doc, writeOptions, true);
    }
    return docs;
  }

  public async deleteOutOfScopeForSdkConnection(
    sdkConnection: string,
    projects: string[],
    writeOptions?: WriteOptions,
  ) {
    if (!projects.length) return [];
    const docs = await this.findBySdkConnectionForPayload(sdkConnection);
    if (!docs.length) return [];
    const experiments = await getExperimentsByIds(
      this.context,
      docs.map((d) => d.experiment),
    );
    const removed: ExperimentQaOverrideInterface[] = [];
    for (const doc of docs) {
      const experiment = experiments.find((e) => e.id === doc.experiment);
      if (experiment && projects.includes(experiment.project || "")) continue;
      await this._deleteOne(doc, writeOptions, true);
      removed.push(doc);
    }
    return removed;
  }

  public async deleteByEnvironment(
    environment: string,
    writeOptions?: WriteOptions,
  ) {
    const docs = await this._find(
      { environment },
      { bypassReadPermissionChecks: true },
    );
    for (const doc of docs) {
      await this._deleteOne(doc, writeOptions, true);
    }
    return docs;
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

  private async getConnection(
    doc: ExperimentQaOverrideInterface,
  ): Promise<SDKConnectionInterface | null> {
    const [connection] = await findSDKConnectionsByIds(this.context, [
      doc.sdkConnection,
    ]);
    return connection ?? null;
  }

  protected async customValidation(doc: ExperimentQaOverrideInterface) {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    if (experiment.archived) {
      throw new Error("Cannot add a QA override to an archived experiment");
    }
    if (experiment.status !== "draft") {
      throw new Error(
        "QA overrides are only available while an experiment is a draft",
      );
    }
    if (!experimentSupportsQaOverrides(experiment)) {
      throw new Error(
        "QA overrides are not supported for this experiment type",
      );
    }

    const connection = await this.getConnection(doc);
    if (!connection) throw new Error("Could not find SDK Connection");
    if (connection.environment !== doc.environment) {
      throw new Error("Override environment does not match the SDK Connection");
    }
    const env = getEnvironments(this.context.org).find(
      (e) => e.id === connection.environment,
    );
    if (!env || isProductionEnvironment(env)) {
      throw new Error(
        "QA overrides aren't allowed on production environments.",
      );
    }
    if (
      connection.projects?.length &&
      !connection.projects.includes(experiment.project || "")
    ) {
      throw new Error(
        "This SDK Connection does not include the experiment's Project",
      );
    }

    if (doc.assignment.type === "forced") {
      const variationId = doc.assignment.variationId;
      const valid = getLatestPhaseVariations(experiment).some(
        (v) => v.id === variationId,
      );
      if (!valid) throw new Error("Invalid variation for forced assignment");
    }

    if (doc.additionalTargeting) {
      const attribute = this.context.org.settings?.attributeSchema?.find(
        (a) => a.property === doc.additionalTargeting?.attribute,
      );
      if (!attribute || attribute.archived || !attribute.hashAttribute) {
        throw new Error(
          "Additional targeting must use an identifier attribute",
        );
      }
    }
  }

  private async refreshConnection(
    doc: ExperimentQaOverrideInterface,
    event: string,
    writeOptions?: WriteOptions,
  ) {
    if (writeOptions?.skipSDKRefresh) return;
    const connection = await this.getConnection(doc);
    if (!connection) return;
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: [],
      sdkConnections: [connection],
      auditContext: {
        event,
        model: "experimentQaOverride",
        id: doc.id,
      },
    });
  }

  protected async afterCreateOrUpdate(
    doc: ExperimentQaOverrideInterface,
    writeOptions?: WriteOptions,
  ) {
    await this.refreshConnection(doc, "updated", writeOptions);
  }

  protected async afterDelete(
    doc: ExperimentQaOverrideInterface,
    writeOptions?: WriteOptions,
  ) {
    await this.refreshConnection(doc, "deleted", writeOptions);
  }
}
