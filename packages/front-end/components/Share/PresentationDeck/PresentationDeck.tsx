"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { FaExpand, FaCompress } from "react-icons/fa";
import { runCelebration, type CelebrationType } from "@/hooks/useCelebration";
import { PresentationStepProvider } from "./PresentationStepContext";

/** Presentation celebration selection */
export type PresentationCelebrationType =
  | "none"
  | "confetti"
  | "emoji"
  | "stars"
  | "random"
  | "cash";

const RANDOM_CELEBRATION_TYPES: CelebrationType[] = [
  "confetti",
  "emoji",
  "stars",
  "colors",
  "cash",
];

function runPresentationCelebration(
  celebration: PresentationCelebrationType,
  /** When provided (e.g. in preview), effect is confined to this canvas */
  canvas?: HTMLCanvasElement | null,
): void {
  if (celebration === "none") return;
  let type: CelebrationType;
  if (celebration === "random") {
    type =
      RANDOM_CELEBRATION_TYPES[
        Math.floor(Math.random() * RANDOM_CELEBRATION_TYPES.length)
      ];
  } else {
    type = celebration;
  }
  runCelebration(type, canvas);
}

export interface PresentationSlideConfig {
  content: ReactNode;
  steps: number;
  /** Step index at which to trigger celebration (e.g. 1 = when winner is revealed). Only fires when user advances to this step. */
  triggerCelebrationOnStep?: number;
}

export type PresentationTransition = "none" | "fade" | "slide";

export interface PresentationTheme {
  colors: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  fontSizes?: {
    header?: string;
    text?: string;
    h1?: string;
    h2?: string;
  };
  fonts?: {
    header?: string;
    text?: string;
  };
}

export interface PresentationDeckProps {
  slides: PresentationSlideConfig[];
  theme: PresentationTheme;
  transition?: PresentationTransition;
  celebration?: PresentationCelebrationType;
  /** Called when slide index changes (e.g. for URL sync) */
  onSlideChange?: (slideIndex: number) => void;
  /** Initial slide index (e.g. from URL) */
  initialSlideIndex?: number;
  preview?: boolean;
  className?: string;
}

