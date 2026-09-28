import { keyBy } from "lodash";
import {
  getLinkedChangeEnvs,
  implementationTypeAfterUnlink,
} from "shared/util";
import { isURLTargeted } from "@growthbook/growthbook";
import { getLatestPhaseVariations } from "shared/experiments";
import { ExperimentInterface, Variation } from "shared/types/experiment";
import {
  DestinationURL,
  URLRedirectInterface,
} from "shared/types/url-redirect";
import { urlRedirectValidator } from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { BadRequestError } from "back-end/src/util/errors";
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

type RedirectTarget = Pick<
  URLRedirectInterface,
  "urlPattern" | "destinationURLs"
>;

export function assertRedirectOrigin(
  redirect: Pick<RedirectTarget, "urlPattern">,
) {
  if (!redirect.urlPattern) {
    throw new BadRequestError("A URL Redirect needs an origin URL.");
  }
}

// Each variation needs a destination; `exact` also refuses a destination for a
// variation the experiment doesn't have, or a second one for the same variation.
export function assertRedirectDestinations(
  redirect: RedirectTarget,
  variationIds: string[],
  { exact }: { exact: boolean },
) {
  const given = redirect.destinationURLs.map((d) => d.variation);
  const covers = variationIds.every((v) => given.includes(v));
  if (!covers || (exact && given.length !== variationIds.length)) {
    throw new BadRequestError(
      `The URL Redirect from ${redirect.urlPattern} needs one destination for each variation.`,
    );
  }
}

// Refuses a redirect that would chain into or out of one of `others`.
export function assertNoRedirectLoop(
  redirect: RedirectTarget,
  others: RedirectTarget[],
) {
  const origin = redirect.urlPattern;
  const matches = (url: string, pattern: string) =>
    isURLTargeted(url, [{ type: "simple", pattern, include: true }]);
  for (const other of others) {
    const theOther = `the one from ${other.urlPattern}`;
    if (matches(origin, other.urlPattern)) {
      throw new BadRequestError(
        `The URL Redirect from ${origin} matches the origin of ${theOther}.`,
      );
    }
    if (other.destinationURLs.some((d) => matches(d.url, origin))) {
      throw new BadRequestError(
        `The URL Redirect from ${origin} matches a destination of ${theOther}.`,
      );
    }
    if (
      redirect.destinationURLs.some((d) => matches(d.url, other.urlPattern))
    ) {
      throw new BadRequestError(
        `A destination of the URL Redirect from ${origin} matches the origin of ${theOther}.`,
      );
    }
  }
}

// What syncURLRedirectsWithVariations leaves once an experiment's variations change.
export function syncedDestinationURLs(
  destinationURLs: DestinationURL[],
  variations: Pick<Variation, "id">[],
): DestinationURL[] {
  const byVariationId = keyBy(destinationURLs, "variation");
  return variations.map(
    (variation) =>
      byVariationId[variation.id] ?? { variation: variation.id, url: "" },
  );
}

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

  public countByExperiment(experiment: string): Promise<number> {
    return this._countDocuments({ experiment });
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
    return this.context.permissions.canRunExperiment(
      experiment,
      getLinkedChangeEnvs(),
    );
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
    assertRedirectDestinations(
      doc,
      getLatestPhaseVariations(experiment).map((v) => v.id),
      { exact: false },
    );
  }

  protected async customValidation(
    doc: URLRedirectInterface,
    previousDoc?: URLRedirectInterface,
    writeOptions?: WriteOptions,
  ) {
    assertRedirectOrigin(doc);
    if (writeOptions?.checkCircularDependencies) {
      assertNoRedirectLoop(
        doc,
        (await this.getServedRedirects()).filter((r) => r.id !== doc.id),
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
        const after = { ...experiment, hasURLRedirects: false };
        await updateExperiment({
          context: this.context,
          experiment,
          changes: {
            hasURLRedirects: false,
            implementationType: implementationTypeAfterUnlink(after),
          },
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
    return await this.update(
      urlRedirect,
      {
        destinationURLs: syncedDestinationURLs(
          urlRedirect.destinationURLs,
          experiment.variations,
        ),
      },
      // The SDK was already refreshed by the experiment change
      { skipSDKRefresh: true },
    );
  }

  // The redirects SDKs serve, which a new one must not loop with.
  public async getServedRedirects(): Promise<URLRedirectInterface[]> {
    const payloadExperiments = await getAllPayloadExperiments(this.context);
    const served = await getAllURLRedirectExperiments(
      this.context,
      payloadExperiments,
    );
    return served.map((r) => r.urlRedirect);
  }
}
