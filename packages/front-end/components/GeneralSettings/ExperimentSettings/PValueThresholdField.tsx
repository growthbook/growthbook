export function getPValueThresholdHighlight(
  pValueThreshold: number | undefined,
): {
  highlightColor: string;
  warningMsg: string;
} {
  const highlightColor =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold > 0.3
        ? "#c73333"
        : pValueThreshold > 0.2
          ? "#e27202"
          : pValueThreshold > 0.1
            ? "#B39F01"
            : pValueThreshold <= 0.01
              ? "#c73333"
              : ""
      : "";

  const warningMsg =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold <= 0
        ? "Threshold values of 0 and lower are not possible"
        : pValueThreshold === 0.5
          ? "This is as high as it goes"
          : pValueThreshold > 0.25
            ? "P-value thresholds this high are not recommended"
            : pValueThreshold > 0.2
              ? "P-value thresholds this high are not recommended"
              : pValueThreshold > 0.1
                ? "Use caution with values above 0.1"
                : pValueThreshold <= 0.01
                  ? "Threshold values of 0.01 and lower can take lots of data to achieve"
                  : ""
      : "";

  return { highlightColor, warningMsg };
}
