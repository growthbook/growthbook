import { APP_ORIGIN } from "back-end/src/util/secrets";

export const getExperimentUrl = (experimentId: string): string =>
  `${APP_ORIGIN}/experiment/${encodeURIComponent(experimentId)}`;
