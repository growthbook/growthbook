import { isEqual, keyBy, pick } from "lodash";
import { getAffectedEnvsForExperiment } from "shared/util";
import { isURLTargeted } from "@growthbook/growthbook";
import { getLatestPhaseVariations } from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import {
  DestinationURL,
  URLRedirectInterface,
} from "shared/types/url-redirect";
import {
  apiCreateUrlRedirectBody,
  apiUpdateUrlRedirectBody,
  urlRedirectValidator,
} from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { urlRedirectApiSpec } from "back-end/src/api/specs/url-redirect.spec";
import {
  getAllPayloadExperiments,
  getAllURLRedirectExperiments,
  getPayloadKeys,
  updateExperiment,
} from "./ExperimentModel";
import { MakeModelClass } from "./BaseModel";

type WriteOptions = {
  checkCircularDependencies?: boolean;
  skipSDKRefresh?: boolean;
};

const BaseClass = MakeModelClass({
  schema: urlRedirectValidator,
  collectionName: "urlredirects",
  idPrefix: "url_",
  auditLog: {
    entity: "urlRedirect",
    createEvent: "urlRedirect.create",
    updateEvent: "urlRedirect.update",
    deleteEvent: "urlRedirect.delete",
  },
  globallyUniquePrimaryKeys: false,
  readonlyFields: ["experiment"],
  apiConfig: {
    modelKey: "urlRedirects",
    openApiSpec: urlRedirectApiSpec,
  },
});

export class UrlRedirectModel extends BaseClass<WriteOptions> {
  public findByExperiment(experiment: string) {
    // Assume we already checked read permissions for the experiment
    return this._find({ experiment }, { bypassReadPermissionChecks: true });
  }

  public countByExperiment(experiment: string): Promise<number> {
    return this._countDocuments({ experiment });
  }

