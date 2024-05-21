import { PiCheckCircle, PiX } from "react-icons/pi";
import { useRouter } from "next/router";
import Link from "next/link";
import { routes, useGetStarted } from "@/services/GetStartedProvider";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import styles from "./TopNav.module.scss";

const GuidedGetStartedBar = () => {
  const { refreshOrganization } = useUser();
  const { currentStep, source, clearStep, stepKey } = useGetStarted();
  const { apiCall } = useAuth();
  const router = useRouter();

  if (!currentStep) {
    return null;
  }

  return (
    <div
      className={`navbar ${styles.guidedstepbar} pl-4`}
      style={{
        background: "#7B45EA",
        color: "#FFFFFF",
        height: "50px",
        position: "sticky",
      }}
    >
      <span>
        <strong>Current Task:</strong> {currentStep}
      </span>

      <div>
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
                item: { step: stepKey, isCompleted: true },
                type: source,
              }),
            });
            clearStep();
            refreshOrganization();
            router.push(routes[source]);
          }}
        >
          <PiCheckCircle />{" "}
          <span className="align-middle">Mark as Complete</span>
        </Button>
        <Link href={routes[source]} onClick={() => clearStep()}>
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
