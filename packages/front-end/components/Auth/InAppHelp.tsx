import { useFeature } from "@growthbook/growthbook-react";
import { useEffect, useState } from "react";
import { BsQuestionLg, BsXLg } from "react-icons/bs";
import { FaArrowRight } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { GBPremiumBadge } from "../Icons";
import UpgradeModal from "../Settings/UpgradeModal";

export default function InAppHelp() {
  const config = useFeature("papercups-config").value;
  const [showFreeHelpWidget, setShowFreeHelpWidget] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const { name, email, userId, hasCommercialFeature } = useUser();
  const showUpgradeModal =
    config && !hasCommercialFeature("livechat") && isCloud();

  useEffect(() => {
    if (window["Papercups"] || !config) return;

    if (hasCommercialFeature("livechat") && isCloud()) {
      window["Papercups"] = {
        config: {
          ...config,
          customer: {
            name,
            email,
            external_id: userId,
          },
        },
      };
      const s = document.createElement("script");
      s.async = true;
      s.src = config.baseUrl + "/widget.js";
      document.head.appendChild(s);
    }
  }, [config]);

  // If the Papercup key exists on the window, we're showing the Papercups widget, so don't show the freeHelpModal
  if (window["Papercups"]) return null;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason="To get access to live chat support,"
          source="in-app-help"
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
                  Start Free Trial <GBPremiumBadge />
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
