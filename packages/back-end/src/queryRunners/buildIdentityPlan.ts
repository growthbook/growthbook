import type { Dimension, IdentityPlan } from "shared/types/integrations";
import { getBaseIdTypeAndJoins } from "back-end/src/util/sql";

function buildIdentityPlan({
  objects,
  forcedBaseIdType,
  availableIdJoins,
}: {
  objects: string[][];
  forcedBaseIdType?: string;
  availableIdJoins?: { ids: string[] }[];
}): IdentityPlan {
  const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
    objects,
    forcedBaseIdType,
    availableIdJoins,
    [],
  );

  return {
    baseIdType: baseIdType || "",
    joinsRequired,
    idJoinMap: Object.fromEntries(
      joinsRequired.map((idType) => [
        idType,
        `__identities_${idType.replace(/[^a-zA-Z0-9_]/g, "")}`,
      ]),
    ),
  };
}

function getUserDimensionIdObjects(dimensions: Dimension[] = []): string[][] {
  return dimensions
    .filter((d): d is Extract<Dimension, { type: "user" }> => d.type === "user")
    .map((d) => [d.dimension.userIdType || "user_id"]);
}

export function createIdentityPlanBuilder({
  exposureBaseIdType,
  availableIdJoins,
  activationIdTypes,
  segmentUserIdType,
  forcedBaseIdType,
}: {
  exposureBaseIdType: string;
  availableIdJoins?: { ids: string[] }[];
  activationIdTypes?: string[];
  segmentUserIdType?: string;
  forcedBaseIdType?: string;
}) {
  const baseObjects = [[exposureBaseIdType]];
  const activationObjects = activationIdTypes?.length
    ? [activationIdTypes]
    : [];
  const segmentObjects = segmentUserIdType ? [[segmentUserIdType]] : [];
  const resolvedForcedBaseIdType = forcedBaseIdType || exposureBaseIdType;

  return ({
    metricObjects = [],
    unitDimensions = [],
    includeActivation = true,
    includeSegment = true,
  }: {
    metricObjects?: string[][];
    unitDimensions?: Dimension[];
    includeActivation?: boolean;
    includeSegment?: boolean;
  }): IdentityPlan =>
    buildIdentityPlan({
      objects: [
        ...baseObjects,
        ...metricObjects,
        ...getUserDimensionIdObjects(unitDimensions),
        ...(includeSegment ? segmentObjects : []),
        ...(includeActivation ? activationObjects : []),
      ],
      forcedBaseIdType: resolvedForcedBaseIdType,
      availableIdJoins,
    });
}
