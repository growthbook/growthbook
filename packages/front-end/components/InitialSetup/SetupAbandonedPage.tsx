import Link from "next/link";
import { FC } from "react";
import { Grid } from "@radix-ui/themes";
import {
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
} from "@/components/GetStarted/FeaturedCards";

interface SetupAbandonedPageProps {
  exitHref: string;
}

const SetupAbandonedPage: FC<SetupAbandonedPageProps> = ({
  exitHref,
}): React.ReactElement => {
  return (
    <div
      className="container pagecontents"
      style={{ maxWidth: "885px", height: "100%" }}
    >
      <h1 className="my-4">Explore Growthbook</h1>
      <div className="d-flex align-items-center mt-5 mb-2">
        <h3>Where do you want to go next?</h3>
      </div>

      <Grid columns={{ initial: "1fr", xs: "1fr 1fr" }} gap="3" mb="3">
        <FeatureFlagFeatureCard title="Explore Feature Flags" />
        <ExperimentFeatureCard title="Explore Experiments" />
      </Grid>

      <Link className="float-right mt-auto" href={exitHref}>
        <button className="btn btn-primary">Exit Setup</button>
      </Link>
    </div>
  );
};

export default SetupAbandonedPage;
