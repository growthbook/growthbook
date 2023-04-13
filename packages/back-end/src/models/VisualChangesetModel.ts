import { isEqual, keyBy } from "lodash";
import omit from "lodash/omit";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { ExperimentInterface, Variation } from "../../types/experiment";
import { ApiVisualChangeset } from "../../types/openapi";
import { OrganizationInterface } from "../../types/organization";
import {
  VisualChange,
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "../../types/visual-changeset";
import { EventAuditUser } from "../events/event-types";
import { refreshSDKPayloadCache } from "../services/features";
import {
  getExperimentById,
  getPayloadKeys,
  updateExperiment,
} from "./ExperimentModel";

/**
 * VisualChangeset is a collection of visual changes that are grouped together
 * by a single url target. They are many-to-one with Experiments.
 */
const visualChangesetSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  organization: {
    type: String,
    index: true,
    required: true,
  },
  urlPatterns: {
    type: [
      {
        _id: false,
        include: Boolean,
        type: {
          type: String,
          enum: ["simple", "regex"],
          required: true,
        },
        pattern: {
          type: String,
          required: true,
        },
      },
    ],
    required: true,
  },
  editorUrl: {
    type: String,
    required: true,
  },
  experiment: {
    type: String,
    index: true,
    required: true,
  },
  // VisualChanges are associated with one of the variations of the experiment
  // associated with the VisualChangeset
  visualChanges: {
    type: [
      {
        id: {
          type: String,
          required: true,
        },
        description: String,
        css: String,
        variation: {
          type: String,
          index: true,
          required: true,
        },
        domMutations: [
          {
            selector: { type: String, required: true },
            action: {
              type: String,
              enum: ["append", "set", "remove"],
              required: true,
            },
            attribute: { type: String, required: true },
            value: String,
          },
        ],
      },
    ],
    required: true,
  },
});

export type VisualChangesetDocument = mongoose.Document &
  VisualChangesetInterface;

export const VisualChangesetModel = mongoose.model<VisualChangesetDocument>(
  "VisualChangeset",
  visualChangesetSchema
);

const toInterface = (doc: VisualChangesetDocument): VisualChangesetInterface =>
  omit(doc.toJSON(), ["__v", "_id"]);

export function toVisualChangesetApiInterface(
  visualChangeset: VisualChangesetInterface
): ApiVisualChangeset {
  return {
    id: visualChangeset.id,
    urlPatterns: visualChangeset.urlPatterns,
    editorUrl: visualChangeset.editorUrl,
    experiment: visualChangeset.experiment,
    visualChanges: visualChangeset.visualChanges.map((c) => ({
      id: c.id,
      description: c.description,
      css: c.css,
      variation: c.variation,
      domMutations: c.domMutations,
    })),
  };
}

export async function findVisualChangesetById(
  id: string,
  organization: string
): Promise<VisualChangesetInterface | null> {
  const visualChangeset = await VisualChangesetModel.findOne({
    organization,
    id,
  });
  return visualChangeset ? toInterface(visualChangeset) : null;
}

export async function findVisualChangesetsByExperiment(
  experiment: string,
  organization: string
): Promise<VisualChangesetInterface[]> {
  const visualChangesets = await VisualChangesetModel.find({
    experiment,
    organization,
  });
  return visualChangesets.map(toInterface);
}

export async function findVisualChangesets(
  organization: string
): Promise<VisualChangesetInterface[]> {
  return (
    await VisualChangesetModel.find({
      organization,
    })
  ).map(toInterface);
}

export async function createVisualChange(
  id: string,
  organization: string,
  visualChange: VisualChange
): Promise<{ nModified: number }> {
  const visualChangeset = await VisualChangesetModel.findOne({
    id,
    organization,
  });

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const res = await VisualChangesetModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: {
        visualChanges: [...visualChangeset.visualChanges, visualChange],
      },
    }
  );

  return { nModified: res.nModified };
}