  protected toApiInterface(doc: URLRedirectInterface) {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      experiment: doc.experiment,
      urlPattern: doc.urlPattern,
      destinationURLs: doc.destinationURLs,
      persistQueryString: doc.persistQueryString,
    };
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ) {
    const { experimentId } = req.query;
    const docs = experimentId
      ? await this._find({ experiment: experimentId })
      : await this.getAll();
    return docs.map((doc) => this.toApiInterface(doc));
  }

  // REST writes check for redirect loops; the app asks for it per request.
  public override async handleApiCreate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiCreate"]>[0],
  ) {
    const body = apiCreateUrlRedirectBody.parse(req.body);
    const doc = await this.create(
      { ...body, persistQueryString: body.persistQueryString ?? false },
      { checkCircularDependencies: true },
    );
    return this.toApiInterface(doc);
  }

  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ) {
    // Only the writable fields; read-only GET fields are accepted and ignored
    const updates = pick(apiUpdateUrlRedirectBody.parse(req.body), [
      "urlPattern",
      "destinationURLs",
      "persistQueryString",
    ]);
    const existing = await this.getById(req.params.id);
    if (!existing) req.context.throwNotFoundError();
    const destinationsChanged =
      updates.destinationURLs !== undefined &&
      !isEqual(updates.destinationURLs, existing.destinationURLs);
    if (updates.destinationURLs !== undefined && destinationsChanged) {
      this.assertEveryVariationHasDestination({
        ...existing,
        destinationURLs: updates.destinationURLs,
      });
    }
    // Unchanged URLs skip the loop check so redirects saved without it round-trip
    const urlsChanged =
      (updates.urlPattern !== undefined &&
        updates.urlPattern !== existing.urlPattern) ||
      destinationsChanged;
    const doc = await this.update(existing, updates, {
      checkCircularDependencies: urlsChanged,
    });
    return this.toApiInterface(doc);
  }

  protected canRead(doc: URLRedirectInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  // Create/Update/Delete all do the exact same permission check
  private canWrite(
    doc: URLRedirectInterface,
    { willHaveRedirects = false } = {},
  ): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    const envs = getAffectedEnvsForExperiment({
      experiment: willHaveRedirects
        ? { ...experiment, hasURLRedirects: true }
        : experiment,
      orgEnvironments: this.context.org.settings?.environments || [],
    });
    return this.context.permissions.canRunExperiment(experiment, envs);
  }
  protected canCreate(doc: URLRedirectInterface): boolean {
    // The first redirect flips hasURLRedirects, which reaches every environment
    return this.canWrite(doc, { willHaveRedirects: true });
  }
  protected canUpdate(doc: URLRedirectInterface): boolean {
    return this.canWrite(doc);
  }
  protected canDelete(doc: URLRedirectInterface): boolean {
    return this.canWrite(doc);
  }

  protected async beforeCreate(doc: URLRedirectInterface) {
    this.assertEveryVariationHasDestination(doc);
  }

  private assertEveryVariationHasDestination(doc: URLRedirectInterface) {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) {
      throw new Error("Could not find experiment");
    }
    const variationIds = getLatestPhaseVariations(experiment).map((v) => v.id);
    const reqVariationIds = doc.destinationURLs.map((r) => r.variation);

    const areValidVariations = variationIds.every((v) =>
      reqVariationIds.includes(v),
    );
    if (!areValidVariations) {
      throw new Error("Invalid variation IDs for urlRedirects");
    }
  }

  protected async customValidation(
    doc: URLRedirectInterface,
    previousDoc?: URLRedirectInterface,
    writeOptions?: WriteOptions,
  ) {
    if (!doc.urlPattern) {
      throw new Error("url pattern cannot be empty");
    }

    if (writeOptions?.checkCircularDependencies) {
      await this.checkCircularDependencies(
        doc.urlPattern,
        doc.destinationURLs,
        doc.id,
      );
    }
  }

  protected async afterCreateOrUpdate(
    doc: URLRedirectInterface,
    writeOptions?: WriteOptions,
  ) {
    let { experiment } = this.getForeignRefs(doc);
    if (!experiment) return;

    if (!experiment.hasURLRedirects) {
      // Important: update the experiment variable to the updated version
      // This way, `hasURLRedirects` will be true, which will force the SDK to update
      experiment = await updateExperiment({
        context: this.context,
        experiment,
        changes: { hasURLRedirects: true },
        bypassWebhooks: true,
      });
    }

    if (!writeOptions?.skipSDKRefresh) {
      const payloadKeys = getPayloadKeys(this.context, experiment);
      queueSDKPayloadRefresh({
        context: this.context,
        payloadKeys,
        auditContext: {
          event: "created/updated",
          model: "urlredirect",
          id: doc.id,
        },
      });
    }
  }

  protected async afterDelete(doc: URLRedirectInterface) {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return;

    const remaining = await this.findByExperiment(doc.experiment);
    if (remaining.length === 0) {
      if (experiment.hasURLRedirects) {
        await updateExperiment({
          context: this.context,
          experiment,
          changes: { hasURLRedirects: false },
          bypassWebhooks: true,
        });
      }
    }

    // Important: pass the old `experiment` object before doing the update
    // The updated experiment has `hasURLRedirects: false`, which may stop the SDK from updating
    const payloadKeys = getPayloadKeys(this.context, experiment);
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys,
      auditContext: {
        event: "deleted",
        model: "urlredirect",
        id: doc.id,
      },
    });
  }

  // When an experiment adds/removes variations, we need to update
  // url redirect changes to be in sync
  public async syncURLRedirectsWithVariations(
    urlRedirect: URLRedirectInterface,
    experiment: ExperimentInterface,
  ) {
    const { variations } = experiment;
    const { destinationURLs } = urlRedirect;
    const byVariationId = keyBy(destinationURLs, "variation");
    const newDestinationURLs = variations.map((variation) => {
      const destination = byVariationId[variation.id];
      return destination ? destination : { variation: variation.id, url: "" };
    });

    return await this.update(
      urlRedirect,
      {
        destinationURLs: newDestinationURLs,
      },
      // The SDK was already refreshed by the experiment change
      { skipSDKRefresh: true },
    );
  }

  private async checkCircularDependencies(
    origin: string,
    destinations: DestinationURL[],
    urlRedirectId?: string,
  ) {
    // Org-wide: an SDK connection can serve a project the caller can't read.
    // Only the generic messages below are surfaced, never a hidden record.
    const payloadExperiments = await getAllPayloadExperiments(
      this.context,
      undefined,
      [],
      { bypassReadPermissionChecks: true },
    );
    const urlRedirects = await getAllURLRedirectExperiments(
      this.context,
      payloadExperiments,
      await this._find({}, { bypassReadPermissionChecks: true }),
    );
    const originUrl = origin;

    const existingRedirects = urlRedirects.filter(
      (r) => r.urlRedirect.id !== urlRedirectId,
    );

    existingRedirects.forEach((existing) => {
      if (
        isURLTargeted(originUrl, [
          {
            type: "simple",
            pattern: existing.urlRedirect.urlPattern,
            include: true,
          },
        ])
      ) {
        throw new Error(
          "Origin URL matches an existing redirect's origin URL.",
        );
      }
      existing.urlRedirect.destinationURLs?.forEach((d) => {
        if (
          isURLTargeted(d.url, [
            {
              type: "simple",
              pattern: origin,
              include: true,
            },
          ])
        ) {
          throw new Error(
            "Origin URL targets the destination url of an existing redirect.",
          );
        }
      });
      destinations.forEach((dest) => {
        if (
          isURLTargeted(dest.url, [
            {
              type: "simple",
              pattern: existing.urlRedirect.urlPattern,
              include: true,
            },
          ])
        ) {
          throw new Error(
            "Origin URL of an existing redirect targets a destination URL in this redirect.",
          );
        }
      });
    });
  }
}
