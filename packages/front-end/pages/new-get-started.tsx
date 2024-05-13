import clsx from "clsx";
import { useState } from "react";
import ReactPlayer from "react-player";
import { FiArrowRight } from "react-icons/fi";
import { BsFlag } from "react-icons/bs";
import Link from "next/link";
import styles from "@/components/GuidedGetStarted/GuidedGetStarted.module.scss";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBExperiment } from "@/components/Icons";

const NewGetStartedPage = (): React.ReactElement => {
  const [showVideo, setShowVideo] = useState(false);
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();

  return (
    <div className="container pagecontents py-5">
      <h1 className="mb-3">Get Started</h1>
      <div className="d-flex">
        <div className="row justify-content-center mb-1">
          <div>
            <h2>Create Feature Flags from Scratch</h2>
            <p>Explore a guided setup & sample feature flag</p>
          </div>
          <div>
            <h2>Run an Experiment</h2>
            <p>Explore a guided setup & sample results</p>
          </div>
        </div>
        <div className="row justify-content-center mb-1">
          <div>
            <h2>Migrate Feature Flags</h2>
          </div>
          <div>
            <h2>Analyze Imported Experiments</h2>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-muted">PRODUCT OVERVIEW</h3>
      </div>
    </div>
  );
};

export default NewGetStartedPage;
