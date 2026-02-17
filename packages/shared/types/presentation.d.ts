//export type ShareType = "presentation" | "pdf" | "page" | "slack";

export type GraphTypes = "pill" | "violin";

export type PresentationTransition = "none" | "fade" | "slide";
export type PresentationCelebration =
  | "none"
  | "confetti"
  | "emoji"
  | "stars"
  | "random"
  | "cash";

export interface PresentationCustomTheme {
  backgroundColor: string;
  textColor: string;
  headingFont: string;
  bodyFont: string;
}

export interface PresentationOptions {
  showScreenShots: boolean;
  showGraphs: boolean;
  graphType: GraphTypes;
  hideMetric: string[];
  hideRisk: boolean;
  transition?: PresentationTransition;
  celebration?: PresentationCelebration;
}

export interface PresentationSlide {
  id: string;
  type: "experiment";
  options?: PresentationOptions;
}

export interface PresentationInterface {
  id: string;
  userId: string;
  organization: string;
  title?: string;
  description?: string;
  theme?: string;
  /** Optional transition between slides: none, fade, or slide */
  transition?: PresentationTransition;
  /** Optional celebration when showing a winning result: none, confetti, emoji, or stars */
  celebration?: PresentationCelebration;
  customTheme?: PresentationCustomTheme;
  /** Optional logo URL shown on the title slide */
  logoUrl?: string;
  sharable?: boolean;
  voting?: boolean;
  options?: PresentationOptions;
  slides: PresentationSlide[];
  dateCreated: Date;
  dateUpdated: Date;
}

/** Saved presentation theme (reusable colors, fonts, transition, celebration, logo) */
export interface PresentationThemeInterface {
  id: string;
  organization: string;
  userId: string;
  name: string;
  customTheme: PresentationCustomTheme;
  transition?: PresentationTransition;
  celebration?: PresentationCelebration;
  logoUrl?: string;
  dateCreated: Date;
  dateUpdated: Date;
}
