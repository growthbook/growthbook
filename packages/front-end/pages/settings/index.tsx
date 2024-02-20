import React, { useEffect, useState } from "react";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaPencilAlt,
  FaQuestionCircle,
  FaUpload,
} from "react-icons/fa";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import cronstrue from "cronstrue";
import { AttributionModel } from "back-end/types/experiment";
import { PValueCorrection } from "back-end/types/stats";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { OrganizationSettings } from "@/../back-end/types/organization";
import Link from "next/link";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { MdInfoOutline } from "react-icons/md";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { useAuth } from "@/services/auth";
import EditOrganizationModal from "@/components/Settings/EditOrganizationModal";
import BackupConfigYamlButton from "@/components/Settings/BackupConfigYamlButton";
import RestoreConfigYamlButton from "@/components/Settings/RestoreConfigYamlButton";
import { hasFileConfig, isCloud, isMultiOrg } from "@/services/env";
import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import TempMessage from "@/components/TempMessage";
import Button from "@/components/Button";
import { DocLink } from "@/components/DocLink";
import {
  OrganizationSettingsWithMetricDefaults,
  useOrganizationMetricDefaults,
} from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { GBCuped, GBSequential } from "@/components/Icons";
import Toggle from "@/components/Forms/Toggle";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import Tab from "@/components/Tabs/Tab";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import { useCurrency } from "@/hooks/useCurrency";
import { AppFeatures } from "@/types/app-features";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import {
  StickyBucketingToggleWarning,
  StickyBucketingTooltip,
} from "@/components/Features/FallbackAttributeSelector";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";

export const supportedCurrencies = {
  AED: "UAE Dirham (AED)",
  AFN: "Afghani (AFN)",
  ALL: "Lek (ALL)",
  AMD: "Armenian Dram (AMD)",
  ANG: "Netherlands Antillean Guilder (ANG)",
  AOA: "Kwanza (AOA)",
  ARS: "Argentine Peso (ARS)",
  AUD: "Australian Dollar (AUD)",
  AWG: "Aruban Florin (AWG)",
  AZN: "Azerbaijan Manat (AZN)",
  BAM: "Convertible Mark (BAM)",
  BBD: "Barbados Dollar (BBD)",
  BDT: "Taka (BDT)",
  BGN: "Bulgarian Lev (BGN)",
  BHD: "Bahraini Dinar (BHD)",
  BIF: "Burundi Franc (BIF)",
  BMD: "Bermudian Dollar (BMD)",
  BND: "Brunei Dollar (BND)",
  BOB: "Boliviano (BOB)",
  BOV: "Mvdol (BOV)",
  BRL: "Brazilian Real (BRL)",
  BSD: "Bahamian Dollar (BSD)",
  BTN: "Ngultrum (BTN)",
  BWP: "Pula (BWP)",
  BYN: "Belarusian Ruble (BYN)",
  BZD: "Belize Dollar (BZD)",
  CAD: "Canadian Dollar (CAD)",
  CDF: "Congolese Franc (CDF)",
  CHE: "WIR Euro (CHE)",
  CHF: "Swiss Franc (CHF)",
  CHW: "WIR Franc (CHW)",
  CLF: "Unidad de Fomento (CLF)",
  CLP: "Chilean Peso (CLP)",
  CNY: "Yuan Renminbi (CNY)",
  COP: "Colombian Peso (COP)",
  COU: "Unidad de Valor Real (COU)",
  CRC: "Costa Rican Colon (CRC)",
  CUC: "Peso Convertible (CUC)",
  CUP: "Cuban Peso (CUP)",
  CVE: "Cabo Verde Escudo (CVE)",
  CZK: "Czech Koruna (CZK)",
  DJF: "Djibouti Franc (DJF)",
  DKK: "Danish Krone (DKK)",
  DOP: "Dominican Peso (DOP)",
  DZD: "Algerian Dinar (DZD)",
  EGP: "Egyptian Pound (EGP)",
  ERN: "Nakfa (ERN)",
  ETB: "Ethiopian Birr (ETB)",
  EUR: "Euro (EUR)",
  FJD: "Fiji Dollar (FJD)",
  FKP: "Falkland Islands Pound (FKP)",
  GBP: "Pound Sterling (GBP)",
  GEL: "Lari (GEL)",
  GHS: "Ghana Cedi (GHS)",
  GIP: "Gibraltar Pound (GIP)",
  GMD: "Dalasi (GMD)",
  GNF: "Guinean Franc (GNF)",
  GTQ: "Quetzal (GTQ)",
  GYD: "Guyana Dollar (GYD)",
  HKD: "Hong Kong Dollar (HKD)",
  HNL: "Lempira (HNL)",
  HTG: "Gourde (HTG)",
  HUF: "Forint (HUF)",
  IDR: "Rupiah (IDR)",
  ILS: "New Israeli Sheqel (ILS)",
  INR: "Indian Rupee (INR)",
  IQD: "Iraqi Dinar (IQD)",
  IRR: "Iranian Rial (IRR)",
  ISK: "Iceland Krona (ISK)",
  JMD: "Jamaican Dollar (JMD)",
  JOD: "Jordanian Dinar (JOD)",
  JPY: "Yen (JPY)",
  KES: "Kenyan Shilling (KES)",
  KGS: "Som (KGS)",
  KHR: "Riel (KHR)",
  KMF: "Comorian Franc (KMF)",
  KPW: "North Korean Won (KPW)",
  KRW: "Won (KRW)",
  KWD: "Kuwaiti Dinar (KWD)",
  KYD: "Cayman Islands Dollar (KYD)",
  KZT: "Tenge (KZT)",
  LAK: "Lao Kip (LAK)",
  LBP: "Lebanese Pound (LBP)",
  LKR: "Sri Lanka Rupee (LKR)",
  LRD: "Liberian Dollar (LRD)",
  LSL: "Loti (LSL)",
  LYD: "Libyan Dinar (LYD)",
  MAD: "Moroccan Dirham (MAD)",
  MDL: "Moldovan Leu (MDL)",
  MGA: "Malagasy Ariary (MGA)",
  MKD: "Denar (MKD)",
  MMK: "Kyat (MMK)",
  MNT: "Tugrik (MNT)",
  MOP: "Pataca (MOP)",
  MRU: "Ouguiya (MRU)",
  MUR: "Mauritius Rupee (MUR)",
  MVR: "Rufiyaa (MVR)",
  MWK: "Malawi Kwacha (MWK)",
  MXN: "Mexican Peso (MXN)",
  MXV: "Mexican Unidad de Inversion (UDI) (MXV)",
  MYR: "Malaysian Ringgit (MYR)",
  MZN: "Mozambique Metical (MZN)",
  NAD: "Namibia Dollar (NAD)",
  NGN: "Naira (NGN)",
  NIO: "Cordoba Oro (NIO)",
  NOK: "Norwegian Krone (NOK)",
  NPR: "Nepalese Rupee (NPR)",
  NZD: "New Zealand Dollar (NZD)",
  OMR: "Rial Omani (OMR)",
  PAB: "Balboa (PAB)",
  PEN: "Sol (PEN)",
  PGK: "Kina (PGK)",
  PHP: "Philippine Peso (PHP)",
  PKR: "Pakistan Rupee (PKR)",
  PLN: "Zloty (PLN)",
  PYG: "Guarani (PYG)",
  QAR: "Qatari Rial (QAR)",
  RON: "Romanian Leu (RON)",
  RSD: "Serbian Dinar (RSD)",
  RUB: "Russian Ruble (RUB)",
  RWF: "Rwanda Franc (RWF)",
  SAR: "Saudi Riyal (SAR)",
  SBD: "Solomon Islands Dollar (SBD)",
  SCR: "Seychelles Rupee (SCR)",
  SDG: "Sudanese Pound (SDG)",
  SEK: "Swedish Krona (SEK)",
  SGD: "Singapore Dollar (SGD)",
  SHP: "Saint Helena Pound (SHP)",
  SLE: "Leone (SLE)",
  SLL: "Leone (SLL)",
  SOS: "Somali Shilling (SOS)",
  SRD: "Surinam Dollar (SRD)",
  SSP: "South Sudanese Pound (SSP)",
  STN: "Dobra (STN)",
  SVC: "El Salvador Colon (SVC)",
  SYP: "Syrian Pound (SYP)",
  SZL: "Lilangeni (SZL)",
  THB: "Baht (THB)",
  TJS: "Somoni (TJS)",
  TMT: "Turkmenistan New Manat (TMT)",
  TND: "Tunisian Dinar (TND)",
  TOP: "Pa’anga (TOP)",
  TRY: "Turkish Lira (TRY)",
  TTD: "Trinidad and Tobago Dollar (TTD)",
  TWD: "New Taiwan Dollar (TWD)",
  TZS: "Tanzanian Shilling (TZS)",
  UAH: "Hryvnia (UAH)",
  UGX: "Uganda Shilling (UGX)",
  USD: "US Dollar (USD)",
  UYI: "Uruguay Peso en Unidades Indexadas (UI) (UYI)",
  UYU: "Peso Uruguayo (UYU)",
  UYW: "Unidad Previsional (UYW)",
  UZS: "Uzbekistan Sum (UZS)",
  VED: "Bolívar Soberano (VED)",
  VES: "Bolívar Soberano (VES)",
  VND: "Dong (VND)",
  VUV: "Vatu (VUV)",
  WST: "Tala (WST)",
  XAF: "CFA Franc BEAC (XAF)",
  XCD: "East Caribbean Dollar (XCD)",
  XDR: "SDR (Special Drawing Right) (XDR)",
  XOF: "CFA Franc BCEAO (XOF)",
  XPF: "CFP Franc (XPF)",
  XSU: "Sucre (XSU)",
  XUA: "ADB Unit of Account (XUA)",
  YER: "Yemeni Rial (YER)",
  ZAR: "Rand (ZAR)",
  ZMW: "Zambian Kwacha (ZMW)",
  ZWL: "Zimbabwe Dollar (ZWL)",
};

