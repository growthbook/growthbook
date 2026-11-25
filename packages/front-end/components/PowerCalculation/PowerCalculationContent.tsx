import Link from "next/link";
import { useMemo, useState, useCallback } from "react";
import clsx from "clsx";
import {
  PowerCalculationParams,
  PowerCalculationResults,
  PowerCalculationSuccessResults,
} from "shared/power";
import { Box } from "@radix-ui/themes";
import { LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import {
  Tooltip as VisxTooltip,
  useTooltip,
  defaultStyles,
} from "@visx/tooltip";
import { ParentSize } from "@visx/responsive";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { ensureAndReturn } from "@/types/utils";
import { GBHeadingArrowLeft } from "@/components/Icons";
import Frame from "@/ui/Frame";
import PowerCalculationStatsEngineSettingsModal, {
  alphaToChanceToWin,
  StatsEngineSettingsWithAlpha,
} from "./PowerCalculationStatsEngineSettingsModal";

const engineType = {
  frequentist: msg`Frequentist`,
  bayesian: msg`Bayesian`,
} as const;

const percentFormatter = (
  v: number,
  { digits }: { digits: number } = { digits: 0 },
) =>
  isNaN(v)
    ? "N/A"
    : new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: digits,
        roundingMode: "floor",
      }).format(v);

const numberFormatter = (() => {
  const formatter = Intl.NumberFormat("en-US");
  return (v: number) => (isNaN(v) ? "N/A" : formatter.format(v));
})();

const MIN_VARIATIONS = 2;
const MAX_VARIATIONS = 12;

const formatWeeks = (
  { weeks, nWeeks }: { weeks?: number; nWeeks: number },
  i18n: I18n,
) => {
  if (weeks) {
    const count = numberFormatter(weeks);
    return weeks > 1 ? i18n._(msg`${count} weeks`) : i18n._(msg`${count} week`);
  }
  const count = numberFormatter(nWeeks);
  return nWeeks > 1
    ? i18n._(msg`more than ${count} weeks`)
    : i18n._(msg`more than ${count} week`);
};

const AnalysisSettings = ({
  params,
  results,
  updateVariations,
  updateStatsEngineSettingsWithAlpha,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationResults;
  updateVariations: (_: number) => void;
  updateStatsEngineSettingsWithAlpha: (_: StatsEngineSettingsWithAlpha) => void;
}) => {
  const { t, i18n } = useLingui();
  const [currentVariations, setCurrentVariations] = useState<
    number | undefined
  >(params.nVariations);

  const [showStatsEngineSettingsModal, setShowStatsEngineSettingsModal] =
    useState(false);

  const isValidCurrentVariations =
    currentVariations &&
    MIN_VARIATIONS <= currentVariations &&
    currentVariations <= MAX_VARIATIONS;

  const alpha = params.alpha;
  const chanceToWin = alphaToChanceToWin(params.alpha);
  const engineSummary =
    params.statsEngineSettings.type === "frequentist"
      ? params.statsEngineSettings.sequentialTesting
        ? t`(Sequential Testing enabled; ${alpha} p-value threshold)`
        : t`(Sequential Testing disabled; ${alpha} p-value threshold)`
      : t`(${chanceToWin}% chance to win threshold)`;
  const errorDescription = results.type === "error" ? results.description : "";

  return (
    <>
      {showStatsEngineSettingsModal && (
        <PowerCalculationStatsEngineSettingsModal
          close={() => setShowStatsEngineSettingsModal(false)}
          params={{
            ...params.statsEngineSettings,
            alpha: params.alpha,
          }}
          onSubmit={(v) => {
            updateStatsEngineSettingsWithAlpha(v);
            setShowStatsEngineSettingsModal(false);
          }}
        />
      )}
      <Frame>
        <div className="row">
          <div className="col-7">
            <h2>
              <Trans>Analysis Settings</Trans>
            </h2>
            <p>
              {i18n._(engineType[params.statsEngineSettings.type])}{" "}
              {engineSummary} ·{" "}
              <Link
                href="#"
                onClick={() => setShowStatsEngineSettingsModal(true)}
              >
                <Trans>Edit</Trans>
              </Link>
            </p>
          </div>
          <div className="vr"></div>
          <div className="col-4 align-self-end">
            <div className="font-weight-bold mb-2">
              <Trans># of Variations</Trans>
            </div>
            <div className="form-group d-flex mb-0 flex-row">
              <input
                type="number"
                className={clsx(
                  "form-control w-50 mr-2",
                  !isValidCurrentVariations && "border border-danger",
                )}
                value={currentVariations}
                min={2}
                max={12}
                onChange={(e) => {
                  const varNum =
                    e.target.value !== "" ? Number(e.target.value) : undefined;
                  setCurrentVariations(varNum);
                  updateVariations(varNum ?? 0);
                }}
              />
            </div>
            <small
              className={clsx(
                "form-text text-muted",
                isValidCurrentVariations && "invisible",
              )}
            >
              <div className="text-danger">
                <Trans>
                  Enter a value between {MIN_VARIATIONS} - {MAX_VARIATIONS}
                </Trans>
              </div>
            </small>
          </div>
        </div>

        {results.type === "error" ? (
          <div className="row p-4">
            <Callout status="error">
              <Trans>Computation failed: {errorDescription}</Trans>
            </Callout>
          </div>
        ) : null}
      </Frame>
    </>
  );
};

