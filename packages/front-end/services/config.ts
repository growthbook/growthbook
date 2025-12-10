import { MetricInterface } from "back-end/types/metric";
import { useMemo } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { OrganizationSettings } from "back-end/types/organization";
import { SegmentInterface } from "shared/types/segment";

type Props = {
  metrics: MetricInterface[];
  dimensions: DimensionInterface[];
  datasources: DataSourceInterfaceWithParams[];
  settings: OrganizationSettings;
  segments: SegmentInterface[];
};

export function useConfigJson({
  metrics,
  dimensions,
  datasources,
  settings,
  segments,
}: Props) {
  return useMemo(() => {
    const config: {
      organization: {
        settings: OrganizationSettings;
      };
      datasources?: Record<string, Partial<DataSourceInterfaceWithParams>>;
      metrics?: Record<string, Partial<MetricInterface>>;
      dimensions?: Record<string, Partial<DimensionInterface>>;
      segments?: Record<string, Partial<SegmentInterface>>;
    } = {
      organization: { settings },
    };

    const datasourceIds: string[] = [];
    if (datasources.length) {
      config.datasources = datasources.reduce((datasources, d) => {
        datasourceIds.push(d.id);

        return {
          ...datasources,
          [d.id]: {
            type: d.type,
            name: d.name,
            params: d.params,
            settings: d.settings,
          } as Partial<DataSourceInterfaceWithParams>,
        };
      }, {});
    }

    if (segments?.length) {
      config.segments = segments?.reduce(
        (segments, s) => ({
          ...segments,
          [s.id]: {
            name: s.name,
            datasource: s.datasource,
            owner: s.owner,
            sql: s.sql,
            userIdType: s.userIdType,
          } as Partial<SegmentInterface>,
        }),
        {},
      );
    }

    if (metrics.length) {
      config.metrics = metrics.reduce((metrics, m) => {
        if (m.datasource && !datasourceIds.includes(m.datasource))
          return metrics;

        const met: Partial<MetricInterface> = {
          type: m.type,
          name: m.name,
        };

        const fields: (keyof MetricInterface)[] = [
          "datasource",
          "description",
          "ignoreNulls",
          "inverse",
          "aggregation",
          "cappingSettings",
          "windowSettings",
          "regressionAdjustmentOverride",
          "regressionAdjustmentEnabled",
          "regressionAdjustmentDays",
          "loseRisk",
          "winRisk",
          "maxPercentChange",
          "minPercentChange",
          "minSampleSize",
          "targetMDE",
          "userIdTypes",
          "tags",
          "denominator",
          "conditions",
          "sql",
          "queryFormat",
          "timestampColumn",
          "userIdColumns",
          "table",
          "column",
        ];

        fields.forEach((f) => {
          const v = m[f];
          if (!v) return;
          if (Array.isArray(v) && !v.length) return;
          // eslint-disable-next-line
          (met[f] as any) = v;
        });

        return { ...metrics, [m.id]: met };
      }, {});
    }

    if (dimensions.length) {
      config.dimensions = dimensions.reduce((dimensions, d) => {
        if (d.datasource && !datasourceIds.includes(d.datasource))
          return dimensions;

        return {
          ...dimensions,
          [d.id]: {
            name: d.name,
            datasource: d.datasource,
            sql: d.sql,
            userIdType: d.userIdType || "user_id",
          },
        };
      }, {});
    }

    return config;
  }, [metrics, dimensions, datasources, settings, segments]);
}
