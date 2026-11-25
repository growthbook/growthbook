import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import {
  getNewMetricsUpdate,
  getSnapshotDataAsOfDate,
} from "shared/experiments";
import { ago, date, datetime } from "shared/dates";
import { PiEye } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import DifferenceTypeChooser from "@/components/Experiment/DifferenceTypeChooser";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

export default function PublicExperimentAnalysisSettingsBar({
  experiment,
  snapshot,
  ssrPolyfills,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  ssrPolyfills?: SSRPolyfills;
}) {
  const { t } = useLingui();
  const analysis = snapshot
    ? (getSnapshotAnalysis(snapshot) ?? undefined)
    : undefined;

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  if (!snapshot) return null;
  const lastUpdated = getSnapshotDataAsOfDate(snapshot);

  return (
    <>
      <div className="mb-1 d-flex align-items-center justify-content-end">
        <Popover
          trigger={
            <Link>
              <PiEye className="mr-1" />
              <Trans>View details</Trans>
            </Link>
          }
          align="end"
          content={
            <div style={{ minWidth: 250 }}>
              <h5>
                <Trans>Results computed with:</Trans>
              </h5>
              <Metadata
                label={t`Engine`}
                value={
                  analysis?.settings?.statsEngine === "frequentist"
                    ? t`Frequentist`
                    : t`Bayesian`
                }
              />
              <Metadata
                label="CUPED"
                value={
                  snapshot?.settings?.regressionAdjustmentEnabled
                    ? t`Enabled`
                    : t`Disabled`
                }
              />
              {analysis?.settings?.statsEngine === "frequentist" && (
                <Metadata
                  label={t`Sequential`}
                  value={
                    analysis?.settings?.sequentialTesting
                      ? t`Enabled`
                      : t`Disabled`
                  }
                />
              )}
              <div className="text-right mt-3">
                {/* Added metrics are queried through the run's end date, so
                    every number is as of the run; the later update only
                    added metrics. */}
                <Metadata label={t`Run date`} value={datetime(lastUpdated)} />
                {getNewMetricsUpdate(snapshot) ? (
                  <Metadata
                    label={t`Metrics added`}
                    value={datetime(snapshot.dateCreated)}
                  />
                ) : null}
              </div>
            </div>
          }
        />
      </div>
      <div className="py-1 d-flex mb-2">
        <div className="row align-items-center" style={{ gap: "0.5rem 1rem" }}>
          <div className="col-auto d-flex align-items-end">
            <DimensionChooser
              value={snapshot.dimension ?? ""}
              precomputedDimensions={
                snapshot.type === "standard"
                  ? snapshot.settings.dimensions.map((d) => d.id)
                  : []
              }
              activationMetric={!!snapshot.settings.activationMetric}
              datasourceId={snapshot.settings.datasourceId}
              exposureQueryId={snapshot.settings.exposureQueryId}
              userIdType={experiment?.userIdType}
              labelClassName="mr-2"
              disabled={true}
              ssrPolyfills={ssrPolyfills}
            />
          </div>
          <div className="col-auto d-flex align-items-end">
            <DifferenceTypeChooser
              differenceType={analysis?.settings?.differenceType ?? "relative"}
              disabled={true}
              phase={0}
              setDifferenceType={() => {}}
              setAnalysisSettings={() => {}}
              mutate={() => {}}
            />
          </div>
          <div className="col-auto d-flex align-items-end">
            <div>
              <div className="uppercase-title text-muted">
                <Trans>Date range</Trans>
              </div>
              <div className="relative">
                <span className="date-label">
                  {date(snapshot.settings.startDate)} —{" "}
                  {snapshot.settings.endDate
                    ? date(snapshot.settings.endDate)
                    : t`now`}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="row flex-grow-1 flex-shrink-0 pt-1 px-2 justify-content-end">
          <div className="col-auto px-0">
            {hasData ? (
              <div
                className="text-muted text-right"
                style={{ width: 130, fontSize: "0.8em" }}
                title={datetime(lastUpdated)}
              >
                <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                  <Trans>last updated</Trans>
                </div>
                <div className="d-inline-block" style={{ lineHeight: 1 }}>
                  {ago(lastUpdated)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