const MetricLabel = ({
  name,
  effectSize,
}: {
  name: string;
  effectSize: number;
}) => {
  const effectSizeText = percentFormatter(effectSize, { digits: 4 });
  return (
    <>
      <div className="font-weight-bold">{name}</div>
      <div className="small">
        <Trans>Effect Size {effectSizeText}</Trans>
      </div>
    </>
  );
};

const SampleSizeAndRuntime = ({
  params,
  results,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationSuccessResults;
}) => {
  const { t, i18n } = useLingui();
  const sampleSizeAndRuntime = results.sampleSizeAndRuntime;
  const [selectedRow, setSelectedRow] = useState(
    Object.keys(sampleSizeAndRuntime)[0],
  );

  const selectedTarget = sampleSizeAndRuntime[selectedRow];
  const { name: selectedName, effectSize: selectedEffectSize } = useMemo(() => {
    const newSelectedRow = params.metrics[selectedRow]
      ? selectedRow
      : Object.keys(sampleSizeAndRuntime)[0];
    setSelectedRow(newSelectedRow);
    return ensureAndReturn(params.metrics[newSelectedRow]);
  }, [params.metrics, selectedRow, sampleSizeAndRuntime, setSelectedRow]);

  const selectedEffectSizeText = percentFormatter(selectedEffectSize, {
    digits: 1,
  });
  const selectedWeeksText = formatWeeks(
    { weeks: selectedTarget?.weeks, nWeeks: params.nWeeks },
    i18n,
  );
  const selectedUsersText = selectedTarget
    ? numberFormatter(selectedTarget.users)
    : "";

  return (
    <Frame>
      <div>
        <h2>
          <Trans>Calculated Sample Size & Runtime</Trans>
        </h2>
        <p>
          <Trans>
            Needed sample sizes are based on total number of users across all
            variations.
          </Trans>
        </p>
      </div>

      <div className="row">
        <div className="col-7">
          <table className="table appbox">
            <thead>
              <tr>
                <th>
                  <Trans>Metric</Trans>
                </th>
                <th>
                  <Trans>Effect Size</Trans>
                </th>
                <th>
                  <Trans>Needed Sample</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(sampleSizeAndRuntime).map((id) => {
                const target = sampleSizeAndRuntime[id];

                const { name, type, effectSize } = ensureAndReturn(
                  params.metrics[id],
                );
                const weeksText = formatWeeks(
                  {
                    weeks: target?.weeks,
                    nWeeks: params.nWeeks,
                  },
                  i18n,
                );
                const usersText = target ? numberFormatter(target.users) : "";

                return (
                  <tr
                    key={id}
                    className={clsx(
                      "power-analysis-row",
                      selectedRow === id && "selected",
                    )}
                    onClick={() => setSelectedRow(id)}
                  >
                    <td>
                      <div className="font-weight-bold">{name}</div>
                      <div className="small">
                        {type === "binomial" ? t`Proportion` : t`Mean`}
                      </div>
                    </td>
                    <td>{percentFormatter(effectSize, { digits: 4 })}</td>
                    <td>
                      {target ? t`${weeksText}; ${usersText} users` : weeksText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="col-5">
          <Callout status="info">
            <h4>{selectedName}</h4>
            <p>
              {selectedTarget ? (
                <Trans>
                  Reliably detecting a lift of{" "}
                  <span className="font-weight-bold">
                    {selectedEffectSizeText}
                  </span>{" "}
                  requires running your experiment for{" "}
                  <span className="font-weight-bold">{selectedWeeksText}</span>{" "}
                  (collecting roughly{" "}
                  <span className="font-weight-bold">
                    {selectedUsersText} users
                  </span>
                  )
                </Trans>
              ) : (
                <Trans>
                  Reliably detecting a lift of{" "}
                  <span className="font-weight-bold">
                    {selectedEffectSizeText}
                  </span>{" "}
                  requires running your experiment for{" "}
                  <span className="font-weight-bold">{selectedWeeksText}</span>
                </Trans>
              )}
            </p>
          </Callout>
        </div>
      </div>
    </Frame>
  );
};

const WeeksThreshold = ({
  nWeeks,
  targetPower,
  weekThreshold,
}: {
  nWeeks: number;
  targetPower: number;
  weekThreshold?: number;
}) => {
  const { i18n } = useLingui();
  const targetPowerText = percentFormatter(targetPower);
  const weeksText = formatWeeks({ weeks: weekThreshold, nWeeks }, i18n);
  return weekThreshold ? (
    <p>
      <Trans>
        To achieve {targetPowerText} power for all metrics, we advocate running
        your experiment for{" "}
        <span className="font-weight-bold">at least {weeksText}</span>.
      </Trans>
    </p>
  ) : (
    <p>
      <Trans>
        The experiment needs to run for{" "}
        <span className="font-weight-bold">{weeksText}</span> to achieve{" "}
        {targetPowerText} power for all metrics.
      </Trans>
    </p>
  );
};

const MinimumDetectableEffect = ({
  results,
  params,
}: {
  results: PowerCalculationSuccessResults;
  params: PowerCalculationParams;
}) => {
  const { t } = useLingui();
  return (
    <Frame>
      <div className="w-100">
        <h2>
          <Trans>Minimum Detectable Effect Over Time</Trans>
        </h2>
      </div>
      <WeeksThreshold
        nWeeks={params.nWeeks}
        weekThreshold={results.weekThreshold}
        targetPower={params.targetPower}
      />

      <table className="table appbox">
        <thead>
          <tr>
            <th>
              <Trans>Metric</Trans>
            </th>
            {results.weeks.map(({ users }, idx) => (
              <th
                key={idx}
                className={clsx(
                  results.weekThreshold === idx + 1 &&
                    "power-analysis-cell-threshold power-analysis-overall-header-threshold",
                )}
              >
                {(() => {
                  const week = idx + 1;
                  const usersText = numberFormatter(users);
                  const content = (
                    <>
                      <div className="font-weight-bold">
                        <Trans>Week {week}</Trans>
                      </div>
                      <span className="small">
                        <Trans>{usersText} Users</Trans>
                      </span>
                    </>
                  );

                  if (results.weekThreshold === idx + 1)
                    return (
                      <Tooltip
                        popperClassName="text-top"
                        body={t`Week ${week} is the first week when all your metrics meet their expected effect size.`}
                        tipPosition="top"
                      >
                        {content}
                      </Tooltip>
                    );

                  return content;
                })()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(results.weeks[0]?.metrics).map((id, pos) => (
            <tr key={id}>
              <td>
                <MetricLabel {...ensureAndReturn(params.metrics[id])} />
              </td>
              {results.weeks.map(({ metrics }, idx) => (
                <td
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold",
                    results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-cell-threshold",
                    Object.keys(results.weeks[0]?.metrics).length == pos + 1 &&
                      results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-bottom-threshold",
                  )}
                >
                  {(() => {
                    const content = percentFormatter(
                      ensureAndReturn(metrics[id]).effectSize,
                      {
                        digits: 1,
                      },
                    );

                    if (ensureAndReturn(metrics[id]).isThreshold) {
                      const { effectSize, name } = ensureAndReturn(
                        params.metrics[id],
                      );
                      const week = idx + 1;
                      const effectSizeText = percentFormatter(effectSize, {
                        digits: 1,
                      });
                      return (
                        <Tooltip
                          popperClassName="text-top"
                          body={t`Week ${week} is the first week where the minimum detectable effect over time dropped below your target effect size of ${effectSizeText} for ${name}.`}
                          tipPosition="top"
                        >
                          {content}
                        </Tooltip>
                      );
                    }

                    return content;
                  })()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Box className="appbox p-3">
        <PowerLineGraph
          weeks={results.weeks}
          metrics={params.metrics}
          target={params.metrics[Object.keys(params.metrics)[0]].effectSize}
          targetLabel={t`Target Effect Size`}
          dataType="effectSize"
        />
      </Box>
    </Frame>
  );
};

const PowerOverTime = ({
  params,
  results,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationSuccessResults;
}) => {
  const { t } = useLingui();
  return (
    <Frame>
      <div className="w-100">
        <h2>
          <Trans>Power Over Time</Trans>
        </h2>
      </div>
      <WeeksThreshold
        nWeeks={params.nWeeks}
        weekThreshold={results.weekThreshold}
        targetPower={params.targetPower}
      />

      <table className="table appbox">
        <thead>
          <tr>
            <th>
              <Trans>Metric</Trans>
            </th>
            {results.weeks.map(({ users }, idx) => (
              <th
                key={idx}
                className={clsx(
                  results.weekThreshold === idx + 1 &&
                    "power-analysis-cell-threshold power-analysis-overall-header-threshold",
                )}
              >
                {(() => {
                  const week = idx + 1;
                  const usersText = numberFormatter(users);
                  const content = (
                    <>
                      <div className="font-weight-bold">
                        <Trans>Week {week}</Trans>
                      </div>
                      <span className="small">
                        <Trans>{usersText} Users</Trans>
                      </span>
                    </>
                  );

                  if (results.weekThreshold === idx + 1)
                    return (
                      <Tooltip
                        popperClassName="text-top"
                        body={t`Week ${week} is the first week when all your metrics meet their expected effect size.`}
                        tipPosition="top"
                      >
                        {content}
                      </Tooltip>
                    );

                  return content;
                })()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(results.weeks[0]?.metrics).map((id, pos) => (
            <tr key={id}>
              <td>
                <MetricLabel {...ensureAndReturn(params.metrics[id])} />
              </td>
              {results.weeks.map(({ metrics }, idx) => (
                <td
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold",
                    results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-cell-threshold",
                    Object.keys(results.weeks[0]?.metrics).length == pos + 1 &&
                      results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-bottom-threshold",
                  )}
                >
                  {(() => {
                    const content = percentFormatter(
                      ensureAndReturn(metrics[id]).power,
                    );

                    if (ensureAndReturn(metrics[id]).isThreshold) {
                      const { targetPower } = params;
                      const { effectSize, name } = ensureAndReturn(
                        params.metrics[id],
                      );
                      const week = idx + 1;
                      const targetPowerText = percentFormatter(targetPower);
                      const effectSizeText = percentFormatter(effectSize, {
                        digits: 1,
                      });
                      return (
                        <Tooltip
                          popperClassName="text-top"
                          body={t`Week ${week} is the first week with at least ${targetPowerText} power to detect an effect size of ${effectSizeText} for ${name}.`}
                          tipPosition="top"
                        >
                          {content}
                        </Tooltip>
                      );
                    }

                    return content;
                  })()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Box className="appbox p-3">
        <PowerLineGraph
          weeks={results.weeks}
          metrics={params.metrics}
          target={params.targetPower}
          targetLabel={t`Target Power`}
          dataType="power"
        />
      </Box>
    </Frame>
  );
};

export default function PowerCalculationContent({
  results,
  params,
  updateVariations,
  updateStatsEngineSettingsWithAlpha,
  edit,
  newCalculation,
}: {
  results: PowerCalculationResults;
  params: PowerCalculationParams;
  updateVariations: (_: number) => void;
  updateStatsEngineSettingsWithAlpha: (_: StatsEngineSettingsWithAlpha) => void;
  edit: () => void;
  newCalculation: () => void;
}) {
  return (
    <div>
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-space-between align-items-center">
            <h1>
              <Trans>Power Calculator</Trans>
            </h1>
          </div>
        </div>
      </div>
      <div className="row mb-4">
        <div className="col">
          <Trans>
            Select key metrics and hypothesized effect size to determine ideal
            experiment duration.
          </Trans>
        </div>
        <div className="col-auto pr-0">
          <Button variant={"outline"} onClick={edit}>
            <Trans>Edit</Trans>
          </Button>
        </div>
        <div className="col-auto">
          <Button
            onClick={() => newCalculation()}
            icon={<GBHeadingArrowLeft />}
            ml={"1"}
          >
            <Trans>New Calculation</Trans>
          </Button>
        </div>
      </div>
      <AnalysisSettings
        params={params}
        results={results}
        updateVariations={updateVariations}
        updateStatsEngineSettingsWithAlpha={updateStatsEngineSettingsWithAlpha}
      />
      {results.type !== "error" ? (
        <>
          <SampleSizeAndRuntime params={params} results={results} />
          <PowerOverTime params={params} results={results} />
          <MinimumDetectableEffect params={params} results={results} />
        </>
      ) : null}
    </div>
  );
}
const PowerLineGraph = ({
  weeks,
  metrics,
  target,
  targetLabel,
  dataType,
}: {
  weeks: PowerCalculationSuccessResults["weeks"];
  metrics: PowerCalculationParams["metrics"];
  target: number;
  targetLabel: string;
  dataType: "power" | "effectSize";
}) => (
  <Box className="position-relative">
    <ParentSize>
      {({ width }) => (
        <ResponsivePowerLineGraph
          width={width}
          height={300}
          weeks={weeks}
          metrics={metrics}
          target={target}
          targetLabel={targetLabel}
          dataType={dataType}
        />
      )}
    </ParentSize>
  </Box>
);

const ResponsivePowerLineGraph = ({
  width,
  height,
  weeks,
  metrics,
  target,
  targetLabel,
  dataType,
}: {
  width: number;
  height: number;
  weeks: PowerCalculationSuccessResults["weeks"];
  metrics: PowerCalculationParams["metrics"];
  target: number;
  targetLabel: string;
  dataType: "power" | "effectSize";
}) => {
  const { t } = useLingui();
  const margin = { top: 20, right: 160, bottom: 40, left: 60 };
  const legendWidth = 140;
  const legendItemHeight = 20;
  const maxLegendTextWidth = 80;

  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  const metricIds = Object.keys(weeks[0]?.metrics ?? {});
  const data = metricIds.map((id) => ({
    id,
    name: metrics[id].name,
    values: weeks.map((week, idx) => ({
      week: idx + 1,
      value:
        dataType === "power"
          ? week.metrics[id].power * 100
          : week.metrics[id].effectSize * 100,
    })),
  }));

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, weeks.length],
        range: [0, xMax],
      }),
    [xMax, weeks],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [
          0,
          Math.max(
            target * 100,
            Math.max(
              ...weeks.flatMap((week) =>
                Object.values(week.metrics).map((m) =>
                  dataType === "power" ? m.power * 100 : m.effectSize * 100,
                ),
              ),
            ),
          ),
        ],
        range: [yMax, 0],
        nice: true,
      }),
    [yMax, weeks, target, dataType],
  );

  const numYTicks = 5;
  const colors = useMemo(
    () => [
      "var(--blue-9)",
      "var(--jade-9)",
      "var(--orange-9)",
      "var(--plum-9)",
      "var(--red-9)",
      "var(--yellow-9)",
      "var(--cyan-9)",
      "var(--amber-9)",
    ],
    [],
  );

  const {
    showTooltip,
    hideTooltip,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<{
    week: number;
    values: { name: string; value: number; color: string }[];
  }>();

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const point = localPoint(event.currentTarget, event);
      if (!point) return;

      const x = point.x - margin.left;
      const weekX = Math.round(xScale.invert(x));
      if (weekX < 1 || weekX > weeks.length) return;

      const tooltipValues = data.map((metric, i) => ({
        name: metric.name,
        value: metric.values[weekX - 1].value,
        color: colors[i % colors.length],
      }));

      showTooltip({
        tooltipData: {
          week: weekX,
          values: tooltipValues,
        },
        tooltipLeft: point.x,
        tooltipTop: point.y,
      });
    },
    [margin.left, xScale, data, showTooltip, colors, weeks.length],
  );
  const tooltipWeek = tooltipData?.week;

  return (
    <>
      <svg
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={hideTooltip}
      >
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={xMax}
            strokeDasharray="2,2"
            stroke="var(--slate-6)"
            strokeOpacity={0.3}
            numTicks={numYTicks}
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(target * 100)}
            y2={yScale(target * 100)}
            stroke="var(--slate-11)"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          <AxisBottom
            top={yMax}
            scale={xScale}
            tickFormat={(week) => `${week}`}
            label={t`Week`}
            labelProps={{
              fill: "var(--slate-12)",
              fontSize: 12,
              textAnchor: "middle",
            }}
            tickLabelProps={() => ({
              fill: "var(--slate-11)",
              fontSize: 11,
              textAnchor: "middle",
              dy: "0.25em",
            })}
            stroke="var(--slate-11)"
            tickStroke="var(--slate-11)"
          />
          <AxisLeft
            scale={yScale}
            numTicks={numYTicks}
            tickFormat={(value) => `${value}%`}
            label={
              dataType === "power" ? t`Power` : t`Minimum Detectable Effect`
            }
            labelProps={{
              fill: "var(--slate-12)",
              fontSize: 12,
              textAnchor: "middle",
            }}
            tickLabelProps={() => ({
              fill: "var(--slate-11)",
              fontSize: 11,
              textAnchor: "end",
              dx: "-0.25em",
              dy: "0.25em",
            })}
            stroke="var(--slate-11)"
            tickStroke="var(--slate-11)"
          />
          {data.map((metric, i) => (
            <LinePath
              key={metric.id}
              data={metric.values}
              x={(d) => xScale(d.week) ?? 0}
              y={(d) => yScale(d.value)}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          ))}

          <rect
            x={xMax + 20}
            y={-2}
            width={legendWidth}
            height={data
              .map(
                (m) =>
                  (Math.max(Math.ceil(m.name.length / 15), 1) + 1) *
                  legendItemHeight,
              )
              .reduce((ps, a) => ps + a, 0)}
            fill="var(--slate-a2)"
            stroke="var(--slate-a6)"
            strokeWidth={1}
            rx={4}
          />

          <g transform={`translate(0, ${legendItemHeight / 2})`}>
            <line
              x1={xMax + 30}
              x2={xMax + 50}
              y1={0}
              y2={0}
              stroke="var(--slate-11)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <text
              x={xMax + 60}
              y={0}
              fill="var(--slate-11)"
              fontSize={11}
              dy=".3em"
            >
              {targetLabel}
            </text>
          </g>

          {data.map((metric, i) => (
            <g
              key={metric.id}
              transform={`translate(0, ${(i + 1) * legendItemHeight + 5})`}
            >
              <line
                x1={xMax + 30}
                x2={xMax + 50}
                y1={legendItemHeight / 3}
                y2={legendItemHeight / 3}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
              />
              <foreignObject
                x={xMax + 60}
                y={0}
                width={maxLegendTextWidth}
                height={
                  Math.max(Math.ceil(metric.name.length / 15), 1) *
                  legendItemHeight
                }
              >
                <div
                  style={{
                    color: colors[i % colors.length],
                    fontSize: "11px",
                    lineHeight: "1.2",
                    wordWrap: "break-word",
                  }}
                >
                  {metric.name}
                </div>
              </foreignObject>
            </g>
          ))}
        </Group>
      </svg>

      {tooltipData && (
        <VisxTooltip
          left={tooltipLeft + 10}
          top={tooltipTop + 10}
          style={{
            ...defaultStyles,
            backgroundColor: "var(--slate-3)",
            border: "1px solid var(--slate-6)",
            color: "var(--slate-12)",
            position: "absolute",
          }}
        >
          <div className="text-sm">
            <strong>
              <Trans>Week {tooltipWeek}</Trans>
            </strong>
            {tooltipData.values.map((v, i) => (
              <div key={i} style={{ color: v.color }}>
                {v.name}: {v.value.toFixed(1)}%
              </div>
            ))}
          </div>
        </VisxTooltip>
      )}
    </>
  );
};