export function PresentationDeck({
  slides,
  theme,
  transition = "fade",
  celebration = "none",
  onSlideChange,
  initialSlideIndex = 0,
  preview = false,
  className = "",
}: PresentationDeckProps): React.ReactElement {
  const [slideIndex, setSlideIndex] = useState(() =>
    Math.min(Math.max(0, initialSlideIndex), Math.max(0, slides.length - 1)),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<
    "next" | "prev"
  >("next");
  const containerRef = useRef<HTMLDivElement>(null);
  const celebrationCanvasRef = useRef<HTMLCanvasElement>(null);

  const currentSlideConfig = slides[slideIndex];
  const totalStepsInSlide = currentSlideConfig?.steps ?? 0;

  const totalSlides = slides.reduce((acc, s) => acc + 1 + (s.steps ?? 0), 0);
  const previousPositions = slides
    .slice(0, slideIndex)
    .reduce((acc, s) => acc + 1 + (s.steps ?? 0), 0);
  const currentPosition = previousPositions + stepIndex;

  // Size the celebration canvas to the container when in preview (so confetti is confined)
  useEffect(() => {
    if (!preview || !containerRef.current || !celebrationCanvasRef.current)
      return;
    const container = containerRef.current;
    const canvas = celebrationCanvasRef.current;
    const sizeCanvas = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    sizeCanvas();
    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(container);
    return () => ro.disconnect();
  }, [preview]);

  const goNext = useCallback(() => {
    if (stepIndex < totalStepsInSlide) {
      const nextStep = stepIndex + 1;
      const config = slides[slideIndex];
      const shouldCelebrate =
        celebration !== "none" && config?.triggerCelebrationOnStep === nextStep;
      setStepIndex(nextStep);
      if (shouldCelebrate) {
        const canvas = preview ? celebrationCanvasRef.current : undefined;
        setTimeout(() => runPresentationCelebration(celebration, canvas), 1000);
      }
      return;
    }
    if (slideIndex < slides.length - 1) {
      setTransitionDirection("next");
      setSlideIndex((i) => i + 1);
      setStepIndex(0);
      onSlideChange?.(slideIndex + 1);
    }
  }, [
    stepIndex,
    totalStepsInSlide,
    slideIndex,
    slides,
    celebration,
    preview,
    onSlideChange,
  ]);

  const goPrev = useCallback(() => {
    if (stepIndex > 0) {
      setStepIndex((s) => s - 1);
      return;
    }
    if (slideIndex > 0) {
      setTransitionDirection("prev");
      setSlideIndex((i) => i - 1);
      const prevSteps = slides[slideIndex - 1]?.steps ?? 0;
      setStepIndex(prevSteps);
      onSlideChange?.(slideIndex - 1);
    }
  }, [stepIndex, slideIndex, slides, onSlideChange]);

  const enterFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.requestFullscreen) {
      el.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Keyboard navigation
  const goNextRef = useRef(goNext);
  const goPrevRef = useRef(goPrev);
  const onSlideChangeRef = useRef(onSlideChange);
  const exitFullscreenRef = useRef(exitFullscreen);
  const slidesRef = useRef(slides);

  useEffect(() => {
    // keep refs up to date without forcing re-subscribe of the keydown listener
    goNextRef.current = goNext;
    goPrevRef.current = goPrev;
    onSlideChangeRef.current = onSlideChange;
    exitFullscreenRef.current = exitFullscreen;
    slidesRef.current = slides;
  }, [goNext, goPrev, onSlideChange, exitFullscreen, slides]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInput) return;

      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goNextRef.current();
      } else if (
        e.key === "ArrowLeft" ||
        e.key === "PageUp" ||
        e.key === "Backspace"
      ) {
        e.preventDefault();
        goPrevRef.current();
      } else if (e.key === "Home") {
        e.preventDefault();
        setSlideIndex(0);
        setStepIndex(0);
        onSlideChangeRef.current?.(0);
      } else if (e.key === "End") {
        e.preventDefault();
        const s = slidesRef.current;
        setSlideIndex(s.length - 1);
        setStepIndex(s[s.length - 1]?.steps ?? 0);
        onSlideChangeRef.current?.(s.length - 1);
      } else if (e.key === "Escape" && isFullscreen) {
        exitFullscreenRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    if (x > width * 0.7) goNext();
    else if (x < width * 0.3) goPrev();
  };

  const themeStyle: React.CSSProperties = {
    backgroundColor: theme.colors.tertiary,
    color: theme.colors.primary,
    fontFamily: theme.fonts?.text || theme.fonts?.header || "inherit",
    height: "100%",
    width: "100%",
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  const themeStylePreview: React.CSSProperties = {
    ...themeStyle,
    width: "200%",
    height: "200%",
  };

  const transitionClass =
    transition === "slide"
      ? transitionDirection === "next"
        ? "presentation-transition-slide-next"
        : "presentation-transition-slide-prev"
      : transition === "fade"
        ? "presentation-transition-fade"
        : "";

  if (slides.length === 0) {
    return (
      <div
        ref={containerRef}
        className={`presentation-deck ${className}`}
        style={themeStyle}
      >
        <div style={{ padding: "2rem", textAlign: "center" }}>No slides</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`presentation-deck ${preview ? "presentation-deck-preview" : ""} ${className}`}
      style={preview ? themeStylePreview : themeStyle}
      onClick={handleContainerClick}
    >
      {preview && (
        <canvas
          ref={celebrationCanvasRef}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "200%",
            height: "200%",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
      <PresentationStepProvider
        value={{ stepIndex, totalSteps: totalStepsInSlide }}
      >
        <div
          className={`presentation-slide-container ${transitionClass}`}
          style={{
            position: "relative",
            zIndex: 2,
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            key={slideIndex}
            className="presentation-slide-content"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "2rem",
              overflow: "auto",
            }}
          >
            {currentSlideConfig.content}
          </div>
        </div>
      </PresentationStepProvider>

      {/* Footer: fullscreen + progress + slide dots */}
      <div
        className="presentation-deck-footer"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          color: theme.colors.primary,
          backgroundColor: "rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {!preview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                isFullscreen ? exitFullscreen() : enterFullscreen();
              }}
              className="btn btn-link p-1"
              style={{
                color: theme.colors.primary,
                fontSize: "1.25rem",
              }}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <FaCompress /> : <FaExpand />}
            </button>
          )}
        </div>
        <div
          className="presentation-progress"
          style={{
            flex: 1,
            maxWidth: "200px",
            height: "6px",
            backgroundColor: "rgba(255,255,255,0.3)",
            borderRadius: 3,
            margin: "0 1rem",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${
                slides.length > 0
                  ? (currentPosition / (totalSlides - 1)) * 100
                  : 0
              }%`,
              height: "100%",
              backgroundColor: theme.colors.primary,
              transition: "width 0.2s ease",
            }}
          />
        </div>
        <div
          className="presentation-slide-dots"
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSlideIndex(i);
                setStepIndex(0);
                onSlideChange?.(i);
              }}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                width: slideIndex === i ? 20 : 10,
                height: 10,
                borderRadius: 5,
                border: "none",
                padding: 0,
                backgroundColor:
                  slideIndex === i
                    ? theme.colors.primary
                    : "rgba(255,255,255,0.5)",
                cursor: "pointer",
                transition: "width 0.15s ease, background-color 0.15s ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
