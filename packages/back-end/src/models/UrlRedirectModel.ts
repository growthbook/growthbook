import { keyBy } from "lodash";
import { getAffectedEnvsForExperiment } from "shared/util";
import { isURLTargeted } from "@growthbook/growthbook";
import { ExperimentInterface } from "shared/types/experiment";
import {
  DestinationURL,
  URLRedirectInterface,
} from "shared/types/url-redirect";
import { urlRedirectValidator } from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
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
});

export class UrlRedirectModel extends BaseClass<WriteOptions> {
  public findByExperiment(experiment: string) {
    // Assume we already checked read permissions for the experiment
    return this._find({ experiment }, { bypassReadPermissionChecks: true });
  }

  protected canRead(doc: URLRedirectInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  // Create/Update/Delete all do the exact same permission check
  private canWrite(doc: URLRedirectInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) throw new Error("Could not find experiment");
    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: this.context.org.settings?.environments || [],
    });
    return this.context.permissions.canRunExperiment(experiment, envs);
  }
  protected canCreate(doc: URLRedirectInterface): boolean {
    return this.canWrite(doc);
  }
  protected canUpdate(doc: URLRedirectInterface): boolean {
    return this.canWrite(doc);
  }
  protected canDelete(doc: URLRedirectInterface): boolean {
    return this.canWrite(doc);
  }

  protected async beforeCreate(doc: URLRedirectInterface) {
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) {
      throw new Error("Could not find experiment");
    }
    const variationIds = experiment.variations.map((v) => v.id);
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
    const payloadExperiments = await getAllPayloadExperiments(this.context);
    const urlRedirects = await getAllURLRedirectExperiments(
      this.context,
      payloadExperiments,
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