export async function updateVisualChange({
  changesetId,
  visualChangeId,
  organization,
  payload,
}: {
  changesetId: string;
  visualChangeId: string;
  organization: string;
  payload: Partial<VisualChange>;
}): Promise<{ nModified: number }> {
  const visualChangeset = await findVisualChangesetById(
    changesetId,
    organization
  );

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const visualChanges = visualChangeset.visualChanges.map((visualChange) => {
    if (visualChange.id === visualChangeId) {
      return {
        ...visualChange,
        ...payload,
      };
    }
    return visualChange;
  });

  const res = await VisualChangesetModel.updateOne(
    {
      id: changesetId,
      organization,
    },
    {
      $set: { visualChanges },
    }
  );

  return { nModified: res.nModified };
}

const genNewVisualChange = (variation: Variation): VisualChange => ({
  id: uniqid("vc_"),
  variation: variation.id,
  description: "",
  css: "",
  domMutations: [],
});

export const createVisualChangeset = async ({
  experiment,
  organization,
  urlPatterns,
  editorUrl,
  user,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
  urlPatterns: VisualChangesetURLPattern[];
  editorUrl: VisualChangesetInterface["editorUrl"];
  user: EventAuditUser;
}): Promise<VisualChangesetInterface> => {
  const visualChangeset = toInterface(
    await VisualChangesetModel.create({
      id: uniqid("vcs_"),
      experiment: experiment.id,
      organization: organization.id,
      urlPatterns,
      editorUrl,
      visualChanges: experiment.variations.map(genNewVisualChange),
    })
  );

  // mark the experiment as having a visual changeset
  if (!experiment.hasVisualChangesets) {
    await updateExperiment({
      organization,
      experiment,
      changes: { hasVisualChangesets: true },
      user,
      bypassWebhooks: true,
    });
  }

  await onVisualChangesetCreate({
    organization,
    visualChangeset,
    experiment,
  });

  return visualChangeset;
};

// type guard
const _isUpdatingVisualChanges = (
  updates: Partial<VisualChangesetInterface>
): updates is {
  visualChanges: VisualChange[];
} & Partial<VisualChangesetInterface> =>
  updates.visualChanges !== undefined && updates.visualChanges.length > 0;

export const updateVisualChangeset = async ({
  changesetId,
  organization,
  updates,
  bypassWebhooks,
  user,
}: {
  changesetId: string;
  organization: OrganizationInterface;
  updates: Partial<VisualChangesetInterface>;
  bypassWebhooks?: boolean;
  user: EventAuditUser;
}) => {
  const visualChangeset = await findVisualChangesetById(
    changesetId,
    organization.id
  );

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const isUpdatingVisualChanges = _isUpdatingVisualChanges(updates);

  // ensure new visual changes have ids assigned
  const visualChanges = isUpdatingVisualChanges
    ? updates.visualChanges.map((vc) => ({
        ...vc,
        id: vc.id || uniqid("vc_"),
      }))
    : [];

  const res = await VisualChangesetModel.updateOne(
    {
      id: changesetId,
      organization: organization.id,
    },
    {
      $set: {
        ...updates,
        ...(isUpdatingVisualChanges ? { visualChanges } : {}),
      },
    }
  );

  // double-check that the experiment is marked as having visual changesets
  const experiment = await getExperimentById(
    organization.id,
    visualChangeset.experiment
  );
  if (experiment && !experiment.hasVisualChangesets) {
    await updateExperiment({
      organization,
      experiment,
      user,
      changes: { hasVisualChangesets: true },
      bypassWebhooks: true,
    });
  }

  await onVisualChangesetUpdate({
    oldVisualChangeset: visualChangeset,
    newVisualChangeset: {
      ...visualChangeset,
      ...updates,
      ...(isUpdatingVisualChanges ? { visualChanges } : {}),
    },
    organization,
    bypassWebhooks,
  });

  return { nModified: res.nModified, visualChanges };
};

const hasVisualChanges = ({ visualChanges }: VisualChangesetInterface) =>
  visualChanges.some((vc) => !!vc.css || !!vc.domMutations.length);

