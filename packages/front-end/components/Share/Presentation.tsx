import React, { Fragment, ReactElement, useEffect } from "react";
import { PresentationInterface } from "shared/types/presentation";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import clsx from "clsx";
import { expandMetricGroups } from "shared/experiments";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import Markdown from "@/components/Markdown/Markdown";
import useOrgSettings from "@/hooks/useOrgSettings";
import CompactResults from "@/components/Experiment/CompactResults";
import AuthorizedImage from "@/components/AuthorizedImage";
import { presentationThemes, defaultTheme } from "./ShareModal";
import {
  PresentationDeck,
  Appear,
  type PresentationCelebrationType,
  type PresentationSlideConfig,
  type PresentationTheme,
  type DeckTransition,
} from "./PresentationDeck";

export interface Props {
  presentation?: PresentationInterface;
  theme?: string;
  title?: string;
  desc?: string;
  customTheme?: {
    backgroundColor: string;
    textColor: string;
    headingFont?: string;
    bodyFont?: string;
  };
  experiments: {
    experiment: ExperimentInterfaceStringDates;
    snapshot?: ExperimentSnapshotInterface;
  }[];
  preview?: boolean;
  /** Optional logo URL shown on the title slide */
  logoUrl?: string;
  /** Celebration when winner is revealed (preview/form override) */
  celebration?: string;
  /** Slide transition (preview/form override) */
  transition?: string;
  /** Initial slide index (e.g. from URL ?slide=) */
  initialSlideIndex?: number;
  /** Called when slide changes (e.g. to update URL) */
  onSlideChange?: (slideIndex: number) => void;
}

