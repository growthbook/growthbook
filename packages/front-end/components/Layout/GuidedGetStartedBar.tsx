import { PiCheckCircle, PiX } from "react-icons/pi";
import { useRouter } from "next/router";
import Link from "next/link";
import { useGetStarted } from "@/services/GetStartedProvider";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import styles from "./TopNav.module.scss";
import {
  setPrototypeGuidedBar,
  usePrototypeGuidedBar,
} from "./PrototypeControls";

const manualSteps = ["attributes", "environments"];

const GuidedGetStartedBar = () => {
  const { refreshOrganization } = useUser();
  const { project } = useDefinitions();
  const realStep = useGetStarted();
  const { apiCall } = useAuth();
  const router = useRouter();
  // PROTOTYPE ("Getting-started bar" in the prototype panel; set in
  // review): with no real step, the bar as if the feature flag guide's
  // "Create a Test Feature Flag" had been started (as
  // pages/getstarted/feature-flag-guide.tsx starts it), to review its
  // layout. Its X and Return to Guide turn the setting off.
  const forced = usePrototypeGuidedBar() && !realStep.currentStep;
  const { currentStep, getReturnUrl, clearStep, stepKey } = forced
    ? {
        currentStep: `Create a Test Feature Flag${project && " in this Project"}`,
        getReturnUrl: () => "/getstarted/feature-flag-guide",
        clearStep: () => setPrototypeGuidedBar(false),
        stepKey: "createFeatureFlag",
      }
    : realStep;

  if (!currentStep) {
    return null;
  }

  return (
    <div
      className={`navbar ${styles.guidedstepbar}`}
      style={{
        background: "#7B45EA",
        color: "#FFFFFF",
        height: "50px",
        position: "sticky",
        // The text 32px in, as the page content below it (set in review;
        // was 24px, Bootstrap's pl-4).
        paddingLeft: 32,
      }}
    >
      <span>
        <strong>Current Task:</strong> {currentStep}
      </span>

      <div>
        {manualSteps.includes(stepKey) && (
          <Button
            className="mx-2"
            style={{
              background: "none",
              color: "#EDE9FE",
              border: "1px solid #C4B8F3",
              borderRadius: "4px",
              padding: "0px 10px",
              fontSize: "13px",
              height: "25px",
            }}
            onClick={async () => {
              await apiCall("/organization/get-started-checklist", {
                method: "PUT",
                body: JSON.stringify({
                  checklistItem: stepKey,
                  project,
                }),
              });
              clearStep();
              refreshOrganization();
              router.push(getReturnUrl());
            }}
          >
            <PiCheckCircle />{" "}
            <span className="align-middle">Mark as Complete</span>
          </Button>
        )}
        <Link href={getReturnUrl()} onClick={() => clearStep()}>
          <button
            className="mx-2"
            style={{
              background: "#EDE9FE",
              color: "#5746AF",
              border: "1px solid #C4B8F3",
              borderRadius: "4px",
              padding: "0px 10px",
              fontSize: "13px",
              height: "25px",
            }}
          >
            Return to Guide
          </button>
        </Link>
        <PiX
          className="mx-3"
          style={{
            fill: "#FFFFFF",
            height: "20px",
            width: "20px",
            cursor: "pointer",
          }}
          onClick={() => clearStep()}
        />
      </div>
    </div>
  );
};

export default GuidedGetStartedBar;
