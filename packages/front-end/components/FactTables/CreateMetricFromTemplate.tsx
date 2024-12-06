import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import {
  columnRefValidator,
  metricTypeValidator,
  quantileSettingsValidator,
  windowSettingsValidator,
} from "back-end/src/routers/fact-table/fact-table.validators";
import { z } from "zod";
import { ReactNode, useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import Callout from "@/components/Radix/Callout";
import { useUser } from "@/services/UserContext";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LinkButton from "@/components/Radix/LinkButton";
import Button from "@/components/Button";

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
    isProjectListValidForProject(d.projects, project)
  );

  const hasFactTables = factTables.some((f) =>
    isProjectListValidForProject(f.projects, project)
  );

  const { hasCommercialFeature } = useUser();

  const [upgradeModal, setUpgradeModal] = useState<null | {
    source: string;
    reason: string;
  }>(null);

  const [metricToCreate, setMetricToCreate] = useState<{
    data?: null | z.infer<typeof metricToCreateValidator>;
    callout?: ReactNode;
  }>(() => {
    if (
      "addMetric" in router.query &&
      typeof router.query.metric === "string"
    ) {
      try {
        const data = metricToCreateValidator.parse(
          JSON.parse(router.query.metric)
        );

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
                    reason: "To create quantile metrics,",
                  })
                }
              />
            ),
          };
        }

        if (factMetrics.some((f) => f.name === data.name)) {
          return {
            callout: (
              <Callout status="warning">
                A metric with the name &quot;{data.name}&quot; already exists.{" "}
                <Button onClick={() => setMetricToCreate({ data })}>
                  Create Anyway
                </Button>
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
            <Callout status="error">
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
          reason={upgradeModal.reason}
          source={upgradeModal.source}
        />
      ) : null}
      {metricToCreate.callout ? (
        metricToCreate.callout
      ) : metricToCreate.data ? (
        !hasDatasource ? (
          <Callout status="info">
            You must connect a SQL data source first before adding a metric.
          </Callout>
        ) : !hasFactTables ? (
          <Callout status="info">
            You must create a fact table first before adding a metric.{" "}
            <LinkButton href="/fact-tables">Manage Fact Tables</LinkButton>
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
