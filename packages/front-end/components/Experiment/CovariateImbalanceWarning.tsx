import { FC } from "react";
import Callout from "@/ui/Callout";

const CovariateImbalanceWarning: FC = () => {
  return (
    <Callout status="warning" contentsAs="div">
      <strong>
        Statistically significant differences were detected in pre-exposure
        metrics, biasing results. Check your experiment configuration.
      </strong>
    </Callout>
  );
};

export default CovariateImbalanceWarning;
