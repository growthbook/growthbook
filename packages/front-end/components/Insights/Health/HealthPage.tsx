import { ReactNode, useMemo } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import {
  ProjectHealth,
  ScopeHealth,
  calculateProductAnalyticsDateRange,
  combineProjectScores,
  computeHealthByProject,
  computeHealthDetails,
  computeScopeHealth,
  getHealthSettings,
  getNoScoreReason,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { InsightsHealthScoreInterface } from "shared/validators";
import useApi from "@/hooks/useApi";
import { useExperiments } from "@/hooks/useExperiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ExperimentsGetStarted from "@/components/HomePage/ExperimentsGetStarted";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import ShareUrlPopover from "@/ui/ShareUrlPopover";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import { useInsightsUrlState } from "@/components/Insights/useInsightsUrlState";
import useQualityScorer from "./useQualityScorer";
import HealthHeadline, {
  HeadlineLegend,
  ImprovementLinks,
} from "./HealthHeadline";
import HealthByProject, { ProjectHealthRow } from "./HealthByProject";
import {
  CycleTimeCard,
  NeedsAttention,
  QualityDiagnosticsCard,
  RunStabilityCard,
  VelocityCard,
} from "./HealthDetailCards";

const DAY_MS = 24 * 60 * 60 * 1000;
// Select items can't use "" as a value
const ALL_PROJECTS = "__all__";
// Fewer stored weeks than this isn't a trend yet
const MIN_TREND_POINTS = 4;
// The weaker area is called out until it reaches this score
const IMPROVEMENT_THRESHOLD = 90;

function countUnhealthy(health: ScopeHealth): number {
  return (
    health.completed - Math.round((health.healthyRate ?? 1) * health.completed)
  );
}

function biggestGap(health: ScopeHealth): string {
  const noScore = getNoScoreReason(health);
  if (noScore) return noScore;
  if (health.openSrmAlerts) {
    return `${health.openSrmAlerts} SRM alert${health.openSrmAlerts === 1 ? "" : "s"} open`;
  }
  if (
    health.quality !== null &&
    health.quality < (health.healthyRate ?? 1) * 100 &&
    health.topQualityIssue
  ) {
    return `Often missing: ${health.topQualityIssue}`;
  }
  const unhealthy = countUnhealthy(health);
  return unhealthy
    ? `${plural(unhealthy, "experiment")} with health issues`
    : "No major gaps";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function HealthPage() {
  const {
    ready,
    project: urlProject,
    setProject,
    dateRange,
    setDateRange,
  } = useInsightsUrlState();
  const {
    project: globalProject,
    projects,
    getProjectById,
    ready: definitionsReady,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { getQuality, hasFeature } = useQualityScorer();
  const { experiments, loading } = useExperiments("", true);
  const { data: trendData } = useApi<{
    scores: InsightsHealthScoreInterface[];
  }>("/insights/health/scores");

  const project = urlProject ?? globalProject ?? "";
  const window = useMemo(
    () => calculateProductAnalyticsDateRange(dateRange),
    [dateRange],
  );
  const previousWindow = useMemo(
    () =>
      calculateProductAnalyticsDateRange(
        resolveComparisonPreviousTimeFrame(dateRange, {}),
      ),
    [dateRange],
  );
  const periodDays = Math.ceil(
    (window.endDate.getTime() - window.startDate.getTime()) / DAY_MS,
  );
  const previousLabel = `vs prev. ${periodDays}d`;

  const computed = useMemo(() => {
    const healthSettings = getHealthSettings(settings);
    const scoped = project
      ? experiments.filter((e) => e.project === project)
      : experiments;
    const input = { healthSettings, getQuality };
    const empty = computeScopeHealth({ experiments: [], window, ...input });
    const byProject: ProjectHealth[] = project
      ? []
      : computeHealthByProject({ experiments, window, ...input });
    // List every Project, including ones without experiments
    projects.forEach((p) => {
      if (!project && !byProject.some((r) => r.project === p.id)) {
        byProject.push({ project: p.id, health: empty });
      }
    });
    const previousByProject: ProjectHealth[] = project
      ? []
      : computeHealthByProject({
          experiments,
          window: previousWindow,
          ...input,
        });
    const health = computeScopeHealth({
      experiments: scoped,
      window,
      ...input,
    });
    const previous = computeScopeHealth({
      experiments: scoped,
      window: previousWindow,
      ...input,
    });
    return {
      health,
      previous,
      byProject,
      previousByProject,
      score: project ? health.score : combineProjectScores(byProject),
      previousScore: project
        ? previous.score
        : combineProjectScores(previousByProject),
      details: computeHealthDetails({ experiments: scoped, window, ...input }),
    };
  }, [
    experiments,
    projects,
    project,
    window,
    previousWindow,
    settings,
    getQuality,
  ]);

  const trendFor = (id: string): number[] | null => {
    const values = (trendData?.scores ?? [])
      .filter((s) => s.project === id && s.score !== null)
      .sort(
        (a, b) =>
          new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime(),
      )
      .map((s) => s.score ?? 0);
    return values.length >= MIN_TREND_POINTS ? values : null;
  };

  if (!ready || !definitionsReady || loading) return <LoadingSpinner />;

  if (!experiments.some((e) => !e.id.match(/^exp_sample/))) {
    return (
      <div className="container pagecontents getstarted">
        <ExperimentsGetStarted />
      </div>
    );
  }

  const { health, previous, details, score, previousScore } = computed;

  let improvement: ReactNode = null;
  if (score !== null) {
    const healthyScore = (health.healthyRate ?? 1) * 100;
    const qualityWeaker =
      health.quality !== null && health.quality < healthyScore;
    const weakest = qualityWeaker ? (health.quality ?? 100) : healthyScore;
    const unhealthy = countUnhealthy(health);
    const [first, second] = details.qualityIssues;
    const srmAlerts =
      health.openSrmAlerts > 0 &&
      `${plural(health.openSrmAlerts, "running experiment")} ${
        health.openSrmAlerts === 1 ? "has" : "have"
      } an open SRM alert.`;
    const attentionLink = details.attention.length
      ? [{ label: "See what needs attention", href: "#needs-attention" }]
      : [];
    if (weakest < IMPROVEMENT_THRESHOLD) {
      improvement = qualityWeaker ? (
        <>
          <strong>
            Quality: completed experiments average{" "}
            {Math.round(health.quality ?? 0)} / 100.
          </strong>{" "}
          {first &&
            `The most common gap is "${first.label}" (${plural(first.count, "experiment")})${
              second ? `, then "${second.label}"` : ""
            }. `}
          {srmAlerts}
          <ImprovementLinks
            links={[
              {
                label: "Review quality checks",
                href: "/settings/experimentation-health",
              },
              ...attentionLink,
            ]}
          />
        </>
      ) : (
        <>
          <strong>
            Healthy rate: {unhealthy} of {health.completed} completed
            experiments had a health issue.
          </strong>{" "}
          {[
            health.healthErrors.srm && `${health.healthErrors.srm} with SRM`,
            health.healthErrors.multipleExposures &&
              `${health.healthErrors.multipleExposures} with multiple exposures`,
            health.healthErrors.lowPowered &&
              `${health.healthErrors.lowPowered} missed their power target`,
          ]
            .filter(Boolean)
            .join(", ")}
          . {srmAlerts}
          <ImprovementLinks links={attentionLink} />
        </>
      );
    }
  }

  const projectRows: ProjectHealthRow[] = computed.byProject
    .map(({ project: id, health: h }) => ({
      id,
      active: h.started > 0 || h.completed > 0,
      name: id ? (getProjectById(id)?.name ?? id) : "No Project",
      health: h,
      previousScore:
        computed.previousByProject.find((p) => p.project === id)?.health
          .score ?? null,
      trend: trendFor(id),
      biggestGap: biggestGap(h),
    }))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (b.health.score ?? -1) - (a.health.score ?? -1) ||
        b.health.completed - a.health.completed,
    );

  const qualityState =
    health.quality !== null || health.completed === 0
      ? ({ state: "on" } as const)
      : hasFeature
        ? ({
            state: "off",
            action: (
              <Link href="/settings/experimentation-health" size="sm">
                Turn on
              </Link>
            ),
          } as const)
        : ({
            state: "locked",
            action: (
              <PremiumTooltip commercialFeature="experiment-quality-score">
                <Text size="sm" color="text-mid">
                  Enterprise
                </Text>
              </PremiumTooltip>
            ),
          } as const);

  return (
    <Box className="container-fluid pagecontents" py="4">
      <Flex justify="between" align="start" mb="4" gap="4" wrap="wrap">
        <Box>
          <Heading as="h1" size="lg" mb="1">
            Experimentation Health
          </Heading>
          <Text color="text-mid">
            How well the program is running: quality, health and velocity. For
            results, see <Link href="/insights/impact">Impact</Link>.
          </Text>
        </Box>
        <Flex gap="3" align="center">
          <Select
            value={project || ALL_PROJECTS}
            setValue={(v) => setProject(v === ALL_PROJECTS ? "" : v)}
            size="md"
          >
            <SelectItem value={ALL_PROJECTS}>All Projects</SelectItem>
            <SelectSeparator />
            {[...projects]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
          </Select>
          <DateRangeCompareDropdown
            value={{ dateRange, comparison: null }}
            onChange={(next) => setDateRange(next.dateRange)}
          />
          <ShareUrlPopover
            title="Share this view"
            description="Anyone with access to this organization sees the same Project and dates."
            trigger={<Button variant="outline">Share report</Button>}
          />
        </Flex>
      </Flex>

      <HealthHeadline
        health={health}
        score={score}
        previous={previous}
        previousScore={previousScore}
        previousLabel={previousLabel}
        improvement={improvement}
        quality={qualityState}
      />
      <HeadlineLegend />

      {!project && projectRows.length > 0 && (
        <HealthByProject rows={projectRows} onSelectProject={setProject} />
      )}

      <Grid columns={{ initial: "1", md: "2" }} gap="5" mb="5">
        <VelocityCard
          monthlyStarts={details.monthlyStarts}
          startRate={health.startRate}
          started={health.started}
          runningNow={details.runningNow}
          startRateChange={health.startRate - previous.startRate}
        />
        <CycleTimeCard cycle={details.cycle} />
      </Grid>
      <Grid columns={{ initial: "1", md: "2" }} gap="5" mb="5">
        <RunStabilityCard stability={details.stability} />
        <QualityDiagnosticsCard diagnostics={details.diagnostics} />
      </Grid>
      <NeedsAttention items={details.attention} />
    </Box>
  );
}
