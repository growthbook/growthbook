import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import {
  columnRefValidator,
  metricTypeValidator,
  quantileSettingsValidator,
  windowSettingsValidator,
} from "shared/validators";
import { z } from "zod";
import { ReactNode, useState } from "react";
import dJSON from "dirty-json";
import { CommercialFeature } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Link from "@/ui/Link";

const metricToCreateValidator = z.object({
  metricType: metricTypeValidator,
  name: z.string(),
  numerator: columnRefValidator,
  denominator: columnRefValidator.optional(),
  inverse: z.boolean().optional(),
  description: z.string().optional(),
  quantileSettings: quantileSettingsValidator.optional(),
  windowSettings: windowSettingsValidator.optional(),
});

export default function CreateMetricFromTemplate() {
  const { datasources, project, factTables, factMetrics } = useDefinitions();
  const router = useRouter();

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project),
  );

  const hasFactTables = factTables.some((f) =>
    isProjectListValidForProject(f.projects, project),
  );

  const { hasCommercialFeature } = useUser();

  const [upgradeModal, setUpgradeModal] = useState<null | {
    source: string;
    commercialFeature: CommercialFeature;
  }>(null);

  const QUERY_KEY = "addMetric";

  const [metricToCreate, setMetricToCreate] = useState<{
    data?: null | z.infer<typeof metricToCreateValidator>;
    callout?: ReactNode;
  }>(() => {
    if (
      QUERY_KEY in router.query &&
      typeof router.query[QUERY_KEY] === "string"
    ) {
      try {
        const json = dJSON.parse(router.query[QUERY_KEY]);

        if (json.numerator) {
          json.numerator.factTableId = "";
          json.numerator.rowFilters = json.numerator.rowFilters || [];

          if (
            json.metricType === "proportion" ||
            json.metricType === "retention"
          ) {
            json.numerator.column = "$$distinctUsers";
          } else {
            json.numerator.column = json.numerator.column || "";
          }
        }
        if (json.denominator) {
          json.denominator.factTableId = "";
          json.denominator.rowFilters = json.denominator.rowFilters || [];
          json.denominator.column = json.denominator.column || "";
        }

        const data = metricToCreateValidator.parse(json);

        if (
          data.metricType === "quantile" &&
          !hasCommercialFeature("quantile-metrics")
        ) {
          return {
            callout: (
              <UpgradeMessage
                commercialFeature="quantile-metrics"
                upgradeMessage="create quantile metrics"
                showUpgradeModal={() =>
                  setUpgradeModal({
                    source: "metric-template-quantile",
                    commercialFeature: "quantile-metrics",
                  })
                }
              />
            ),
          };
        }

        if (
          data.metricType === "retention" &&
          !hasCommercialFeature("retention-metrics")
        ) {
          return {
            callout: (
              <UpgradeMessage
                commercialFeature="retention-metrics"
                upgradeMessage="create retention metrics"
                showUpgradeModal={() =>
                  setUpgradeModal({
                    source: "metric-template-retention",
                    commercialFeature: "retention-metrics",
                  })
                }
              />
            ),
          };
        }

        if (factMetrics.some((f) => f.name === data.name)) {
          return {
            callout: (
              <Callout status="warning" mb="3">
                A metric with the name &quot;{data.name}&quot; already exists.{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setMetricToCreate({ data });
                  }}
                >
                  Create Anyway
                </a>
              </Callout>
            ),
          };
        }

        return {
          data,
        };
      } catch (e) {
        return {
          callout: (
            <Callout status="error" mb="3">
              Failed to parse metric template: {e.message}
            </Callout>
          ),
        };
      }
    }
    return {};
  });

  return (
    <div>
      {upgradeModal ? (
        <UpgradeModal
          close={() => setUpgradeModal(null)}
          source={upgradeModal.source}
          commercialFeature={upgradeModal.commercialFeature}
        />
      ) : null}
      {metricToCreate.callout ? (
        metricToCreate.callout
      ) : metricToCreate.data ? (
        !hasDatasource ? (
          <Callout status="info" mb="3">
            You must connect a SQL data source first before adding a metric.
          </Callout>
        ) : !hasFactTables ? (
          <Callout status="info" mb="3">
            You must create a fact table first before adding a metric.{" "}
            <Link href="/fact-tables">Manage Fact Tables</Link>
          </Callout>
        ) : metricToCreate.data ? (
          <FactMetricModal
            source="querystring"
            close={() => setMetricToCreate({ data: null })}
            fromTemplate={true}
            existing={metricToCreate.data}
          />
        ) : null
      ) : null}
    </div>
  );
}
