import { Box, Flex, Slider } from "@radix-ui/themes";
import React, { useEffect, useState } from "react";
import { FaDownload, FaExternalLinkAlt } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { PiCaretDownFill, PiHourglassMedium, PiInfoFill } from "react-icons/pi";
import { Permissions } from "shared/permissions";
import {
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "back-end/types/report";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { RowResults } from "@/services/experiments";
import HelperText from "@/ui/HelperText";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import Badge from "@/ui/Badge";
import Button, { Size } from "@/ui/Button";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import LinkButton from "@/ui/LinkButton";
import Avatar from "@/ui/Avatar";
import Field from "@/components/Forms/Field";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import RadioCards from "@/ui/RadioCards";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import DataList from "@/ui/DataList";
import Stepper from "@/components/Stepper/Stepper";
import Link from "@/ui/Link";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import Metadata from "@/ui/Metadata";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import DatePicker from "@/components/DatePicker";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import SplitButton from "@/ui/SplitButton";
import PremiumCallout from "@/ui/PremiumCallout";
import { UserContext } from "@/services/UserContext";
import AnalysisResultPopover from "@/components/AnalysisResultPopover/AnalysisResultPopover";
import Frame from "@/ui/Frame";

export default function DesignSystemPage() {
  const [checked, setChecked] = useState<"indeterminate" | boolean>(false);
  const [size, setSize] = useState<Size>("md");
  const [buttonLoadError, setButtonLoadError] = useState<string | null>(null);
  const [date1, setDate1] = useState<Date | undefined>();
  const [date2, setDate2] = useState<Date | undefined>();
  const [radioSelected, setRadioSelected] = useState("k1");
  const [radioCardSelected, setRadioCardSelected] = useState("");
  const [radioCardColumns, setRadioCardColumns] = useState<
    "1" | "2" | "3" | "4" | "5" | "6"
  >("1");
  const [sliderVal, setSliderVal] = useState(10);
  const [stepperStep, setStepperStep] = useState(0);
  const [selectValue, setSelectValue] = useState("carrot");
  const [activeControlledTab, setActiveControlledTab] = useState("tab1");

  // Mock data for AnalysisResultPopover scenarios
  const variationA = {
    id: "v0",
    name: "Control",
    weight: 0.5,
    index: 0,
  } as ExperimentReportVariationWithIndex;
  const variationB = {
    id: "v1",
    name: "Variation",
    weight: 0.5,
    index: 1,
  } as ExperimentReportVariationWithIndex;

  const baselineMetric: SnapshotMetric = {
    value: 1000,
    cr: 1.0,
    users: 1000,
    ci: [-0.01, 0.01],
  };

  const statsWin: SnapshotMetric = {
    value: 1100,
    cr: 1.1,
    users: 1000,
    expected: 0.1,
    ci: [0.02, 0.18],
    ciAdjusted: [0.015, 0.175],
    pValue: 0.02,
    pValueAdjusted: 0.025,
    chanceToWin: 0.92,
  };

  const statsLose: SnapshotMetric = {
    value: 900,
    cr: 0.9,
    users: 1000,
    expected: -0.08,
    ci: [-0.15, -0.01],
    pValue: 0.03,
    chanceToWin: 0.08,
  };

  const statsNotEnough: SnapshotMetric = {
    value: 10,
    cr: 0.01,
    users: 20,
    expected: 0,
  };

  const baseRowResults: RowResults = {
    hasData: true,
    enoughData: true,
    enoughDataMeta: {
      reason: "notEnoughData",
      reasonText: "Collect more data to reach minimum sample size",
      percentComplete: 1,
      percentCompleteNumerator: 1,
      percentCompleteDenominator: 1,
      timeRemainingMs: 0,
      showTimeRemaining: false,
    },
    hasScaledImpact: true,
    significant: true,
    significantUnadjusted: true,
    significantReason: "p < 0.05",
    suspiciousChange: false,
    suspiciousThreshold: 0.25,
    suspiciousChangeReason: "",
    belowMinChange: false,
    risk: 0.01,
    relativeRisk: 0.01,
    riskMeta: {
      riskStatus: "ok",
      showRisk: false,
      riskFormatted: "1%",
      relativeRiskFormatted: "1%",
      riskReason: "",
    },
    guardrailWarning: "",
    directionalStatus: "winning",
    resultsStatus: "won",
    resultsReason: "",
  };

  const rowResultsWin: RowResults = {
    ...baseRowResults,
    directionalStatus: "winning",
    resultsStatus: "won",
    resultsReason: "Significant improvement",
  };

  const rowResultsLose: RowResults = {
    ...baseRowResults,
    directionalStatus: "losing",
    resultsStatus: "lost",
    resultsReason: "Significant regression",
  };

  const rowResultsInsig: RowResults = {
    ...baseRowResults,
    significant: false,
    significantUnadjusted: false,
    directionalStatus: "winning",
    resultsStatus: "draw",
    resultsReason: "Not significant",
  };

  const rowResultsNotEnough: RowResults = {
    ...baseRowResults,
    hasData: true,
    enoughData: false,
    significant: false,
    enoughDataMeta: {
      reason: "notEnoughData",
      reasonText: "Need 1,000 users per variation",
      percentComplete: 0.12,
      percentCompleteNumerator: 120,
      percentCompleteDenominator: 1000,
      timeRemainingMs: null,
      showTimeRemaining: false,
    },
  };

  const rowResultsBaselineZero: RowResults = {
    ...rowResultsNotEnough,
    enoughDataMeta: {
      reason: "baselineZero",
      reasonText: "Baseline has zero value",
    },
  };

  const rowResultsSuspicious: RowResults = {
    ...rowResultsWin,
    suspiciousChange: true,
    suspiciousThreshold: 0.3,
    suspiciousChangeReason:
      "Observed change exceeds historical variability threshold",
  };

  const metricBinomial = {
    id: "m_bin",
    name: "Signup Rate",
    type: "binomial",
    inverse: false,
  } as unknown as ExperimentMetricInterface;

  const metricInverse = {
    id: "m_inv",
    name: "Bounce Rate",
    type: "binomial",
    inverse: true,
  } as unknown as ExperimentMetricInterface;

  const metricWithDenominator = {
    id: "m_ratio_like",
    name: "Purchases per User",
    type: "count",
    denominator: "m_users",
    inverse: false,
  } as unknown as ExperimentMetricInterface;

  const factRatioMetric = {
    id: "fact_ratio",
    name: "ARPU (Fact Ratio)",
    metricType: "ratio",
    numerator: { factTableId: "ft1", column: "revenue", filters: [] },
    denominator: { factTableId: "ft1", column: "sessions", filters: [] },
    inverse: false,
  } as unknown as ExperimentMetricInterface;

  const factQuantileUnit = {
    id: "fact_quantile_unit",
    name: "p90 Session Duration (Unit)",
    metricType: "quantile",
    numerator: { factTableId: "ft1", column: "session_duration", filters: [] },
    quantileSettings: { type: "unit", quantile: 0.9, ignoreZeros: true },
    inverse: false,
  } as unknown as ExperimentMetricInterface;

  const factQuantileEvent = {
    id: "fact_quantile_event",
    name: "p90 Event Value (Event)",
    metricType: "quantile",
    numerator: { factTableId: "ft1", column: "event_value", filters: [] },
    quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
    inverse: false,
  } as unknown as ExperimentMetricInterface;

  type ARPData = {
    metricRow: number;
    metric: ExperimentMetricInterface;
    metricSnapshotSettings?: MetricSnapshotSettings;
    dimensionName?: string;
    dimensionValue?: string;
    variation: ExperimentReportVariationWithIndex;
    stats: SnapshotMetric;
    baseline: SnapshotMetric;
    baselineVariation: ExperimentReportVariationWithIndex;
    rowResults: RowResults;
    statsEngine: StatsEngine;
    pValueCorrection?: PValueCorrection;
    isGuardrail: boolean;
  };

  function makeData({
    metric,
    stats,
    baseline,
    rowResults,
    statsEngine = "frequentist",
    pValueCorrection = null,
    isGuardrail = false,
    dimensionName,
    dimensionValue,
    metricSnapshotSettings,
  }: {
    metric: ExperimentMetricInterface;
    stats: SnapshotMetric;
    baseline: SnapshotMetric;
    rowResults: RowResults;
    statsEngine?: StatsEngine;
    pValueCorrection?: PValueCorrection | null;
    isGuardrail?: boolean;
    dimensionName?: string;
    dimensionValue?: string;
    metricSnapshotSettings?: MetricSnapshotSettings;
  }): ARPData {
    return {
      metricRow: 0,
      metric,
      metricSnapshotSettings,
      dimensionName,
      dimensionValue,
      variation: variationB,
      stats,
      baseline,
      baselineVariation: variationA,
      rowResults,
      statsEngine,
      pValueCorrection,
      isGuardrail,
    };
  }

  return (
    <div className="pagecontents container-fluid pt-4 pb-3">
      <h1>GrowthBook Design System</h1>
      <p>
        This page is a work in progress to document the GrowthBook design
        system.
      </p>

      <h2>Components</h2>

      <div className="appbox p-3">
        <h3>Avatar</h3>
        <Flex direction="row" gap="3">
          <Avatar>BF</Avatar>
          <Avatar color="green">
            <PiInfoFill size={25} />
          </Avatar>
          <Avatar size="lg" radius="small">
            <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
          </Avatar>
          <Avatar color="orange" variant="soft" size="sm">
            sm
          </Avatar>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Badge</h3>
        <Flex direction="column" gap="3">
          <Flex>
            <Badge label="Label" />
          </Flex>
          <Flex>
            <Badge color="indigo" label="Label" />
          </Flex>
          <Flex>
            <Badge color="cyan" label="Label" />
          </Flex>
          <Flex>
            <Badge color="orange" label="Label" />
          </Flex>
          <Flex>
            <Badge color="crimson" label="Label" />
          </Flex>
          <Flex>
            <Badge variant="solid" label="Label" />
          </Flex>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Button</h3>
        <div className="mb-2 w-200px">
          <SelectField
            value={size}
            options={[
              { label: "extra sm", value: "xs" },
              { label: "small", value: "sm" },
              { label: "medium", value: "md" },
              { label: "large", value: "lg" },
            ]}
            sort={false}
            onChange={(v: Size) => setSize(v)}
          />
        </div>
        <Flex direction="row" gap="3" className="my-3">
          <Button size={size}>Primary</Button>
          <Button size={size} aria-label="Aria" variant="outline">
            Aria
          </Button>
          <Button size={size} color="red">
            Danger
          </Button>
          <Button size={size} variant="soft">
            Primary soft
          </Button>
          <Button size={size} color="red" variant="outline">
            Danger outline
          </Button>
          <Button size={size} variant="ghost">
            Primary ghost
          </Button>
          <Button size={size} icon={<FaDownload />}>
            Download
          </Button>
        </Flex>
        <Flex direction="row" gap="3" className="my-3">
          <Button
            size={size}
            icon={<BsArrowRepeat />}
            onClick={async () =>
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          >
            Click to load...
          </Button>
          <div>
            <Button
              size={size}
              color="red"
              variant="outline"
              mb="2"
              icon={<BsArrowRepeat />}
              onClick={async () =>
                await new Promise((resolve, reject) =>
                  setTimeout(() => {
                    if (Math.random() < 0.5) {
                      resolve();
                    } else {
                      reject(new Error("Something went wrong."));
                    }
                  }, 1000),
                )
              }
              setError={setButtonLoadError}
            >
              This might fail...
            </Button>
            {!!buttonLoadError && (
              <HelperText status="error">{buttonLoadError}</HelperText>
            )}
          </div>
        </Flex>

        <b>LinkButton</b>
        <Flex direction="row" gap="3" className="my-3">
          <LinkButton size={size} variant="ghost" href="https://growthbook.io">
            A button link
          </LinkButton>
          <LinkButton
            size={size}
            disabled
            variant="ghost"
            color="red"
            href="https://growthbook.io"
          >
            A disabled link
          </LinkButton>
        </Flex>

        <b>SplitButton</b>
        <Flex direction="row" gap="3" className="my-3">
          <SplitButton
            menu={
              <DropdownMenu
                trigger={
                  <Button size={size}>
                    <PiCaretDownFill />
                  </Button>
                }
                menuPlacement="end"
              >
                <DropdownMenuItem>Create New Experiment</DropdownMenuItem>
                <DropdownMenuItem>Import Existing Experiment</DropdownMenuItem>
              </DropdownMenu>
            }
          >
            <Button size={size} icon={<FaDownload />}>
              Download
            </Button>
          </SplitButton>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Date Picker</h3>
        <Flex direction="column" gap="3">
          <DatePicker
            label="Choose Date"
            helpText="width: 170"
            date={date1}
            setDate={setDate1}
            precision="datetime"
            disableBefore={new Date()}
            inputWidth={170}
          />

          <DatePicker
            helpText="width: default (100%)"
            date={date1}
            setDate={setDate1}
            precision="datetime"
            disableBefore={new Date()}
          />

          <DatePicker
            date={date1}
            date2={date2}
            setDate={setDate1}
            setDate2={setDate2}
            label={"Start"}
            label2={"End"}
            precision="date"
            disableBefore={new Date()}
            inputWidth={200}
          />
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Link</h3>
        <Flex direction="column" gap="3">
          <Box>
            Here we have <Link href="#">a link</Link> within a sentence.
          </Box>
          <Box>
            <Link href="#" weight="bold">
              Bold link
            </Link>
          </Box>
          <Box>
            <Link href="#" weight="bold" underline="none">
              Link without underline affordance
            </Link>
          </Box>
          <Box>
            And you can{" "}
            <Link color="gray" href="#">
              override
            </Link>{" "}
            the{" "}
            <Link color="sky" href="#">
              link color
            </Link>{" "}
            with{" "}
            <Link color="sky" href="#">
              Radix colors
            </Link>
            .
          </Box>
          <Box>
            We also have{" "}
            <Link href="#" color="dark" weight="bold">
              a custom dark/white color
            </Link>
            .
          </Box>

          <Box>
            Here&apos;s the Link without href where it{" "}
            <Link onClick={() => alert("Hello there")}>
              automatically adapts to a button
            </Link>{" "}
            while keeping the same style.
          </Box>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Callout</h3>
        <Flex direction="column" gap="3" mb="4">
          <Callout status="info">This is an informational callout.</Callout>
          <Callout status="warning">This is a warning callout.</Callout>
          <Callout status="error">This is an error callout.</Callout>
          <Callout status="success">This is a success callout.</Callout>
          <Callout
            status="info"
            dismissible
            id="design-system-dismissable"
            renderWhenDismissed={(undismiss) => (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  undismiss();
                }}
              >
                Un-dismiss
              </a>
            )}
          >
            This is a dismissible callout.
          </Callout>
        </Flex>

        <h3>PremiumCallout</h3>
        <UserContext.Provider
          // eslint-disable-next-line
          // @ts-expect-error
          value={{
            hasCommercialFeature: (feature) =>
              feature === "multi-armed-bandits",
            commercialFeatureLowestPlan: {
              "visual-editor": "pro",
              "custom-roles": "enterprise",
              "multi-armed-bandits": "pro",
            } as const,
            users: new Map(),
            organization: {},
            permissionsUtil: new Permissions({
              global: {
                permissions: {
                  manageBilling: true,
                },
                limitAccessByEnvironment: false,
                environments: [],
              },
              projects: {},
            }),
          }}
        >
          <Flex direction="column" gap="3">
            <PremiumCallout
              commercialFeature="visual-editor"
              id="design-system-pro"
            >
              This Pro feature unlocks extra power and speed.
            </PremiumCallout>
            <PremiumCallout
              commercialFeature="custom-roles"
              id="design-system-enterprise"
            >
              This Enterprise feature gives you enhanced security and
              compliance.
            </PremiumCallout>
            <PremiumCallout
              commercialFeature="multi-armed-bandits"
              id="design-system-dismissable"
              docSection="bandits"
              dismissable={true}
              renderWhenDismissed={(undismiss) => (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    undismiss();
                  }}
                >
                  Un-dismiss
                </a>
              )}
            >
              You already have access to this premium feature. This gives you a
              docs link and is dismissable.
            </PremiumCallout>
          </Flex>
        </UserContext.Provider>
      </div>

      <div className="appbox p-3">
        <h3>Checkbox</h3>
        <Flex direction="column" gap="3">
          <Checkbox
            label="Checkbox Label"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
          />
          <Checkbox
            label="Checkbox With Description"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            description="This is a description"
          />
          <Checkbox
            label="Checkbox in Indeterminate State"
            value={"indeterminate"}
            setValue={(v) => {
              setChecked(v);
            }}
          />
          <Checkbox
            label="Checkbox With Warning (and description)"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            description="This is a description"
            error="This is a warning message"
            errorLevel="warning"
          />
          <Checkbox
            label="Checkbox With Error"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            error="This is an error message"
          />
          <Checkbox
            label="Disabled"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            disabled
          />
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3 className="mb-4">DataList</h3>
        <DataList
          header="Header"
          columns={4}
          data={[
            { label: "Label 1", value: "Value 1" },
            {
              label: "Label 2",
              value: "A very long value that will wrap to multiple lines",
            },
            {
              label: "With Tooltip",
              value: "Value 3",
              tooltip: "This is a label tooltip",
            },
            {
              label: "Label 4",
              value: (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                >
                  Link Value <FaExternalLinkAlt />
                </a>
              ),
            },
            {
              label: "Label 5",
              value: (
                <>
                  <em>Other</em> value{" "}
                  <span className="text-muted">formatting</span>
                </>
              ),
            },
            { label: "Label 6", value: "Value 6" },
          ]}
        />
      </div>

      <div className="appbox p-3">
        <h3>HelperText</h3>
        <Flex direction="column" gap="3">
          <HelperText status="info">This is an info message</HelperText>
          <HelperText status="warning">This is a warning message</HelperText>
          <HelperText status="error">This is an error message</HelperText>
          <HelperText status="success">This is a success message</HelperText>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Dropdown</h3>
        <Flex direction="row" justify="between">
          <DropdownMenu trigger="Menu">
            <DropdownMenuLabel>Menu Label</DropdownMenuLabel>
            <DropdownSubMenu trigger="Item 1">
              <DropdownMenuItem>Item 1.1</DropdownMenuItem>
            </DropdownSubMenu>
            <DropdownMenuItem
              onClick={function (): void {
                alert("Item 2");
              }}
            >
              Item 2
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Item 3</DropdownMenuItem>
            <DropdownMenuItem disabled>Item 4</DropdownMenuItem>
            <DropdownMenuItem color="red">Item 5</DropdownMenuItem>
          </DropdownMenu>

          <DropdownMenu trigger="Add Experiment" menuPlacement="end">
            <DropdownMenuItem>Create New Experiment</DropdownMenuItem>
            <DropdownMenuItem>Import Existing Experiment</DropdownMenuItem>
          </DropdownMenu>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Radio Card</h3>
        <div className="mb-2 w-100px">
          <SelectField
            label="columns"
            value={radioCardColumns}
            options={[
              { label: "1", value: "1" },
              { label: "2", value: "2" },
              { label: "3", value: "3" },
              { label: "4", value: "4" },
              { label: "5", value: "5" },
              { label: "6", value: "6" },
            ]}
            sort={false}
            onChange={(v: "1" | "2" | "3" | "4" | "5" | "6") =>
              setRadioCardColumns(v)
            }
          />
        </div>
        <RadioCards
          columns={radioCardColumns}
          width={radioCardColumns === "1" ? "400px" : undefined}
          value={radioCardSelected}
          setValue={(v) => {
            setRadioCardSelected(v);
          }}
          options={[
            {
              value: "k1",
              label: "Radio Card 1",
            },
            {
              value: "k2",
              label: "Radio Card 2 with avatar",
              avatar: <Avatar radius="small">BF</Avatar>,
            },
            {
              value: "k3",
              label: "Radio Card 3, with description",
              description: "This is a description",
              avatar: (
                <Avatar radius="small">
                  <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
                </Avatar>
              ),
            },
            {
              value: "k4",
              label: "Radio Card 4, disabled",
              description: "This is a description",
              disabled: true,
            },
            {
              value: "k5",
              label: "Radio Card 5, long title, long description",
              description:
                "This is a description. It is very long. It should wrap around without changing the width of the parent container.",
            },
            {
              value: "k6",
              label: (
                <PremiumTooltip
                  // @ts-expect-error - fake feature that nobody has
                  commercialFeature="unobtanium"
                  body="This is an expensive popup message"
                  usePortal={true}
                >
                  Premium Card 6
                </PremiumTooltip>
              ),
              description: "You can't afford this",
            },
          ]}
        />
      </div>

      <div className="appbox p-3">
        <h3>Radio Group</h3>
        <RadioGroup
          value={radioSelected}
          setValue={(v) => {
            setRadioSelected(v);
          }}
          options={[
            {
              value: "k1",
              label: "Radio 1",
            },
            {
              value: "k2",
              label: "Radio 2",
            },
            {
              value: "k3",
              label: "Radio 3, with description",
              description: "This is a description",
            },
            {
              value: "k4",
              label: "Progressive disclosure",
              description: "Click to render element",
              renderOnSelect: <Field label="Another field" />,
            },
            {
              value: "k5",
              label: "Radio 4, with error",
              error: "This is an error",
              errorLevel: "error",
            },
            {
              value: "k6",
              label: "Radio 5, with warning",
              error:
                "When making multiple changes at the same time, it can be difficult to control for the impact of each change." +
                "              The risk of introducing experimental bias increases. Proceed with caution.",
              errorLevel: "warning",
            },
            {
              value: "k7",
              label: "Radio 6, disabled",
              description: "This is a description",
              disabled: true,
            },
            {
              value: "k8",
              label: "Radio 7, disabled with error",
              description: "This is a description",
              disabled: true,
              error: "This is an error",
              errorLevel: "error",
            },
          ]}
        />
      </div>

      <div className="appbox p-3">
        <h3>Select</h3>
        <Flex direction="column" gap="3" maxWidth="300px">
          <Select
            label="Select"
            defaultValue="carrot"
            value={selectValue}
            setValue={setSelectValue}
          >
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="carrot">Carrot</SelectItem>
            <SelectSeparator />
            <SelectItem value="apple-pie" disabled>
              Apple Pie (disabled)
            </SelectItem>
            <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
          </Select>
          <Select
            label="Select with an error"
            defaultValue="carrot"
            value={selectValue}
            setValue={setSelectValue}
            error="This is an error message"
          >
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="carrot">Carrot</SelectItem>
            <SelectSeparator />
            <SelectItem value="apple-pie">Apple Pie</SelectItem>
            <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
          </Select>
          <Select
            label="Disabled Select"
            defaultValue="carrot"
            value={selectValue}
            setValue={setSelectValue}
            disabled
          >
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="carrot">Carrot</SelectItem>
            <SelectSeparator />
            <SelectItem value="apple-pie">Apple Pie</SelectItem>
            <SelectItem value="carrot-cake">Carrot Cake</SelectItem>
          </Select>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Slider</h3>
        <Flex direction="column" gap="3" maxWidth="300px">
          <div>
            <label>Slider</label>
            <Slider
              value={[sliderVal]}
              min={0}
              max={100}
              step={1}
              onValueChange={(e) => {
                setSliderVal(e[0]);
              }}
            />
            <span className="col-auto" style={{ fontSize: "1.3em" }}>
              {sliderVal}%
            </span>
          </div>
          <div>
            <label>Slider in cyan (high contrast) </label>
            <Slider defaultValue={[35]} color="cyan" highContrast />
          </div>
          <div>
            <label>Slider with no Radius</label>
            <Slider defaultValue={[75]} radius="none" />
          </div>
          <div>
            <label>Range Slider with Soft visual style</label>
            <Slider defaultValue={[25, 75]} variant="soft" />
          </div>
          <div>
            <label>Large Slider Disabled</label>
            <Slider defaultValue={[25]} size="3" disabled={true} />
          </div>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Stepper</h3>
        <Stepper
          step={stepperStep}
          setStep={setStepperStep}
          setError={() => {}}
          steps={[
            { label: "Step 1", enabled: true },
            { label: "Step 2", enabled: true },
            { label: "Step 3", enabled: true },
          ]}
        />
      </div>
      <div className="appbox p-3">
        <h3>Metadata</h3>
        <Flex gap="3">
          <Metadata label="Title" value="Data" />
          <Metadata label="Title1" value="Data1" />
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Tabs</h3>
        <Flex direction="column" gap="3">
          <Box>
            Uncontrolled tabs with persistance in the URL
            <Tabs defaultValue="tab1" persistInURL={true}>
              <TabsList>
                <TabsTrigger value="tab1">
                  <PiHourglassMedium style={{ color: "var(--accent-10)" }} />{" "}
                  Tab 1
                </TabsTrigger>
                <TabsTrigger value="tab2">Tab 2</TabsTrigger>
              </TabsList>

              <Box p="4">
                <TabsContent value="tab1">Tab 1 content</TabsContent>
                <TabsContent value="tab2">Tab 2 content</TabsContent>
              </Box>
            </Tabs>
          </Box>

          <Box>
            Tabs are lazy loaded by default, but you can use forceMount to
            disable this behavior (see console for output).
            <Tabs
              value={activeControlledTab}
              onValueChange={(tab) => setActiveControlledTab(tab)}
            >
              <TabsList>
                <TabsTrigger value="tab1">Tab 1</TabsTrigger>
                <TabsTrigger value="tab2">Tab 2</TabsTrigger>
                <TabsTrigger value="tab3">Tab 3 (forcibly mounted)</TabsTrigger>
              </TabsList>
              <Box p="4">
                <TabsContent value="tab1">
                  <TabContentExample number={1} />
                </TabsContent>
                <TabsContent value="tab2">
                  <TabContentExample number={2} />
                </TabsContent>
                <TabsContent value="tab3" forceMount>
                  <TabContentExample number={3} />
                </TabsContent>
              </Box>
            </Tabs>
          </Box>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>ExperimentStatusIndicator</h3>
        <Flex gap="3">
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "draft",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "running",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "stopped",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "stopped",
              results: "dnf",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "stopped",
              results: "inconclusive",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "stopped",
              results: "won",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: false,
              status: "stopped",
              results: "lost",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
          <ExperimentStatusIndicator
            experimentData={{
              archived: true,
              status: "running",
              variations: [],
              phases: [],
              goalMetrics: [],
              guardrailMetrics: [],
              secondaryMetrics: [],
              datasource: "ds_abc123",
              decisionFrameworkSettings: {},
            }}
          />
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>ResultsIndicator</h3>
        <Flex gap="3">
          <ResultsIndicator results="dnf" />
          <ResultsIndicator results="inconclusive" />
          <ResultsIndicator results="won" />
          <ResultsIndicator results="lost" />
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Analysis Result</h3>
        <Flex direction="column" gap="4">
          <div>
            <b>Frequentist, Relative, Significant Win (p-value adjusted)</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsWin,
                    baseline: baselineMetric,
                    rowResults: rowResultsWin,
                    statsEngine: "frequentist",
                    pValueCorrection: "benjamini-hochberg",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Frequentist, Relative, Not Enough Data</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsNotEnough,
                    baseline: baselineMetric,
                    rowResults: rowResultsNotEnough,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsNotEnough,
                    baseline: baselineMetric,
                    rowResults: rowResultsBaselineZero,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Frequentist, Relative, Suspicious Change</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsWin,
                    baseline: baselineMetric,
                    rowResults: rowResultsSuspicious,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Frequentist, Absolute, Insignificant</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="absolute"
                  data={makeData({
                    metric: metricWithDenominator,
                    stats: { ...statsWin, expected: 0.02, denominator: 2000 },
                    baseline: { ...baselineMetric, denominator: 2000 },
                    rowResults: rowResultsInsig,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Frequentist, Scaled Impact</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="scaled"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsWin,
                    baseline: baselineMetric,
                    rowResults: rowResultsWin,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Bayesian, Relative, CUPED + Prior (lift warning)</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsWin,
                    baseline: baselineMetric,
                    rowResults: rowResultsWin,
                    statsEngine: "bayesian",
                    metricSnapshotSettings: {
                      metric: "m_bin",
                      properPrior: true,
                      properPriorMean: 0,
                      properPriorStdDev: 0.1,
                      regressionAdjustmentEnabled: true,
                      regressionAdjustmentReason: "enabled",
                      regressionAdjustmentAvailable: true,
                      regressionAdjustmentDays: 14,
                    },
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Guardrail Metric with Warning</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsLose,
                    baseline: baselineMetric,
                    rowResults: {
                      ...rowResultsLose,
                      guardrailWarning: "Upward trend in bounce rate",
                    },
                    statsEngine: "frequentist",
                    isGuardrail: true,
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Inverse Metric (losing)</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricInverse,
                    stats: statsLose,
                    baseline: baselineMetric,
                    rowResults: rowResultsLose,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Quantile Metrics</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: factQuantileUnit,
                    stats: {
                      ...statsWin,
                      stats: { users: 1000, count: 800, stddev: 1, mean: 1 },
                    },
                    baseline: {
                      ...baselineMetric,
                      stats: { users: 1000, count: 750, stddev: 1, mean: 1 },
                    },
                    rowResults: rowResultsWin,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: factQuantileEvent,
                    stats: {
                      ...statsWin,
                      stats: { users: 1000, count: 2200, stddev: 1, mean: 1 },
                    },
                    baseline: {
                      ...baselineMetric,
                      stats: { users: 1000, count: 2000, stddev: 1, mean: 1 },
                    },
                    rowResults: rowResultsWin,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>Ratio (Fact) and Bandit (shows adjusted label)</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  isBandit
                  data={makeData({
                    metric: factRatioMetric,
                    stats: { ...statsWin, denominator: 5000 },
                    baseline: { ...baselineMetric, denominator: 4800 },
                    rowResults: rowResultsWin,
                    statsEngine: "frequentist",
                  })}
                />
              </Frame>
            </Flex>
          </div>

          <div>
            <b>With Dimension</b>
            <Flex gap="3" mt="2">
              <Frame py="2" px="2">
                <AnalysisResultPopover
                  differenceType="relative"
                  data={makeData({
                    metric: metricBinomial,
                    stats: statsWin,
                    baseline: baselineMetric,
                    rowResults: rowResultsWin,
                    statsEngine: "frequentist",
                    dimensionName: "Country",
                    dimensionValue: "United States",
                  })}
                />
              </Frame>
            </Flex>
          </div>
        </Flex>
      </div>
    </div>
  );
}
DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;

function TabContentExample({ number }: { number: number }) {
  useEffect(
    () => console.log(`Tab number ${number} content mounted`),
    [number],
  );

  return <>Tab number {number} content</>;
}
