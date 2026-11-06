export function getConfidenceLevelHighlight(percent: number | undefined): {
  highlightColor: string;
  warningMsg: string;
} {
  const highlightColor =
    typeof percent !== "undefined"
      ? percent < 70
        ? "#c73333"
        : percent < 80
          ? "#e27202"
          : percent < 90
            ? "#B39F01"
            : percent >= 100
              ? "#c73333"
              : ""
      : "";

  const warningMsg =
    typeof percent !== "undefined"
      ? percent < 70
        ? "Must be at least 70%"
        : percent === 70
          ? "This is as low as it goes"
          : percent < 75
            ? "Confidence thresholds this low are not recommended"
            : percent < 80
              ? "Confidence thresholds this low are not recommended"
              : percent < 90
                ? "Use caution with values below 90%"
                : percent >= 99
                  ? "Confidence levels 99% and higher can take lots of data to achieve"
                  : percent >= 100
                    ? "Confidence levels 100% and higher are not possible"
                    : ""
      : "";

  return { highlightColor, warningMsg };
}

// Tints a field the color of its warning.
export function warningHighlight(color: string) {
  return {
    borderColor: color,
    backgroundColor: color ? color + "15" : "",
  };
}
