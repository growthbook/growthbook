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
  won: "获胜",
  lost: "失败",
  dnf: "未完成",
  inconclusive: "无结论",
};

const ResultsIndicator: FC<{
  results: Results;
}> = ({ results }) => {
  const color = getColorClass(results);
  const className = `results-indicator ${color} px-3 font-weight-bold text-uppercase`;

  return (
    <div className={className} style={{ fontSize: "85%" }}>
      {displayName[results]}
    </div>
  );
};

export default ResultsIndicator;
