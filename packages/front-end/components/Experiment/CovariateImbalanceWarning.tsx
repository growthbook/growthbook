import { FC } from "react";
import Callout from "@/ui/Callout";

const CovariateImbalanceWarning: FC = () => {
  return (
    <Callout status="warning" contentsAs="div">
      <strong>
        Statistically significant differences were detected in pre-experiment
        metrics.
      </strong>
    </Callout>
  );
};

export default CovariateImbalanceWarning;