export const DEFAULT_SRM_THRESHOLD = 0.001;

function hasChanges(
  value: OrganizationSettings,
  existing: OrganizationSettings
) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const GeneralSettingsPage = (): React.ReactElement => {
  const {
    refreshOrganization,
    settings,
    organization,
    hasCommercialFeature,
  } = useUser();
  const [editOpen, setEditOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<OrganizationSettings>({});
  const [statsEngineTab, setStatsEngineTab] = useState<string>(
    settings.statsEngine || DEFAULT_STATS_ENGINE
  );
  const displayCurrency = useCurrency();
  const growthbook = useGrowthBook<AppFeatures>();
  const { datasources } = useDefinitions();

  const currencyOptions = Object.entries(
    supportedCurrencies
  ).map(([value, label]) => ({ value, label }));

  const permissions = usePermissions();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialTestingFeature = hasCommercialFeature(
    "sequential-testing"
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
  );
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");

  const hasCustomChecklistFeature = hasCommercialFeature(
    "custom-launch-checklist"
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities(
    sdkConnectionsData?.connections || []
  ).includes("stickyBucketing");

  const { metricDefaults } = useOrganizationMetricDefaults();

  const queryParams = new URLSearchParams(window.location.search);

  const [editChecklistOpen, setEditChecklistOpen] = useState(
    () => queryParams.get("editCheckListModal") || false
  );

  const form = useForm<OrganizationSettingsWithMetricDefaults>({
    defaultValues: {
      visualEditorEnabled: false,
      pastExperimentsMinLength: 6,
      metricAnalysisDays: 90,
      // customization:
      customized: false,
      logoPath: "",
      primaryColor: "#391c6d",
      secondaryColor: "#50279a",
      northStar: {
        //enabled: false,
        title: "",
        metricIds: [],
        //target: [],
        //window: "",
        //resolution?: string;
        //startDate?: Date;
      },
      metricDefaults: {
        minimumSampleSize: metricDefaults.minimumSampleSize,
        maxPercentageChange: metricDefaults.maxPercentageChange * 100,
        minPercentageChange: metricDefaults.minPercentageChange * 100,
      },
      updateSchedule: {
        type: "stale",
        hours: 6,
        cron: "0 */6 * * *",
      },
      runHealthTrafficQuery: false,
      srmThreshold: DEFAULT_SRM_THRESHOLD,
      multipleExposureMinPercent: 0.01,
      confidenceLevel: 0.95,
      pValueThreshold: DEFAULT_P_VALUE_THRESHOLD,
      pValueCorrection: null,
      statsEngine: DEFAULT_STATS_ENGINE,
      regressionAdjustmentEnabled: DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      regressionAdjustmentDays: DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      sequentialTestingEnabled: false,
      sequentialTestingTuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
      attributionModel: "firstExposure",
      displayCurrency,
      secureAttributeSalt: "",
      killswitchConfirmation: false,
      defaultDataSource: settings.defaultDataSource || "",
      useStickyBucketing: false,
      useFallbackAttributes: false,
    },
  });
  const { apiCall } = useAuth();

  const value = {
    visualEditorEnabled: form.watch("visualEditorEnabled"),
    pastExperimentsMinLength: form.watch("pastExperimentsMinLength"),
    metricAnalysisDays: form.watch("metricAnalysisDays"),
    metricDefaults: {
      minimumSampleSize: form.watch("metricDefaults.minimumSampleSize"),
      maxPercentageChange: form.watch("metricDefaults.maxPercentageChange"),
      minPercentageChange: form.watch("metricDefaults.minPercentageChange"),
    },
    // customization:
    customized: form.watch("customized"),
    logoPath: form.watch("logoPath"),
    primaryColor: form.watch("primaryColor"),
    secondaryColor: form.watch("secondaryColor"),
    northStar: form.watch("northStar"),
    updateSchedule: form.watch("updateSchedule"),
    runHealthTrafficQuery: form.watch("runHealthTrafficQuery"),
    srmThreshold: form.watch("srmThreshold"),
    multipleExposureMinPercent: form.watch("multipleExposureMinPercent"),
    statsEngine: form.watch("statsEngine"),
    confidenceLevel: form.watch("confidenceLevel"),
    pValueThreshold: form.watch("pValueThreshold"),
    pValueCorrection: form.watch("pValueCorrection"),
    regressionAdjustmentEnabled: form.watch("regressionAdjustmentEnabled"),
    regressionAdjustmentDays: form.watch("regressionAdjustmentDays"),
    sequentialTestingEnabled: form.watch("sequentialTestingEnabled"),
    sequentialTestingTuningParameter: form.watch(
      "sequentialTestingTuningParameter"
    ),
    attributionModel: form.watch("attributionModel"),
    displayCurrency: form.watch("displayCurrency"),
    secureAttributeSalt: form.watch("secureAttributeSalt"),
    killswitchConfirmation: form.watch("killswitchConfirmation"),
    defaultDataSource: form.watch("defaultDataSource"),
    useStickyBucketing: form.watch("useStickyBucketing"),
    useFallbackAttributes: form.watch("useFallbackAttributes"),
  };

  const [cronString, setCronString] = useState("");

  function updateCronString(cron?: string) {
    cron = cron || value.updateSchedule?.cron || "";

    if (!cron) {
      setCronString("");
    }
    setCronString(
      `${cronstrue.toString(cron, {
        throwExceptionOnParseError: false,
        verbose: true,
      })} (UTC time)`
    );
  }

  useEffect(() => {
    if (settings) {
      const newVal = { ...form.getValues() };
      Object.keys(newVal).forEach((k) => {
        const hasExistingMetrics = typeof settings?.[k] !== "undefined";
        newVal[k] = settings?.[k] || newVal[k];

        // Existing values are stored as a multiplier, e.g. 50% on the UI is stored as 0.5
        // Transform these values from the UI format
        if (k === "metricDefaults" && hasExistingMetrics) {
          newVal.metricDefaults = {
            ...newVal.metricDefaults,
            maxPercentageChange:
              newVal.metricDefaults.maxPercentageChange * 100,
            minPercentageChange:
              newVal.metricDefaults.minPercentageChange * 100,
          };
        }
        if (k === "confidenceLevel" && (newVal?.confidenceLevel ?? 0.95) <= 1) {
          newVal.confidenceLevel = (newVal.confidenceLevel ?? 0.95) * 100;
        }
        if (
          k === "multipleExposureMinPercent" &&
          (newVal?.multipleExposureMinPercent ?? 0.01) <= 1
        ) {
          newVal.multipleExposureMinPercent =
            (newVal.multipleExposureMinPercent ?? 0.01) * 100;
        }

        if (k === "useStickyBucketing") {
          newVal.useStickyBucketing = hasStickyBucketFeature
            ? newVal.useStickyBucketing
            : false;
        }
      });
      form.reset(newVal);
      setOriginalValue(newVal);
      updateCronString(newVal.updateSchedule?.cron || "");
    }
  }, [settings]);

  const ctaEnabled = hasChanges(value, originalValue);

  const saveSettings = form.handleSubmit(async (value) => {
    const transformedOrgSettings = {
      ...value,
      metricDefaults: {
        ...value.metricDefaults,
        maxPercentageChange: value.metricDefaults.maxPercentageChange / 100,
        minPercentageChange: value.metricDefaults.minPercentageChange / 100,
      },
      confidenceLevel: (value.confidenceLevel ?? 0.95) / 100,
      multipleExposureMinPercent:
        (value.multipleExposureMinPercent ?? 0.01) / 100,
    };

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: transformedOrgSettings,
      }),
    });
    refreshOrganization();

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  const highlightColor =
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    value.confidenceLevel < 70
      ? "#c73333"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.confidenceLevel < 80
      ? "#e27202"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.confidenceLevel < 90
      ? "#B39F01"
      : "";

  const pHighlightColor =
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    value.pValueThreshold > 0.3
      ? "#c73333"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.pValueThreshold > 0.2
      ? "#e27202"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.pValueThreshold > 0.1
      ? "#B39F01"
      : "";

  const srmHighlightColor =
    value.srmThreshold &&
    (value.srmThreshold > 0.01 || value.srmThreshold < 0.001)
      ? "#B39F01"
      : "";

  const regressionAdjustmentDaysHighlightColor =
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    value.regressionAdjustmentDays > 28 || value.regressionAdjustmentDays < 7
      ? "#e27202"
      : "";

  const warningMsg =
    value.confidenceLevel === 70
      ? "This is as low as it goes"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.confidenceLevel < 75
      ? "Confidence thresholds this low are not recommended"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.confidenceLevel < 80
      ? "Confidence thresholds this low are not recommended"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.confidenceLevel < 90
      ? "Use caution with values below 90%"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.confidenceLevel >= 99
      ? "Confidence levels 99% and higher can take lots of data to achieve"
      : "";

  const pWarningMsg =
    value.pValueThreshold === 0.5
      ? "This is as high as it goes"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.pValueThreshold > 0.25
      ? "P-value thresholds this high are not recommended"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.pValueThreshold > 0.2
      ? "P-value thresholds this high are not recommended"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.pValueThreshold > 0.1
      ? "Use caution with values above 0.1"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.pValueThreshold <= 0.01
      ? "Threshold values of 0.01 and lower can take lots of data to achieve"
      : "";

  const srmWarningMsg =
    value.srmThreshold && value.srmThreshold > 0.01
      ? "Thresholds above 0.01 may lead to many false positives, especially if you refresh results regularly."
      : value.srmThreshold && value.srmThreshold < 0.001
      ? "Thresholds below 0.001 may make it hard to detect imbalances without lots of traffic."
      : "";

  const regressionAdjustmentDaysWarningMsg =
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    value.regressionAdjustmentDays > 28
      ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
      : // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      value.regressionAdjustmentDays < 7
      ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
      : "";

  const metricAnalysisDaysWarningMsg =
    value.metricAnalysisDays && value.metricAnalysisDays > 365
      ? "Using more historical data will slow down metric analysis queries"
      : "";

  if (!permissions.organizationSettings) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <>
      {editChecklistOpen ? (
        <ExperimentCheckListModal close={() => setEditChecklistOpen(false)} />
      ) : null}

      <div className="container-fluid pagecontents">
        {editOpen && (
          <EditOrganizationModal
            name={organization.name || ""}
            close={() => setEditOpen(false)}
            mutate={refreshOrganization}
          />
        )}
        <h1>General Settings</h1>

        <div className="mb-1">
          <div className=" bg-white p-3 border">
            <div className="row mb-0">
              <div className="col-sm-3">
                <h4>Organization</h4>
              </div>
              <div className="col-sm-9">
                <div className="form-group row">
                  <div className="col-sm-12">
                    <strong>Name: </strong> {organization.name}{" "}
                    <a
                      href="#"
                      className="pl-1"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditOpen(true);
                      }}
                    >
                      <FaPencilAlt />
                    </a>
                  </div>
                </div>
                <div className="form-group row">
                  <div className="col-sm-12">
                    <strong>Owner:</strong> {organization.ownerEmail}
                  </div>
                </div>
              </div>
            </div>
            {(isCloud() || !isMultiOrg()) && <ShowLicenseInfo />}
          </div>

          {hasFileConfig() && (
            <div className="alert alert-info my-3">
              The below settings are controlled through your{" "}
              <code>config.yml</code> file and cannot be changed through the web
              UI.{" "}
              <DocLink
                docSection="config_organization_settings"
                className="font-weight-bold"
              >
                View Documentation
              </DocLink>
              .
            </div>
          )}

          {!hasFileConfig() && (
            <div className="alert alert-info my-3">
              <h3>Import/Export config.yml</h3>
              <p>
                {isCloud()
                  ? "GrowthBook Cloud stores"
                  : "You are currently storing"}{" "}
                all organization settings, data sources, metrics, and dimensions
                in a database.
              </p>
              <p>
                You can import/export these settings to a{" "}
                <code>config.yml</code> file to more easily move between
                GrowthBook Cloud accounts and/or self-hosted environments.{" "}
                <DocLink docSection="config_yml" className="font-weight-bold">
                  Learn More
                </DocLink>
              </p>
              <div className="row mb-3">
                <div className="col-auto">
                  <BackupConfigYamlButton settings={settings} />
                </div>
                <div className="col-auto">
                  <RestoreConfigYamlButton
                    settings={settings}
                    mutate={refreshOrganization}
                  />
                </div>
              </div>
              <div className="text-muted">
                <strong>Note:</strong> For security reasons, the exported file
                does not include data source connection secrets such as
                passwords. You must edit the file and add these yourself.
              </div>
            </div>
          )}

          {growthbook?.getFeatureValue("import-from-x", false) && (
            <div className="bg-white p-3 border position-relative my-3">
              <h3>Import from another service</h3>
              <p>
                Import your data from another feature flag and/or
                experimentation service.
              </p>
              <Link href="/importing">
                <a className="btn btn-primary">
                  <FaUpload /> Import from another service
                </a>
              </Link>
            </div>
          )}

          <div className="my-3 bg-white p-3 border">
            <div className="row">
              <div className="col-sm-3">
                <h4>North Star Metrics</h4>
              </div>
              <div className="col-sm-9">
                <p>
                  North stars are metrics your team is focused on improving.
                  These metrics are shown on the home page with the experiments
                  that have the metric as a goal.
                </p>
                <div className={"form-group"}>
                  <div className="my-3">
                    <div className="form-group">
                      <label>Metric(s)</label>
                      <MetricsSelector
                        selected={form.watch("northStar.metricIds")}
                        onChange={(metrics) =>
                          form.setValue("northStar.metricIds", metrics)
                        }
                      />
                    </div>
                    <Field
                      label="Title"
                      {...form.register("northStar.title")}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-3 border position-relative">
            <div className="row">
              <div className="col-sm-3">
                <h4>Experiment Settings</h4>
              </div>

              <div className="col-sm-9">
                <div className="form-inline flex-column align-items-start mb-3">
                  <Field
                    label="Minimum experiment length (in days) when importing past
                  experiments"
                    type="number"
                    className="ml-2"
                    containerClassName="mb-3"
                    append="days"
                    step="1"
                    min="0"
                    max="31"
                    disabled={hasFileConfig()}
                    {...form.register("pastExperimentsMinLength", {
                      valueAsNumber: true,
                      min: 0,
                      max: 31,
                    })}
                  />

                  <Field
                    label="Warn when this percent of experiment users are in multiple variations"
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    className="ml-2"
                    containerClassName="mb-3"
                    append="%"
                    style={{
                      width: "80px",
                    }}
                    disabled={hasFileConfig()}
                    {...form.register("multipleExposureMinPercent", {
                      valueAsNumber: true,
                      min: 0,
                      max: 100,
                    })}
                  />

                  <div className="mb-3 form-group flex-column align-items-start">
                    <SelectField
                      label={
                        <AttributionModelTooltip>
                          Default Conversion Window Override{" "}
                          <FaQuestionCircle />
                        </AttributionModelTooltip>
                      }
                      className="ml-2"
                      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
                      value={form.watch("attributionModel")}
                      onChange={(value) => {
                        form.setValue(
                          "attributionModel",
                          value as AttributionModel
                        );
                      }}
                      options={[
                        {
                          label: "Respect Conversion Windows",
                          value: "firstExposure",
                        },
                        {
                          label: "Ignore Conversion Windows",
                          value: "experimentDuration",
                        },
                      ]}
                    />
                  </div>

                  <div className="mb-4 form-group flex-column align-items-start">
                    <Field
                      label="Experiment Auto-Update Frequency"
                      className="ml-2"
                      containerClassName="mb-2 mr-2"
                      disabled={hasFileConfig()}
                      options={[
                        {
                          display: "When results are X hours old",
                          value: "stale",
                        },
                        {
                          display: "Cron Schedule",
                          value: "cron",
                        },
                        {
                          display: "Never",
                          value: "never",
                        },
                      ]}
                      {...form.register("updateSchedule.type")}
                    />
                    {value.updateSchedule?.type === "stale" && (
                      <div className="bg-light p-3 border">
                        <Field
                          label="Refresh when"
                          append="hours old"
                          type="number"
                          step={1}
                          min={1}
                          max={168}
                          className="ml-2"
                          disabled={hasFileConfig()}
                          {...form.register("updateSchedule.hours", {
                            valueAsNumber: true,
                            min: 1,
                            max: 168,
                          })}
                        />
                      </div>
                    )}
                    {value.updateSchedule?.type === "cron" && (
                      <div className="bg-light p-3 border">
                        <Field
                          label="Cron String"
                          className="ml-2"
                          disabled={hasFileConfig()}
                          {...form.register("updateSchedule.cron")}
                          placeholder="0 */6 * * *"
                          onFocus={(e) => {
                            updateCronString(e.target.value);
                          }}
                          onBlur={(e) => {
                            updateCronString(e.target.value);
                          }}
                          helpText={<span className="ml-2">{cronString}</span>}
                        />
                      </div>
                    )}
                  </div>

                  <div className="d-flex form-group mb-3">
                    <label
                      className="mr-1"
                      htmlFor="toggle-factTableQueryOptimization"
                    >
                      <PremiumTooltip
                        commercialFeature="multi-metric-queries"
                        body={
                          <>
                            <p>
                              If multiple metrics from the same Fact Table are
                              added to an experiment, this will combine them
                              into a single query, which is much faster and more
                              efficient.
                            </p>
                            <p>
                              For data sources with usage-based billing like
                              BigQuery or SnowFlake, this can result in
                              substantial cost savings.
                            </p>
                          </>
                        }
                      >
                        Fact Table Query Optimization{" "}
                        <MdInfoOutline className="text-info" />
                      </PremiumTooltip>
                    </label>
                    <Toggle
                      id={"toggle-factTableQueryOptimization"}
                      value={
                        hasCommercialFeature("multi-metric-queries") &&
                        !form.watch("disableMultiMetricQueries")
                      }
                      setValue={(value) => {
                        form.setValue("disableMultiMetricQueries", !value);
                      }}
                      disabled={!hasCommercialFeature("multi-metric-queries")}
                    />
                  </div>

                  <StatsEngineSelect
                    label="Default Statistics Engine"
                    allowUndefined={false}
                    value={form.watch("statsEngine")}
                    onChange={(value) => {
                      setStatsEngineTab(value);
                      form.setValue("statsEngine", value);
                    }}
                    labelClassName="mr-2"
                  />
                </div>

                <div className="mb-3 form-group flex-column align-items-start">
                  <h4>Stats Engine Settings</h4>

                  <ControlledTabs
                    newStyle={true}
                    className="mt-3"
                    buttonsClassName="px-5"
                    tabContentsClassName="border"
                    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Dispatch<SetStateAction<string>>' is not ass... Remove this comment to see the full error message
                    setActive={setStatsEngineTab}
                    active={statsEngineTab}
                  >
                    <Tab id="bayesian" display="Bayesian">
                      <h4 className="mb-4 text-purple">Bayesian Settings</h4>

                      <div className="form-group mb-2 mr-2 form-inline">
                        <Field
                          label="Chance to win threshold"
                          type="number"
                          step="any"
                          min="70"
                          max="99"
                          style={{
                            width: "80px",
                            borderColor: highlightColor,
                            backgroundColor: highlightColor
                              ? highlightColor + "15"
                              : "",
                          }}
                          className={`ml-2`}
                          containerClassName="mb-3"
                          append="%"
                          disabled={hasFileConfig()}
                          helpText={
                            <>
                              <span className="ml-2">(95% is default)</span>
                              <div
                                className="ml-2"
                                style={{
                                  color: highlightColor,
                                  flexBasis: "100%",
                                }}
                              >
                                {warningMsg}
                              </div>
                            </>
                          }
                          {...form.register("confidenceLevel", {
                            valueAsNumber: true,
                            min: 50,
                            max: 100,
                          })}
                        />
                      </div>
                    </Tab>

                    <Tab id="frequentist" display="Frequentist">
                      <h4 className="mb-4 text-purple">Frequentist Settings</h4>

                      <div className="form-group mb-2 mr-2 form-inline">
                        <Field
                          label="P-value threshold"
                          type="number"
                          step="0.001"
                          max="0.5"
                          min="0.001"
                          style={{
                            borderColor: pHighlightColor,
                            backgroundColor: pHighlightColor
                              ? pHighlightColor + "15"
                              : "",
                          }}
                          className={`ml-2`}
                          containerClassName="mb-3"
                          append=""
                          disabled={hasFileConfig()}
                          helpText={
                            <>
                              <span className="ml-2">(0.05 is default)</span>
                              <div
                                className="ml-2"
                                style={{
                                  color: pHighlightColor,
                                  flexBasis: "100%",
                                }}
                              >
                                {pWarningMsg}
                              </div>
                            </>
                          }
                          {...form.register("pValueThreshold", {
                            valueAsNumber: true,
                            min: 0,
                            max: 1,
                          })}
                        />
                      </div>
                      <div className="mb-3  form-inline flex-column align-items-start">
                        <SelectField
                          label={"Multiple comparisons correction to use: "}
                          className="ml-2"
                          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | null' is not assignable to type 'st... Remove this comment to see the full error message
                          value={form.watch("pValueCorrection") ?? null}
                          onChange={(value) =>
                            form.setValue(
                              "pValueCorrection",
                              value as PValueCorrection
                            )
                          }
                          sort={false}
                          options={[
                            {
                              label: "None",
                              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'string'.
                              value: null,
                            },
                            {
                              label: "Holm-Bonferroni (Control FWER)",
                              value: "holm-bonferroni",
                            },
                            {
                              label: "Benjamini-Hochberg (Control FDR)",
                              value: "benjamini-hochberg",
                            },
                          ]}
                        />
                      </div>
                      <div className="p-3 my-3 border rounded">
                        <h5 className="font-weight-bold mb-4">
                          <PremiumTooltip commercialFeature="regression-adjustment">
                            <GBCuped /> Regression Adjustment (CUPED)
                          </PremiumTooltip>
                        </h5>
                        <div className="form-group mb-0 mr-2">
                          <div className="d-flex">
                            <label
                              className="mr-1"
                              htmlFor="toggle-regressionAdjustmentEnabled"
                            >
                              Apply regression adjustment by default
                            </label>
                            <Toggle
                              id={"toggle-regressionAdjustmentEnabled"}
                              value={
                                !!form.watch("regressionAdjustmentEnabled")
                              }
                              setValue={(value) => {
                                form.setValue(
                                  "regressionAdjustmentEnabled",
                                  value
                                );
                              }}
                              disabled={
                                !hasRegressionAdjustmentFeature ||
                                hasFileConfig()
                              }
                            />
                          </div>
                          {form.watch("regressionAdjustmentEnabled") &&
                            form.watch("statsEngine") === "bayesian" && (
                              <div className="d-flex">
                                <small className="mb-1 text-warning-orange">
                                  <FaExclamationTriangle /> Your organization
                                  uses Bayesian statistics by default and
                                  regression adjustment is not implemented for
                                  the Bayesian engine.
                                </small>
                              </div>
                            )}
                        </div>
                        <div
                          className="form-group mt-3 mb-0 mr-2 form-inline"
                          style={{
                            opacity: form.watch("regressionAdjustmentEnabled")
                              ? "1"
                              : "0.5",
                          }}
                        >
                          <Field
                            label="Pre-exposure lookback period (days)"
                            type="number"
                            style={{
                              borderColor: regressionAdjustmentDaysHighlightColor,
                              backgroundColor: regressionAdjustmentDaysHighlightColor
                                ? regressionAdjustmentDaysHighlightColor + "15"
                                : "",
                            }}
                            className={`ml-2`}
                            containerClassName="mb-0"
                            append="days"
                            min="0"
                            max="100"
                            disabled={
                              !hasRegressionAdjustmentFeature || hasFileConfig()
                            }
                            helpText={
                              <>
                                <span className="ml-2">
                                  ({DEFAULT_REGRESSION_ADJUSTMENT_DAYS} is
                                  default)
                                </span>
                              </>
                            }
                            {...form.register("regressionAdjustmentDays", {
                              valueAsNumber: true,
                              validate: (v) => {
                                // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                                return !(v <= 0 || v > 100);
                              },
                            })}
                          />
                          {regressionAdjustmentDaysWarningMsg && (
                            <small
                              style={{
                                color: regressionAdjustmentDaysHighlightColor,
                              }}
                            >
                              {regressionAdjustmentDaysWarningMsg}
                            </small>
                          )}
                        </div>
                      </div>

                      <div className="p-3 my-3 border rounded">
                        <h5 className="font-weight-bold mb-4">
                          <PremiumTooltip commercialFeature="sequential-testing">
                            <GBSequential /> Sequential Testing
                          </PremiumTooltip>
                        </h5>
                        <div className="form-group mb-0 mr-2">
                          <div className="d-flex">
                            <label
                              className="mr-1"
                              htmlFor="toggle-sequentialTestingEnabled"
                            >
                              Apply sequential testing by default
                            </label>
                            <Toggle
                              id={"toggle-sequentialTestingEnabled"}
                              value={!!form.watch("sequentialTestingEnabled")}
                              setValue={(value) => {
                                form.setValue(
                                  "sequentialTestingEnabled",
                                  value
                                );
                              }}
                              disabled={
                                !hasSequentialTestingFeature || hasFileConfig()
                              }
                            />
                          </div>
                          {form.watch("sequentialTestingEnabled") &&
                            form.watch("statsEngine") === "bayesian" && (
                              <div className="d-flex">
                                <small className="mb-1 text-warning-orange">
                                  <FaExclamationTriangle /> Your organization
                                  uses Bayesian statistics by default and
                                  sequential testing is not implemented for the
                                  Bayesian engine.
                                </small>
                              </div>
                            )}
                        </div>
                        <div
                          className="form-group mt-3 mb-0 mr-2 form-inline"
                          style={{
                            opacity: form.watch("sequentialTestingEnabled")
                              ? "1"
                              : "0.5",
                          }}
                        >
                          <Field
                            label="Tuning parameter"
                            type="number"
                            className={`ml-2`}
                            containerClassName="mb-0"
                            min="0"
                            disabled={
                              !hasSequentialTestingFeature || hasFileConfig()
                            }
                            helpText={
                              <>
                                <span className="ml-2">
                                  ({DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                                  is default)
                                </span>
                              </>
                            }
                            {...form.register(
                              "sequentialTestingTuningParameter",
                              {
                                valueAsNumber: true,
                                validate: (v) => {
                                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                                  return !(v <= 0);
                                },
                              }
                            )}
                          />
                        </div>
                      </div>
                    </Tab>
                  </ControlledTabs>
                </div>

                <h4 className="mt-4 mb-2">Sticky Bucketing Settings</h4>
                <div className="appbox py-2 px-3">
                  <div className="w-100 mt-2">
                    <div className="d-flex">
                      <label
                        className="mr-2"
                        htmlFor="toggle-useStickyBucketing"
                      >
                        <PremiumTooltip
                          commercialFeature={"sticky-bucketing"}
                          body={<StickyBucketingTooltip />}
                        >
                          Enable Sticky Bucketing <FaQuestionCircle />
                        </PremiumTooltip>
                      </label>
                      <Toggle
                        id={"toggle-useStickyBucketing"}
                        value={!!form.watch("useStickyBucketing")}
                        setValue={(value) => {
                          form.setValue(
                            "useStickyBucketing",
                            hasStickyBucketFeature ? value : false
                          );
                        }}
                        disabled={
                          !form.watch("useStickyBucketing") &&
                          (!hasStickyBucketFeature ||
                            !hasSDKWithStickyBucketing)
                        }
                      />
                    </div>
                    {!form.watch("useStickyBucketing") && (
                      <div className="small">
                        <StickyBucketingToggleWarning
                          hasSDKWithStickyBucketing={hasSDKWithStickyBucketing}
                        />
                      </div>
                    )}
                  </div>

                  {form.watch("useStickyBucketing") && (
                    <div className="w-100 mt-4">
                      <div className="d-flex">
                        <label
                          className="mr-2"
                          htmlFor="toggle-useFallbackAttributes"
                        >
                          <Tooltip
                            body={
                              <>
                                <div className="mb-2">
                                  If the user&apos;s assignment attribute is not
                                  available a fallback attribute may be used
                                  instead. Toggle this to allow selection of a
                                  fallback attribute when creating experiments.
                                </div>
                                <div>
                                  While using a fallback attribute can improve
                                  the consistency of the user experience, it can
                                  also lead to statistical biases if not
                                  implemented carefully. See the Sticky
                                  Bucketing docs for more information.
                                </div>
                              </>
                            }
                          >
                            Enable fallback attributes in experiments{" "}
                            <FaQuestionCircle />
                          </Tooltip>
                        </label>
                        <Toggle
                          id={"toggle-useFallbackAttributes"}
                          value={!!form.watch("useFallbackAttributes")}
                          setValue={(value) =>
                            form.setValue("useFallbackAttributes", value)
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <h4 className="mt-4 mb-2">Experiment Health Settings</h4>
                <div className="appbox pt-2 px-3">
                  <div className="form-group mb-2 mt-2 mr-2 form-inline">
                    <label
                      className="mr-1"
                      htmlFor="toggle-runHealthTrafficQuery"
                    >
                      Run traffic query by default
                    </label>
                    <Toggle
                      id={"toggle-runHealthTrafficQuery"}
                      value={!!form.watch("runHealthTrafficQuery")}
                      setValue={(value) => {
                        form.setValue("runHealthTrafficQuery", value);
                      }}
                    />
                  </div>

                  <div className="mt-3 form-inline flex-column align-items-start">
                    <Field
                      label="SRM p-value threshold"
                      type="number"
                      step="0.001"
                      style={{
                        borderColor: srmHighlightColor,
                        backgroundColor: srmHighlightColor
                          ? srmHighlightColor + "15"
                          : "",
                      }}
                      max="0.1"
                      min="0.00001"
                      className={`ml-2`}
                      containerClassName="mb-3"
                      append=""
                      disabled={hasFileConfig()}
                      helpText={
                        <>
                          <span className="ml-2">(0.001 is default)</span>
                          <div
                            className="ml-2"
                            style={{
                              color: srmHighlightColor,
                              flexBasis: "100%",
                            }}
                          >
                            {srmWarningMsg}
                          </div>
                        </>
                      }
                      {...form.register("srmThreshold", {
                        valueAsNumber: true,
                        min: 0,
                        max: 1,
                      })}
                    />
                  </div>
                </div>

                <div
                  className="mb-3 form-group flex-column align-items-start"
                  id="edit-launch-checklist"
                >
                  <PremiumTooltip
                    commercialFeature="custom-launch-checklist"
                    premiumText="Custom pre-launch checklists are available to Enterprise customers"
                  >
                    <div className="d-inline-block h4 mt-4 mb-0">
                      Experiment Pre-Launch Checklist
                    </div>
                  </PremiumTooltip>
                  <p className="pt-2">
                    Configure required steps that need to be completed before an
                    experiment can be launched.
                  </p>
                  <Button
                    disabled={!hasCustomChecklistFeature}
                    onClick={async () => {
                      setEditChecklistOpen(true);
                    }}
                  >
                    Edit Checklist
                  </Button>
                </div>
              </div>
            </div>

            <div className="divider border-bottom mb-3 mt-3" />

            <div className="row">
              <div className="col-sm-3">
                <h4>Metrics Settings</h4>
              </div>
              <div className="col-sm-9">
                <div className="form-inline">
                  <Field
                    label="Amount of historical data to use on metric analysis page"
                    type="number"
                    append="days"
                    className="ml-2"
                    containerClassName="mb-0"
                    disabled={hasFileConfig()}
                    {...form.register("metricAnalysisDays", {
                      valueAsNumber: true,
                    })}
                  />
                  {metricAnalysisDaysWarningMsg && (
                    <small className="text-danger">
                      {metricAnalysisDaysWarningMsg}
                    </small>
                  )}
                </div>

                {/* region Metrics Behavior Defaults */}
                <>
                  <h5 className="mt-4">Metrics Behavior Defaults</h5>
                  <p>
                    These are the pre-configured default values that will be
                    used when configuring metrics. You can always change these
                    values on a per-metric basis.
                  </p>

                  {/* region Minimum Sample Size */}
                  <div>
                    <div className="form-inline">
                      <Field
                        label="Minimum Sample Size"
                        type="number"
                        min={0}
                        className="ml-2"
                        containerClassName="mt-2"
                        disabled={hasFileConfig()}
                        {...form.register("metricDefaults.minimumSampleSize", {
                          valueAsNumber: true,
                          min: 0,
                        })}
                      />
                    </div>
                    <p>
                      <small className="text-muted mb-3">
                        The total count required in an experiment variation
                        before showing results
                      </small>
                    </p>
                  </div>
                  {/* endregion Minimum Sample Size */}

                  {/* region Maximum Percentage Change */}
                  <div>
                    <div className="form-inline">
                      <Field
                        label="Maximum Percentage Change"
                        type="number"
                        min={0}
                        append="%"
                        className="ml-2"
                        containerClassName="mt-2"
                        disabled={hasFileConfig()}
                        {...form.register(
                          "metricDefaults.maxPercentageChange",
                          {
                            valueAsNumber: true,
                            min: 0,
                          }
                        )}
                      />
                    </div>
                    <p>
                      <small className="text-muted mb-3">
                        An experiment that changes the metric by more than this
                        percent will be flagged as suspicious
                      </small>
                    </p>
                  </div>
                  {/* endregion Maximum Percentage Change */}

                  {/* region Minimum Percentage Change */}
                  <div>
                    <div className="form-inline">
                      <Field
                        label="Minimum Percentage Change"
                        type="number"
                        min={0}
                        append="%"
                        className="ml-2"
                        containerClassName="mt-2"
                        disabled={hasFileConfig()}
                        {...form.register(
                          "metricDefaults.minPercentageChange",
                          {
                            valueAsNumber: true,
                            min: 0,
                          }
                        )}
                      />
                    </div>
                    <p>
                      <small className="text-muted mb-3">
                        An experiment that changes the metric by less than this
                        percent will be considered a draw
                      </small>
                    </p>
                  </div>
                  {/* endregion Minimum Percentage Change */}
                </>
                {/* endregion Metrics Behavior Defaults */}
                <>
                  <SelectField
                    label="Display Currency"
                    value={form.watch("displayCurrency") || "USD"}
                    options={currencyOptions}
                    onChange={(v: string) =>
                      form.setValue("displayCurrency", v)
                    }
                    required
                    placeholder="Select currency..."
                    helpText="This should match what is stored in the data source and controls what currency symbol is displayed."
                  />
                </>
              </div>
            </div>

            <div className="divider border-bottom mb-3 mt-3" />

            <div className="row">
              <div className="col-sm-3">
                <h4>Features Settings</h4>
              </div>
              <div className="col-sm-9">
                <div className="form-inline">
                  <Field
                    label={
                      <PremiumTooltip
                        commercialFeature={"hash-secure-attributes"}
                        body={
                          <>
                            <p>
                              Feature targeting conditions referencing{" "}
                              <code>secureString</code> attributes will be
                              anonymized via SHA-256 hashing. When evaluating
                              feature flags in a public or insecure environment
                              (such as a browser), hashing provides an
                              additional layer of security through obfuscation.
                              This allows you to target users based on sensitive
                              attributes.
                            </p>
                            <p>
                              You must enable this feature in your SDK
                              Connection for it to take effect.
                            </p>
                            <p>
                              You may add a cryptographic salt string (a random
                              string of your choosing) to the hashing algorithm,
                              which helps defend against hash lookup
                              vulnerabilities.
                            </p>
                            <p className="mb-0 text-warning-orange small">
                              <FaExclamationCircle /> When using an insecure
                              environment, do not rely exclusively on hashing as
                              a means of securing highly sensitive data. Hashing
                              is an obfuscation technique that makes it very
                              difficult, but not impossible, to extract
                              sensitive data.
                            </p>
                          </>
                        }
                      >
                        Salt string for secure attributes <FaQuestionCircle />
                      </PremiumTooltip>
                    }
                    disabled={!hasSecureAttributesFeature}
                    className="ml-2"
                    containerClassName="mb-3"
                    type="string"
                    {...form.register("secureAttributeSalt")}
                  />
                </div>

                <div>
                  <label
                    className="mr-1"
                    htmlFor="toggle-killswitchConfirmation"
                  >
                    Require confirmation when changing an environment kill
                    switch
                  </label>
                </div>
                <div>
                  <Toggle
                    id={"toggle-killswitchConfirmation"}
                    value={!!form.watch("killswitchConfirmation")}
                    setValue={(value) => {
                      form.setValue("killswitchConfirmation", value);
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="divider border-bottom mb-3 mt-3" />
            <div className="row">
              <div className="col-sm-3">
                <h4>Data Source Settings</h4>
              </div>
              <div className="col-sm-9">
                <>
                  <SelectField
                    label="Default Data Source (Optional)"
                    value={form.watch("defaultDataSource") || ""}
                    options={datasources.map((d) => ({
                      label: d.name,
                      value: d.id,
                    }))}
                    onChange={(v: string) =>
                      form.setValue("defaultDataSource", v)
                    }
                    isClearable={true}
                    placeholder="Select a data source..."
                    helpText="The default data source is the default data source selected when creating metrics and experiments."
                  />
                </>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="bg-main-color position-sticky w-100 py-3 border-top"
        style={{ bottom: 0, height: 70 }}
      >
        <div className="container-fluid pagecontents d-flex">
          <div className="flex-grow-1 mr-4">
            {saveMsg && (
              <TempMessage
                className="mb-0 py-2"
                close={() => {
                  setSaveMsg(false);
                }}
              >
                Settings saved
              </TempMessage>
            )}
          </div>
          <div>
            <Button
              style={{ marginRight: "4rem" }}
              color={"primary"}
              disabled={!ctaEnabled}
              onClick={async () => {
                if (!ctaEnabled) return;
                await saveSettings();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeneralSettingsPage;