const onVisualChangesetCreate = async ({
  organization,
  visualChangeset,
  experiment,
}: {
  organization: OrganizationInterface;
  visualChangeset: VisualChangesetInterface;
  experiment: ExperimentInterface;
}) => {
  if (!hasVisualChanges(visualChangeset)) return;

  const payloadKeys = getPayloadKeys(organization, experiment);

  await refreshSDKPayloadCache(organization, payloadKeys);
};

const onVisualChangesetUpdate = async ({
  organization,
  oldVisualChangeset,
  newVisualChangeset,
  bypassWebhooks = false,
}: {
  organization: OrganizationInterface;
  oldVisualChangeset: VisualChangesetInterface;
  newVisualChangeset: VisualChangesetInterface;
  bypassWebhooks?: boolean;
}) => {
  if (bypassWebhooks) return;

  // if no visual changes or url patterns changes, return early
  const oldVisualChanges = oldVisualChangeset.visualChanges.map(
    ({ css, domMutations }) => ({ css, domMutations })
  );
  const newVisualChanges = newVisualChangeset.visualChanges.map(
    ({ css, domMutations }) => ({ css, domMutations })
  );
  const hasNoVisualChanges = isEqual(oldVisualChanges, newVisualChanges);

  const hasNoUrlPatternsChanges = isEqual(
    oldVisualChangeset.urlPatterns,
    newVisualChangeset.urlPatterns
  );

  if (hasNoVisualChanges && hasNoUrlPatternsChanges) return;

  const experiment = await getExperimentById(
    organization.id,
    newVisualChangeset.experiment
  );

  if (!experiment) return;

  const payloadKeys = getPayloadKeys(organization, experiment);

  await refreshSDKPayloadCache(organization, payloadKeys);
};

const onVisualChangesetDelete = async ({
  organization,
  visualChangeset,
}: {
  organization: OrganizationInterface;
  visualChangeset: VisualChangesetInterface;
}) => {
  // if there were no visual changes before deleting, return early
  if (!hasVisualChanges(visualChangeset)) return;

  // get payload keys
  const experiment = await getExperimentById(
    organization.id,
    visualChangeset.experiment
  );

  if (!experiment) return;

  const payloadKeys = getPayloadKeys(organization, experiment);

  await refreshSDKPayloadCache(organization, payloadKeys);
};

// when an experiment adds/removes variations, we need to update the analogous
// visual changes to be in sync
export const syncVisualChangesWithVariations = async ({
  experiment,
  organization,
  visualChangeset,
  user,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
  visualChangeset: VisualChangesetInterface;
  user: EventAuditUser;
}) => {
  const { variations } = experiment;
  const { visualChanges } = visualChangeset;
  const visualChangesByVariationId = keyBy(visualChanges, "variation");
  const newVisualChanges = variations.map((variation) => {
    const visualChange = visualChangesByVariationId[variation.id];
    return visualChange ? visualChange : genNewVisualChange(variation);
  });

  await updateVisualChangeset({
    organization,
    changesetId: visualChangeset.id,
    updates: { visualChanges: newVisualChanges },
    // bypass webhooks since we are only creating new (empty) visual changes
    bypassWebhooks: true,
    user,
  });
};

export const deleteVisualChangesetById = async ({
  changesetId,
  organization,
  user,
}: {
  changesetId: string;
  organization: OrganizationInterface;
  user: EventAuditUser;
}) => {
  const visualChangeset = await findVisualChangesetById(
    changesetId,
    organization.id
  );

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  await VisualChangesetModel.deleteOne({
    id: changesetId,
    organization: organization.id,
  });

  // if experiment has no more visual changesets, update experiment
  const remainingVisualChangesets = await findVisualChangesetsByExperiment(
    visualChangeset.experiment,
    organization.id
  );
  if (remainingVisualChangesets.length === 0) {
    const experiment = await getExperimentById(
      organization.id,
      visualChangeset.experiment
    );
    if (experiment && experiment.hasVisualChangesets) {
      await updateExperiment({
        organization,
        experiment,
        changes: { hasVisualChangesets: false },
        bypassWebhooks: true,
        user,
      });
    }
  }

  await onVisualChangesetDelete({
    organization,
    visualChangeset,
  });
};
