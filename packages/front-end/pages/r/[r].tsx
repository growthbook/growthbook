import {
  ExperimentSnapshotReportInterface,
  SSRExperimentReportData,
} from "back-end/types/report";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { DEFAULT_P_VALUE_THRESHOLD } from "shared/constants";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { FactTableInterface } from "back-end/types/fact-table";
import { DimensionInterface } from "back-end/types/dimension";
import Head from "next/head";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useCurrency } from "@/hooks/useCurrency";
import { supportedCurrencies } from "@/services/settings";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import {
  METRIC_DEFAULTS,
  useOrganizationMetricDefaults,
} from "@/hooks/useOrganizationMetricDefaults";
import ReportResults from "@/components/Report/ReportResults";
import ReportMetaInfo from "@/components/Report/ReportMetaInfo";
import { useUser } from "@/services/UserContext";
import Callout from "@/components/Radix/Callout";
import Link from "@/components/Radix/Link";

const APP_ORIGIN =
  (process.env.APP_ORIGIN ?? "").replace(/\/$/, "") || "http://localhost:3000";

export async function getServerSideProps(context) {
  const { r } = context.params;

  const API_HOST =
    (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";
  console.log({ API_HOST });
  try {
    const resp = await fetch(API_HOST + `/api/report/public/${r}`);
    const data = await resp.json();
    const report = data?.report;
    if (!report) throw new Error("Report not found");

    const snapshot = data?.snapshot;
    const ssrData = data?.ssrData;

    return {
      props: {
        r,
        report,
        snapshot,
        ssrData,
      },
    };
  } catch (e) {
    console.error(e);
    return {
      notFound: true,
    };
  }
}

interface ReportPageProps {
  r: string;
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
  ssrData?: SSRExperimentReportData;
}

export interface SSRExperimentReportPolyfills {
  getExperimentMetricById: (id: string) => null | ExperimentMetricInterface;
  metricGroups: MetricGroupInterface[];
  getMetricGroupById: (id: string) => null | MetricGroupInterface;
  getFactTableById: (id: string) => null | FactTableInterface;
  useOrgSettings: typeof useOrgSettings;
  useCurrency: typeof useCurrency;
  usePValueThreshold: typeof usePValueThreshold;
  useConfidenceLevels: typeof useConfidenceLevels;
  useOrganizationMetricDefaults: typeof useOrganizationMetricDefaults;
  dimensions: DimensionInterface[];
  getDimensionById: (id: string) => null | DimensionInterface;
}

export default function ReportPage(props: ReportPageProps) {
  const {
    userId,
    organization: userOrganization,
    superAdmin,
    ready: userReady,
  } = useUser();
  const { report, snapshot, ssrData } = props;

  const [isSsr, setIsSsr] = useState(true);
  useEffect(() => setIsSsr(false), []);
  const hasCsrSettings = !!Object.keys(useOrgSettings() || {})?.length;

  const isOrgMember =
    (!!userId && report.organization === userOrganization.id) || !!superAdmin;
  let canView = report.shareLevel === "public";
  if (report.shareLevel === "organization") {
    // must be an org member or superAdmin
    canView = isOrgMember;
  }
  if (isSsr) {
    // initial SSR can render (for openGraph)
    canView = true;
  }

  const {
    getExperimentMetricById,
    getMetricGroupById,
    getFactTableById,
    metricGroups,
    dimensions,
    getDimensionById,
  } = useDefinitions();

  // ssr polyfills
  const getExperimentMetricByIdSSR = useCallback(
    (metricId: string) =>
      getExperimentMetricById(metricId) || ssrData?.metrics?.[metricId] || null,
    [getExperimentMetricById, ssrData?.metrics]
  );
  const metricGroupsSSR = useMemo(
    () => [...metricGroups, ...(ssrData?.metricGroups ?? [])],
    [metricGroups, ssrData?.metricGroups]
  );
  const getMetricGroupByIdSSR = useCallback(
    (metricGroupId: string) =>
      getMetricGroupById(metricGroupId) ||
      metricGroupsSSR?.[metricGroupId] ||
      null,
    [getMetricGroupById, metricGroupsSSR]
  );
  const getFactTableByIdSSR = useCallback(
    (id) => getFactTableById(id) || ssrData?.factTables?.[id] || null,
    [getFactTableById, ssrData?.factTables]
  );

  const useOrgSettingsSSR = () => {
    const orgSettings = useOrgSettings();
    return hasCsrSettings ? orgSettings : ssrData?.settings || {};
  };
  const useCurrencySSR = () => {
    const currency = useCurrency();
    if (hasCsrSettings) return currency;
    return (ssrData?.settings?.displayCurrency ?? "") in supportedCurrencies
      ? ssrData?.settings?.displayCurrency ?? "USD"
      : "USD";
  };
  const usePValueThresholdSSR = () => {
    const pValueThreshold = usePValueThreshold();
    return hasCsrSettings
      ? pValueThreshold
      : ssrData?.settings?.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD;
  };
  const useConfidenceLevelsSSR = () => {
    const confidenceLevels = useConfidenceLevels();
    if (hasCsrSettings) return confidenceLevels;
    const ciUpper = ssrData?.settings?.confidenceLevel || 0.95;
    return {
      ciUpper,
      ciLower: 1 - ciUpper,
      ciUpperDisplay: Math.round(ciUpper * 100) + "%",
      ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
    };
  };
  const useOrganizationMetricDefaultsSSR = () => {
    const organizationMetricDefaults = useOrganizationMetricDefaults();
    if (hasCsrSettings) return organizationMetricDefaults;
    return {
      ...organizationMetricDefaults,
      metricDefaults: {
        ...METRIC_DEFAULTS,
        ...(ssrData?.settings?.metricDefaults || {}),
      },
    };
  };

  const dimensionsSSR = useMemo(
    () => [...dimensions, ...(ssrData?.dimensions ?? [])],
    [dimensions, ssrData?.dimensions]
  );
  const getDimensionByIdSSR = useCallback(
    (id: string) => getDimensionById(id) || dimensionsSSR?.[id] || null,
    [getDimensionById, dimensionsSSR]
  );

  const ssrPolyfills: SSRExperimentReportPolyfills = {
    getExperimentMetricById: getExperimentMetricByIdSSR,
    metricGroups: metricGroupsSSR,
    getMetricGroupById: getMetricGroupByIdSSR,
    getFactTableById: getFactTableByIdSSR,
    useOrgSettings: useOrgSettingsSSR,
    useCurrency: useCurrencySSR,
    usePValueThreshold: usePValueThresholdSSR,
    useConfidenceLevels: useConfidenceLevelsSSR,
    useOrganizationMetricDefaults: useOrganizationMetricDefaultsSSR,
    dimensions: dimensionsSSR,
    getDimensionById: getDimensionByIdSSR,
  };

  const shareableLink = report.tinyid
    ? `${APP_ORIGIN}/r/${report.tinyid}`
    : `${APP_ORIGIN}/report/${report.id}`;

  return (
    <div className="pagecontents container-fluid">
      <Head>
        <title>{report.title || "Report"}</title>
        <meta property="og:title" content={report.title || "Report"} />
        <meta property="og:description" content={report.description || ""} />
        <meta property="og:url" content={shareableLink} />
        <meta property="og:type" content="website" />
      </Head>

      <PageHead
        breadcrumb={[
          { display: `Reports`, href: `/reports` },
          { display: report?.title ?? "(no title)" },
        ]}
      />

      <ReportMetaInfo
        report={report}
        canView={canView}
        showPrivateLink={isOrgMember}
      />

      {canView ? (
        <ReportResults
          report={report}
          snapshot={snapshot}
          snapshotError={!snapshot ? new Error("Missing snapshot") : undefined}
          ssrPolyfills={ssrPolyfills}
        />
      ) : (
        <Callout status="error">
          This report is not shared publicly.
          {!userReady && (
            <>
              {" "}
              <Link href="/">Log in</Link> to view this link.
            </>
          )}
        </Callout>
      )}
    </div>
  );
}

ReportPage.preAuth = true;
ReportPage.progressiveAuth = true;
ReportPage.progressiveAuthTopNav = true;
ReportPage.noLoadingOverlay = true;
