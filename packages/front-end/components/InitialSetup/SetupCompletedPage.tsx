import Link from "next/link";
import { useEffect } from "react";
import { Grid } from "@radix-ui/themes";
import { useCelebration } from "@/hooks/useCelebration";
import {
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
} from "@/components/GetStarted/FeaturedCards";

const SetupCompletedPage = (): React.ReactElement => {
  const startCelebration = useCelebration();

  useEffect(() => {
    startCelebration();
  });

  return (
    <div
      className="container pagecontents"
      style={{ maxWidth: "885px", height: "100%" }}
    >
      <h1 className="my-4">Setup Complete!</h1>
      <div className="d-flex align-items-center mt-5 mb-2">
        <h3>What do you want to do next?</h3>
      </div>

      <Grid columns={{ initial: "1fr", xs: "1fr 1fr" }} gap="3" mb="3">
        <FeatureFlagFeatureCard />
        <ExperimentFeatureCard />
      </Grid>

      <Link className="float-right mt-auto" href={"/getstarted"}>
        <button className="btn btn-primary">Exit Setup</button>
      </Link>
    </div>
  );
};

export default SetupCompletedPage;
