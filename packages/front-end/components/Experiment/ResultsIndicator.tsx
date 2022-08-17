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
}> = ({ results }) => {
  const color = getColorClass(results);

  return (
    <div className={`badge badge-pill ${color} mr-2`}>
      {displayName[results]}
    </div>
  );
};

export default ResultsIndicator;
