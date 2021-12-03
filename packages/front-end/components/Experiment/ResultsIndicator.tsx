import { FC } from "react";

type Results = "won" | "lost" | "dnf" | "inconclusive";

const getColorClass = (results: Results) => {
  switch (results) {
    case "won":
      return "btn btn-sm btn-outline-success";
    case "lost":
      return "btn btn-sm btn-outline-danger";
    case "dnf":
      return "btn btn-sm btn-outline-warning";
    case "inconclusive":
      return "btn btn-sm btn-outline-secondary";
  }
};

const displayName = {
  won: "won",
  lost: "lost",
  dnf: "DNF",
  inconclusive: "inconclusive",
};

const ResultsIndicator: FC<{
  results: Results;
}> = ({ results }) => {
  const color = getColorClass(results);

  return (
    <div className={`d-inline-block align-middle ${color} py-1 px-3 mr-2`}>
      {displayName[results]}
    </div>
  );
};

export default ResultsIndicator;
