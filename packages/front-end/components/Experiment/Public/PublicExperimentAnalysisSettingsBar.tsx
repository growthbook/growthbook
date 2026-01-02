import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { ago, date, datetime } from "shared/dates";
import { PiEye } from "react-icons/pi";
import {ExperimentInterfaceStringDates} from "shared/types/experiment";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import DifferenceTypeChooser from "@/components/Experiment/DifferenceTypeChooser";
import { DropdownMenu } from "@/ui/DropdownMenu";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";

export default function PublicExperimentAnalysisSettingsBar({
  experiment,
  snapshot,
  ssrPolyfills,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  ssrPolyfills?: SSRPolyfills;
}) {
  const analysis = snapshot
    ? getSnapshotAnalysis(snapshot) ?? undefined
    : undefined;

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  if (!snapshot) return null;

  return (
    <>
      <div className="mb-1 d-flex align-items-center justify-content-end">
        <DropdownMenu
          trigger={
            <Link>
              <PiEye className="mr-1" />
              View details
            </Link>
          }
          menuPlacement="end"
        >
          <div style={{ minWidth: 250 }} className="p-2">
            <h5>Results computed with:</h5>
            <Metadata
              label="Engine"
              value={
                analysis?.settings?.statsEngine ===
                "frequentist"
                  ? "Frequentist"
                  : "Bayesian"
              }
            />
            <Metadata
              label="CUPED"
              value={
                snapshot?.settings?.regressionAdjustmentEnabled
                  ? "Enabled"
                  : "Disabled"
              }
            />
            {analysis?.settings?.statsEngine === "frequentist" && (
              <Metadata
                label="Sequential"
                value={
                  analysis?.settings?.sequentialTesting
                    ? "Enabled"
                    : "Disabled"
                }
              />
            )}
            {snapshot.runStarted && (
              <div className="text-right mt-3">
                <Metadata
                  label="Run date"
                  value={datetime(snapshot.runStarted)}
                />
              </div>
            )}
          </div>
        </DropdownMenu>
      </div>
      <div className="py-1 d-flex mb-2">
        <div className="row align-items-center" style={{ gap: "0.5rem 1rem" }}>
          <div className="col-auto d-flex align-items-end">
            <DimensionChooser
              value={snapshot.dimension ?? ""}
              precomputedDimensions={snapshot.type === "standard" ? snapshot.settings.dimensions.map((d) => d.id) : []}
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
              differenceType={
                analysis?.settings?.differenceType ?? "relative"
              }
              disabled={true}
              phase={0}
              setDifferenceType={() => {}}
              setAnalysisSettings={() => {}}
              mutate={() => {}}
            />
          </div>
          <div className="col-auto d-flex align-items-end">
            <div>
              <div className="uppercase-title text-muted">Date range</div>
              <div className="relative">
                <span className="date-label">
                  {date(snapshot.settings.startDate)} —{" "}
                  {snapshot.settings.endDate
                    ? date(snapshot.settings.endDate)
                    : "now"}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="row flex-grow-1 flex-shrink-0 pt-1 px-2 justify-content-end">
          <div className="col-auto px-0">
            {hasData && snapshot.runStarted ? (
              <div
                className="text-muted text-right"
                style={{ width: 130, fontSize: "0.8em" }}
                title={datetime(snapshot.runStarted)}
              >
                <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                  last updated
                </div>
                <div className="d-inline-block" style={{ lineHeight: 1 }}>
                  {ago(snapshot.runStarted)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
