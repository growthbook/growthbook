import { useFeature } from "@growthbook/growthbook-react";
import { useEffect, useState } from "react";
import { BsQuestionLg, BsXLg } from "react-icons/bs";
import { FaArrowRight } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { GBPremiumBadge } from "@/components/Icons";
import UpgradeModal from "@/components/Settings/UpgradeModal";

export default function InAppHelp() {
  const config = useFeature("pylon-config").value;
  const [showFreeHelpWidget, setShowFreeHelpWidget] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const {
    name,
    email,
    pylonHmacHash,
    hasCommercialFeature,
    commercialFeatures,
  } = useUser();
  const showUpgradeModal = !hasCommercialFeature("livechat") && isCloud();

  useEffect(() => {
    if (window["pylon"] || !config) return;

    if (hasCommercialFeature("livechat") && isCloud()) {
      const scriptElement = document.createElement("script");
      scriptElement.innerHTML = config.script_content;

      document.body.appendChild(scriptElement);
      window["pylon"] = {
        chat_settings: {
          app_id: config.app_id,
          email_hash: pylonHmacHash,
          email,
          name,
        },
      };
    }
  }, [config, commercialFeatures]);

  // If the Pylon key exists on the window, we're showing the Pylon widget, so don't show the freeHelpModal
  if (window["pylon"]) return null;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="in-app-help"
          commercialFeature="livechat"
        />
      )}

      {showFreeHelpWidget && (
        <div
          className="bg-light shadow border rounded position-fixed"
          style={{
            right: "50px",
            bottom: "80px",
            maxWidth: "310px",
            zIndex: 10,
          }}
        >
          <div className="bg-purple rounded-top p-3 pb-4 d-flex align-items-center">
            <img
              alt="GrowthBook"
              src="/logo/growth-book-logomark-white.svg"
              className="mb-1 pr-1"
              style={{ height: 30 }}
            />
            <h2 className="text-white m-0">How can we help?</h2>
          </div>
          <div
            style={{
              position: "relative",
              top: "-30px",
              marginBottom: "-30px",
            }}
          >
            <div className="bg-white border rounded p-3 m-3 shadow">
              <p className="mb-2">
                <strong>Have a question?</strong>
              </p>
              <a
                href="https://slack.growthbook.io/?ref=app-top-nav"
                target="blank"
                className="btn btn-primary font-weight-normal my-2 w-100"
              >
                Join The Slack Community <FaArrowRight className="ml-2" />
              </a>
              <a
                href="https://docs.growthbook.io/"
                target="blank"
                className="btn btn-outline-primary font-weight-normal my-2 w-100"
              >
                View Docs <FaArrowRight className="ml-2" />
              </a>
            </div>
            {showUpgradeModal && (
              <div className="bg-white border rounded p-3 m-3 shadow">
                <p className="mb-2">
                  <strong>
                    Upgrade your account to unlock live chat support and access
                    to premium features.
                  </strong>
                </p>
                <button
                  className="btn btn-premium font-weight-normal my-2 w-100"
                  onClick={() => setUpgradeModal(true)}
                >
                  Upgrade Now <GBPremiumBadge />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <button
        className="btn btn-primary d-flex align-items-center justify-content-center position-fixed rounded-circle"
        onClick={() => {
          setShowFreeHelpWidget(!showFreeHelpWidget);
        }}
        style={{
          right: "20px",
          bottom: "20px",
          zIndex: 10,
          height: "50px",
          width: "50px",
          fontSize: "30px",
        }}
      >
        {showFreeHelpWidget ? <BsXLg /> : <BsQuestionLg />}
      </button>
    </>
  );
}
