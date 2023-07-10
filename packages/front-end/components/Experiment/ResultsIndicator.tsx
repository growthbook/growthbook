import { FC } from "react";

type Results = "won" | "lost" | "dnf" | "inconclusive";

const getColorClass = (results: Results) => {
  switch (results) {
    case "won":
      return "badge-success";
    case "lost":
      return "badge-danger";
    case "dnf":
      return "badge-warning";
    case "inconclusive":
      return "badge-secondary";
  }
};

const displayName = {
  won: "won",
  lost: "lost",
  dnf: "did not finish",
  inconclusive: "inconclusive",
};

const ResultsIndicator: FC<{
  results: Results;
  newUi?: boolean;
}> = ({ results, newUi }) => {
  const color = getColorClass(results);
  const className = newUi
    ? `results-indicator ${color} px-3 font-weight-bold text-uppercase`
    : `badge badge-pill ${color} mr-2`;
  const style = newUi ? { fontSize: "85%" } : {};

  return (
    <div className={className} style={style}>
      {displayName[results]}
    </div>
  );
};

export default ResultsIndicator;