const Presentation = ({
  presentation,
  experiments,
  theme = defaultTheme,
  title,
  desc,
  customTheme,
  preview = false,
  logoUrl: logoUrlProp,
  celebration: celebrationProp,
  transition: transitionProp,
  initialSlideIndex,
  onSlideChange,
}: Props): ReactElement => {
  const logoUrl = presentation?.logoUrl ?? logoUrlProp;
  const { getExperimentMetricById, metricGroups } = useDefinitions();
  const orgSettings = useOrgSettings();

  const [imageCache] = React.useState<
    Record<string, { url: string; expiresAt: string }>
  >({});

  const [redraw, setRedraw] = React.useState(false);
  useEffect(() => {
    setRedraw(true);
    const interval = window.setInterval(() => {
      setRedraw((r) => !r);
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const em = new Map<
    string,
    {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }
  >();

  experiments.forEach((e) => {
    em.set(e?.experiment?.id ?? "", e);
  });

  const slideConfigs: PresentationSlideConfig[] = [];

  // Title slide
  const themeName = presentation?.theme ?? theme;
  const currentTheme = presentationThemes[themeName];
  const deckTheme: PresentationTheme = {
    colors: {
      primary: currentTheme.colors.primary,
      secondary: currentTheme.colors.secondary,
      tertiary: currentTheme.colors.tertiary,
    },
    fontSizes: currentTheme.fontSizes,
    fonts: "fonts" in currentTheme ? currentTheme.fonts : undefined,
  };

  if (themeName === "custom") {
    if (presentation?.customTheme) {
      deckTheme.colors.tertiary = presentation.customTheme.backgroundColor;
      deckTheme.colors.primary = presentation.customTheme.textColor;
      deckTheme.colors.secondary = presentation.customTheme.textColor;
      deckTheme.fonts = {
        header: presentation.customTheme.headingFont,
        text: presentation.customTheme.bodyFont,
      };
    } else if (customTheme) {
      if (customTheme.backgroundColor)
        deckTheme.colors.tertiary = customTheme.backgroundColor;
      if (customTheme.textColor) {
        deckTheme.colors.primary = customTheme.textColor;
        deckTheme.colors.secondary = customTheme.textColor;
      }
      deckTheme.fonts = {
        header: customTheme.headingFont,
        text: customTheme.bodyFont,
      };
    }
  }

  slideConfigs.push({
    content: (
      <div
        className="d-flex flex-column align-items-center justify-content-center flex-wrap"
        style={{
          height: "100%",
          textAlign: "center",
          fontFamily: deckTheme.fonts?.header || deckTheme.fonts?.text,
        }}
      >
        {logoUrl && (
          <div className="mb-3" style={{ marginBottom: "1.5rem" }}>
            <AuthorizedImage
              src={logoUrl}
              alt="Logo"
              imageCache={imageCache}
              style={{
                maxHeight: 80,
                maxWidth: 200,
                objectFit: "contain",
              }}
            />
          </div>
        )}
        <h1
          className="m-0 pb-0"
          style={{
            fontSize: "3.25rem",
            color: deckTheme.colors.secondary,
            marginBottom: "2rem",
            textAlign: "center",
          }}
        >
          {presentation?.title
            ? presentation.title
            : title
              ? title
              : "A/B Tests Review"}
        </h1>
        {(presentation?.description || desc) && (
          <p
            className="subtitle m-0"
            style={{
              fontSize: "1.125rem",
              color: deckTheme.colors.primary,
              textAlign: "center",
            }}
          >
            {presentation?.description ?? desc}
          </p>
        )}
      </div>
    ),
    steps: 0,
  });

  const expIds =
    presentation?.slides?.map((o) => o.id) ||
    experiments.map((e) => e.experiment.id);

  expIds.forEach((eid) => {
    const e = em.get(eid);
    const variationExtra: JSX.Element[] = [];
    let sideExtra = <></>;
    const variationsPlural =
      (e?.experiment?.variations?.length || 0) !== 1
        ? "variations"
        : "variation";

    e?.experiment?.variations?.forEach((_, i) => {
      variationExtra[i] = <Fragment key={`f-${i}`}></Fragment>;
    });
    let resultsText = "";
    if (
      e?.experiment?.status === "running" ||
      e?.experiment?.status === "draft"
    ) {
      resultsText = "This experiment is still in progress";
    } else {
      if (e?.experiment?.results) {
        const winningVar = e?.experiment?.winner ?? 0;
        if (e.experiment.results === "won") {
          variationExtra[winningVar] = (
            <Appear index={0}>
              <div className="result variation-result result-winner text-center p-2 m-0">
                Winner!
              </div>
            </Appear>
          );
          resultsText =
            (e?.experiment?.variations[winningVar]?.name ?? "") +
            " beat the control and won";
        } else if (e.experiment.results === "lost") {
          resultsText = `The ${variationsPlural} did not improve over the control`;
          if (e.experiment.variations.length === 2) {
            variationExtra[1] = (
              <Appear index={0}>
                <div className="result variation-result result-lost text-center p-2 m-0">
                  Lost!
                </div>
              </Appear>
            );
          } else {
            variationExtra[0] = (
              <Appear index={0}>
                <div className="result variation-result result-winner text-center p-2 m-0">
                  Winner!
                </div>
              </Appear>
            );
          }
        } else if (e.experiment.results === "dnf") {
          sideExtra = (
            <div className="result result-dnf text-center">
              (Did not finish)
            </div>
          );
          resultsText = `The experiment did not finish`;
        } else if (e.experiment.results === "inconclusive") {
          sideExtra = (
            <Appear index={0}>
              <div className="result result-inconclusive text-center m-0 p-3">
                Inconclusive
              </div>
            </Appear>
          );
          resultsText = `The results were inconclusive`;
        }
      }
    }

    const hasRevealStep =
      e?.experiment?.results === "won" ||
      e?.experiment?.results === "lost" ||
      e?.experiment?.results === "inconclusive";

    slideConfigs.push({
      content: (
        <div className="container-fluid">
          <h2
            className="m-0 pb-0 mb-4"
            style={{
              fontSize: "2rem",
              color: deckTheme.colors.secondary,
              marginBottom: "2rem",
              textAlign: "center",
            }}
          >
            {e?.experiment?.name ?? "Experiment"}
          </h2>
          <p
            className="text-center m-0 mb-4 p-2 px-5"
            style={{
              fontSize: "1.1rem",
              lineHeight: "1.4rem",
              color: deckTheme.colors.primary,
            }}
          >
            {e?.experiment?.hypothesis ? (
              <>
                <strong>Hypothesis</strong>: {e.experiment.hypothesis}
              </>
            ) : (
              ""
            )}
            {(() => {
              const goalIds = e?.experiment?.goalMetrics ?? [];
              if (goalIds.length === 0) return null;
              const expandedIds = expandMetricGroups(
                goalIds,
                metricGroups ?? [],
              );
              const names = expandedIds
                .map((id) => getExperimentMetricById(id)?.name)
                .filter((name): name is string => !!name);
              if (names.length === 0) return null;
              return (
                <>
                  <br />
                  <span
                    style={{
                      fontSize: "1.1rem",
                      marginTop: "1rem",
                      lineHeight: "1.4rem",
                      display: "inline-block",
                    }}
                  >
                    Goal metrics:{" "}
                    {names.map((name, i) => (
                      <Fragment key={name + i}>
                        <strong>{name}</strong>
                        {i < names.length - 1 ? ", " : ""}
                      </Fragment>
                    ))}
                  </span>
                </>
              );
            })()}
          </p>

          <div className="row variations justify-content-center">
            {e?.experiment?.variations.map((v: Variation, j: number) => (
              <div
                className={`col m-0 p-0 px-2 col-${
                  12 / (e?.experiment?.variations?.length || 1)
                } presentationcol text-center`}
                key={`v-${j}`}
                style={{
                  fontSize: "1.1rem",
                  color: deckTheme.colors.primary,
                }}
              >
                <h4 style={{ fontSize: "1.125rem" }}>{v.name}</h4>
                {v?.screenshots?.length > 0 && v.screenshots[0]?.path ? (
                  <AuthorizedImage
                    className="expimage border"
                    src={v.screenshots[0].path}
                    alt={v.name}
                    imageCache={imageCache}
                  />
                ) : null}
                {v.description && (
                  <div
                    className="text-center"
                    style={{ fontSize: "0.875rem", opacity: 0.8 }}
                  >
                    {v.description}
                  </div>
                )}
                <div
                  className="presentation-variation-result-slot pt-1"
                  style={{ minHeight: "2.75rem" }}
                >
                  {variationExtra[j]}
                </div>
              </div>
            ))}
          </div>
          {sideExtra}
        </div>
      ),
      steps: hasRevealStep ? 1 : 0,
      triggerCelebrationOnStep:
        e?.experiment?.results === "won" ? 1 : undefined,
    });

    if (e?.snapshot) {
      const experiment = e.experiment;
      const snapshot = e.snapshot;
      const phase = experiment.phases[snapshot.phase];
      const settingsForSnapshotMetrics =
        snapshot?.settings?.metricSettings?.map((m) => ({
          metric: m.id,
          properPrior: m.computedSettings?.properPrior ?? false,
          properPriorMean: m.computedSettings?.properPriorMean ?? 0,
          properPriorStdDev:
            m.computedSettings?.properPriorStdDev ??
            DEFAULT_PROPER_PRIOR_STDDEV,
          regressionAdjustmentReason:
            m.computedSettings?.regressionAdjustmentReason || "",
          regressionAdjustmentDays:
            m.computedSettings?.regressionAdjustmentDays || 0,
          regressionAdjustmentEnabled:
            !!m.computedSettings?.regressionAdjustmentEnabled,
          regressionAdjustmentAvailable:
            !!m.computedSettings?.regressionAdjustmentAvailable,
        })) || [];

      slideConfigs.push({
        content: (
          <>
            <h2
              className="m-0 p-0"
              style={{
                fontSize: "2rem",
                color: deckTheme.colors.secondary,
                marginBottom: "2rem",
                textAlign: "center",
              }}
            >
              Results
            </h2>
            {e.experiment.results && (
              <div
                className={clsx("alert", {
                  "alert-success": e.experiment.results === "won",
                  "alert-danger": e.experiment.results === "lost",
                  "alert-info":
                    !e.experiment.results ||
                    e.experiment.results === "inconclusive",
                  "alert-warning": e.experiment.results === "dnf",
                })}
              >
                <strong>{resultsText}</strong>
                {e.experiment.analysis && (
                  <div className="card text-dark mt-2">
                    <div className="card-body">
                      <Markdown className="card-text">
                        {e.experiment.analysis}
                      </Markdown>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                overflowY: "auto",
                background: "#fff",
                maxHeight: "100%",
                color: "#444",
                fontSize: "95%",
              }}
            >
              <CompactResults
                experimentId={experiment.id}
                variations={experiment.variations.map((v, i) => ({
                  id: v.key || i + "",
                  name: v.name,
                  weight: phase?.variationWeights?.[i] || 0,
                }))}
                multipleExposures={snapshot.multipleExposures || 0}
                results={snapshot?.analyses?.[0]?.results?.[0]}
                reportDate={snapshot.dateCreated}
                startDate={phase?.dateStarted ?? ""}
                endDate={phase?.dateEnded ?? ""}
                isLatestPhase={snapshot.phase === experiment.phases.length - 1}
                phase={snapshot.phase}
                status={experiment.status}
                goalMetrics={experiment.goalMetrics}
                secondaryMetrics={experiment.secondaryMetrics}
                guardrailMetrics={experiment.guardrailMetrics}
                metricOverrides={experiment.metricOverrides ?? []}
                id={experiment.id}
                statsEngine={snapshot?.analyses?.[0]?.settings?.statsEngine}
                pValueCorrection={orgSettings?.pValueCorrection}
                settingsForSnapshotMetrics={settingsForSnapshotMetrics}
                sequentialTestingEnabled={
                  snapshot?.analyses?.[0]?.settings?.sequentialTesting
                }
                differenceType={
                  snapshot?.analyses?.[0]?.settings?.differenceType
                }
                isTabActive={redraw}
                mainTableOnly={true}
                noStickyHeader={true}
                noTooltip={true}
              />
            </div>
          </>
        ),
        steps: 0,
      });
    } else {
      slideConfigs.push({
        content: (
          <>
            <h2
              className="m-0 p-0"
              style={{
                fontSize: "2rem",
                color: deckTheme.colors.secondary,
                marginBottom: "2rem",
                textAlign: "center",
              }}
            >
              Results
            </h2>
            <div className={clsx("alert", "alert-warning", "mt-3")}>
              <strong>No data for this experiment</strong>
              {resultsText && (
                <>
                  . <strong>{resultsText}</strong>
                </>
              )}
            </div>
          </>
        ),
        steps: 0,
      });
    }
  });

  // Thanks slide
  slideConfigs.push({
    content: (
      <div
        className="d-flex flex-column align-items-center justify-content-center flex-wrap"
        style={{
          height: "100%",
          textAlign: "center",
          fontFamily: deckTheme.fonts?.header || deckTheme.fonts?.text,
        }}
      >
        <h1
          style={{
            fontSize: "2.5rem",
            color: deckTheme.colors.secondary,
            marginBottom: "1.25rem",
          }}
        >
          Thanks!
        </h1>
      </div>
    ),
    steps: 0,
  });

  const transition: DeckTransition = (presentation?.transition ??
    transitionProp ??
    "fade") as DeckTransition;
  const celebration: PresentationCelebrationType = (presentation?.celebration ??
    celebrationProp ??
    "none") as PresentationCelebrationType;

  return (
    <div
      className={`presentation ${preview ? "presentation-preview" : ""}`}
      style={
        preview
          ? {
              width: "100%",
              height: "100%",
              maxHeight: "350px",
              minWidth: 0,
              overflow: "hidden",
              position: "relative",
            }
          : { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
      }
    >
      <PresentationDeck
        slides={slideConfigs}
        theme={deckTheme}
        transition={transition}
        celebration={celebration}
        onSlideChange={onSlideChange}
        initialSlideIndex={initialSlideIndex}
        preview={preview}
      />
    </div>
  );
};

export default Presentation;
