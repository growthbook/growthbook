import PageHead from "@/components/Layout/PageHead";
import {ExperimentSnapshotReportInterface, MetricSnapshotSettings, ReportInterface} from "back-end/types/report";
import {ExperimentSnapshotInterface} from "back-end/types/experiment-snapshot";
import Code from "@/components/SyntaxHighlighting/Code";
import {getValidDate} from "shared/dates";
import {DEFAULT_PROPER_PRIOR_STDDEV, DEFAULT_STATS_ENGINE} from "shared/constants";
import CompactResults from "@/components/Experiment/CompactResults";
import React from "react";
import Callout from "@/components/Radix/Callout";
import {getSnapshotAnalysis} from "shared/util";
import {getQueryStatus} from "@/components/Queries/RunQueriesButton";

export async function getServerSideProps(context) {
  const { r } = context.params;

  const API_HOST = (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";
  try {
    const resp = await fetch(API_HOST + `/api/report/public/${r}`);
    const data = await resp.json();
    const report = data?.report;
    if (!report) throw new Error("Report not found");

    const snapshot = data?.snapshot;

    return {
      props: {
        r,
        report,
        snapshot,
      },
    };
  } catch (e) {
    console.log(e)
    return {
      notFound: true
    }
  }
}

interface ReportPageProps {
  r: string;
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
}

export default function ReportPage(props: ReportPageProps) {
  const { report, snapshot } = props;
  const phases = report.experimentMetadata.phases;
  const phase = phases.length -1;
  const phaseObj = phases[phase];

  const variations = report.experimentMetadata.variations.map((variation, i) => ({
    id: variation.id,
    name: variation.name,
    weight: report.experimentMetadata.phases?.[snapshot?.phase || 0]?.variationWeights?.[i] || (1 / (variations?.length || 2)),
  }));
  const analysis = snapshot ? getSnapshotAnalysis(snapshot) ?? undefined : undefined;
  const queryStatusData = getQueryStatus(snapshot?.queries || [], snapshot?.error);

  const settingsForSnapshotMetrics: MetricSnapshotSettings[] =
    snapshot?.settings?.metricSettings?.map((m) => ({
      metric: m.id,
      properPrior: m.computedSettings?.properPrior ?? false,
      properPriorMean: m.computedSettings?.properPriorMean ?? 0,
      properPriorStdDev:
        m.computedSettings?.properPriorStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentReason:
        m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays || 0,
      regressionAdjustmentEnabled: !!m.computedSettings
        ?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable: !!m.computedSettings
        ?.regressionAdjustmentAvailable,
    })) || [];

  const ssrData = {
    metrics: {
      "met_sktwi1114ln571qr6" : {
        "id": "met_sktwi1114ln571qr6",
        "organization": "org_sktwido9laa302j8",
        "owner": "Bryce",
        "datasource": "ds_sktwido9laa3285o",
        "name": "net revenue",
        "description": "",
        "type": "revenue",
        "table": "",
        "column": "",
        "inverse": false,
        "ignoreNulls": false,
        "denominator": "",
        "winRisk": 0.0025,
        "loseRisk": 0.0125,
        "maxPercentChange": 0.5,
        "minPercentChange": 0.005,
        "minSampleSize": 150,
        "regressionAdjustmentOverride": false,
        "regressionAdjustmentEnabled": false,
        "regressionAdjustmentDays": 14,
        "dateCreated": "2023-09-29T22:46:49.266Z",
        "dateUpdated": "2023-12-11T19:00:18.591Z",
        "userIdTypes": [
          "anonymous_id",
          "user_id"
        ],
        "userIdColumns": {
          "user_id": "user_id",
          "anonymous_id": "anonymous_id"
        },
        "status": "active",
        "sql": "SELECT\n  userid user_id,\n  anonymousid anonymous_id,\n  timestamp,\n  amount * 0.8 as value\nFROM\n  orders",
        "aggregation": "",
        "timestampColumn": "",
        "queryFormat": "sql",
        "tags": [
          "key metrics",
          "foo",
          "bar",
          "barrrrrr",
          "bazbazbazzz",
          "foo1",
          "foo2",
          "foo333",
          "growthbook-demo",
          "more tags"
        ],
        "projects": [],
        "conditions": [],
        "queries": [
          {
            "query": "qry_sktwi1ip7lyz3kskg",
            "status": "succeeded",
            "name": "metric"
          }
        ],
        "templateVariables": {
          "eventName": "",
          "valueColumn": ""
        },
        "analysisError": "",
        "runStarted": "2024-07-24T00:19:30.595Z",
        "windowSettings": {
          "type": "conversion",
          "windowValue": 60,
          "windowUnit": "hours",
          "delayHours": 0.25
        },
        "priorSettings": {
          "override": false,
          "proper": false,
          "mean": 0,
          "stddev": 0.3
        },
        "cappingSettings": {
          "type": "",
          "value": 0
        }
      }
    },
    metricGroups: [
      {
        "id": "mg_sktwi14ipm2uw2kon",
        "owner": "Bryce",
        "name": "bandit group",
        "description": "for bandit testing",
        "tags": [],
        "projects": [],
        "metrics": [
          "met_sktwi1ii8m1h4x1fb",
          "met_sktwi185qm0pwmzct"
        ],
        "datasource": "ds_sktwi185qm0pwe4w3",
        "archived": false,
        "organization": "org_sktwido9laa302j8",
        "dateCreated": "2024-10-29T20:17:07.895Z",
        "dateUpdated": "2024-10-30T20:33:53.040Z"
      },
      {
        "id": "mg_sktwi1m1nm1vnob5n",
        "owner": "Bryce",
        "name": "rev metrics",
        "description": "rev and conversion standard metrics",
        "tags": [],
        "projects": [],
        "metrics": [
          "met_sktwi1114ln571qr6",
          "met_sktwio0slabgh7sp",
          "met_sktwio0slabhfh22",
          "met_sktwi1eoelbzeyh1x",
          "met_sktwiqzgm2wfs058",
          "fact__sktwipn8lzvkjb7b",
          "met_sktwiqzgm2wfrljs"
        ],
        "datasource": "ds_sktwido9laa3285o",
        "archived": false,
        "organization": "org_sktwido9laa302j8",
        "dateCreated": "2024-10-05T04:30:09.275Z",
        "dateUpdated": "2024-11-06T23:36:18.333Z"
      }
    ],
  };

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          {display: `Reports`, href: `/reports`},
          {display: report?.title ?? "(no title)"},
        ]}
      />

      <h1>{report.title}</h1>

      <div className="bg-white border">
      {!snapshot || !analysis ? (
        <Callout status="error">Missing snapshot!</Callout>
      ) : (
        <CompactResults
          variations={variations}
          multipleExposures={snapshot.multipleExposures || 0}
          results={analysis.results[0]}
          queryStatusData={queryStatusData}
          reportDate={snapshot.dateCreated}
          startDate={getValidDate(phaseObj.dateStarted).toISOString()}
          isLatestPhase={phase === phases.length - 1}
          status={"stopped"}
          goalMetrics={report.experimentAnalysisSettings.goalMetrics}
          secondaryMetrics={report.experimentAnalysisSettings.secondaryMetrics}
          guardrailMetrics={report.experimentAnalysisSettings.guardrailMetrics}
          metricOverrides={report.experimentAnalysisSettings.metricOverrides ?? []}
          id={report.id}
          statsEngine={analysis.settings.statsEngine}
          // pValueCorrection={pValueCorrection} // todo: bake this into snapshot or report
          regressionAdjustmentEnabled={report.experimentAnalysisSettings.regressionAdjustmentEnabled}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          sequentialTestingEnabled={analysis.settings?.sequentialTesting}
          differenceType={analysis.settings?.differenceType}
          isTabActive={true}
          experimentType={report.experimentMetadata.type}
          ssrData={ssrData}
        />
      )}
      </div>

      <Code language="json" code={JSON.stringify(report, null, 2)} style={{maxHeight: 400, overflowY: "auto"}} />

      <code>snapshot</code>
      <Code language="json" code={JSON.stringify(snapshot, null, 2)} style={{maxHeight: 400, overflowY: "auto"}} />

    </div>
  );
}

ReportPage.preAuth = true;
ReportPage.progressiveAuth = true;
ReportPage.progressiveAuthTopNav = true;
ReportPage.noLoadingOverlay = true;
