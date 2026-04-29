import { ExperimentMetricInterface, getUserIdTypes } from "shared/experiments";
import { MetricInterface } from "shared/types/metric";
import { Dimension } from "shared/types/integrations";
import { SegmentInterface } from "shared/types/segment";
import { ExposureQuery } from "shared/types/datasource";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { getBaseIdTypeAndJoins } from "back-end/src/util/sql";
import { IdentityPlan } from "back-end/src/integrations/sql/ctes/identities-cte";

type IdentityJoin = { ids: string[] };

export type IdentityQueryBuilderArgs = {
  identityJoins?: IdentityJoin[];
  factTableMap: FactTableMap;
  exposureQuery: ExposureQuery;
  activationMetric?: ExperimentMetricInterface | null;
  segment?: SegmentInterface | null;
  unitDimensions?: Dimension[];
  forcedBaseIdType?: string;
};

export class IdentityQueryBuilder {
  constructor(private readonly args: IdentityQueryBuilderArgs) {}

  buildForAnalysis(
    args: {
      metrics?: ExperimentMetricInterface[];
      denominatorMetrics?: MetricInterface[];
      dimensions?: Dimension[];
    } = {},
  ): IdentityPlan {
    const dimensions = args.dimensions ?? this.args.unitDimensions ?? [];
    const objects: string[][] = [[this.args.exposureQuery.userIdType]];
    const preferredIdTypes = new Set<string>();

    if (this.args.activationMetric) {
      const activationUserIdTypes = getUserIdTypes(
        this.args.activationMetric,
        this.args.factTableMap,
      );
      objects.push(activationUserIdTypes);
      activationUserIdTypes.forEach((idType) => preferredIdTypes.add(idType));
    }

    if (this.args.segment?.userIdType) {
      objects.push([this.args.segment.userIdType]);
      preferredIdTypes.add(this.args.segment.userIdType);
    }

    dimensions
      .filter((dimension) => dimension.type === "user")
      .forEach((dimension) => {
        const idType = dimension.dimension.userIdType || "user_id";
        objects.push([idType]);
        preferredIdTypes.add(idType);
      });

    (args.metrics || []).forEach((metric) => {
      objects.push(getUserIdTypes(metric, this.args.factTableMap));
    });

    (args.denominatorMetrics || []).forEach((metric) => {
      objects.push(
        getUserIdTypes(
          metric as unknown as ExperimentMetricInterface,
          this.args.factTableMap,
          true,
        ),
      );
    });

    const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
      objects,
      this.args.forcedBaseIdType || this.args.exposureQuery.userIdType,
      this.args.identityJoins,
      Array.from(preferredIdTypes),
    );

    const idJoinMap = Object.fromEntries(
      joinsRequired.map((idType) => [
        idType,
        `__identities_${idType.replace(/[^a-zA-Z0-9_]/g, "")}`,
      ]),
    );

    return {
      baseIdType,
      joinsRequired,
      idJoinMap,
    };
  }
}
