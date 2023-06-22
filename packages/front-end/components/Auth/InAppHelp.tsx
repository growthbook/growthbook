import { useFeature } from "@growthbook/growthbook-react";
import { useEffect, useState } from "react";
import { BsArrowRight, BsQuestionLg, BsXLg } from "react-icons/bs";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { GBPremiumBadge } from "../Icons";
import UpgradeModal from "../Settings/UpgradeModal";

export default function InAppHelp() {
  const config = useFeature("papercups-config").value;
  const [showFreeHelpModal, setShowFreeHelpModal] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const { accountPlan } = useUser();
  const { name, email, userId } = useUser();
  useEffect(() => {
    if (accountPlan == ("oss" || "starter") || !isCloud() || !config) return;
    if (window["Papercups"]) return;
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
  }, [config]);

  if (accountPlan === "oss" || accountPlan === "starter") {
    return (
      <>
        {upgradeModal && (
          <UpgradeModal
            close={() => setUpgradeModal(false)}
            reason="To get access to live chat support,"
            source="in-app-help"
          />
        )}

        {showFreeHelpModal && (
          <div
            className="bg-white shadow border rounded"
            style={{
              position: "fixed",
              right: "50px",
              bottom: "80px",
              maxWidth: "300px",
              zIndex: 99999,
            }}
          >
            <div className="bg-purple rounded-top p-4">
              <h2 className="text-white m-0">Welcome to GrowthBook</h2>
              <p className="text-white m-0">How can we help?</p>
            </div>
            <div>
              <div className="bg-light border rounded p-3 m-3 shadow">
                <p className="mb-2">
                  <strong>Have a question?</strong>
                </p>
                <a
                  href="https://slack.growthbook.io/?ref=app-top-nav"
                  target="blank"
                >
                  <button className="btn btn-outline-primary font-weight-normal my-2">
                    Ask The Community <BsArrowRight />
                  </button>
                </a>
                <a href="https://docs.growthbook.io/" target="blank">
                  <button className="btn btn-outline-primary font-weight-normal my-2">
                    View The Docs <BsArrowRight />
                  </button>
                </a>
              </div>
            </div>
            <div>
              <div className="bg-light border rounded p-3 m-3 shadow">
                <p className="mb-2">
                  <strong>Upgrade your account for live chat support.</strong>
                </p>
                <button
                  className="btn btn-premium font-weight-normal my-2"
                  onClick={() => setUpgradeModal(true)}
                >
                  {accountPlan === "oss" ? (
                    <>
                      Try Enterprise <GBPremiumBadge />
                    </>
                  ) : (
                    <>
                      Try Pro <GBPremiumBadge />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        <button
          className="btn btn-primary d-flex align-items-center justify-content-center"
          onClick={() => {
            console.log("showFreeHelpModal", showFreeHelpModal);
            setShowFreeHelpModal(!showFreeHelpModal);
          }}
          style={{
            position: "fixed",
            right: "20px",
            bottom: "20px",
            zIndex: 99999,
            height: "50px",
            width: "50px",
            borderRadius: "50%",
            fontSize: "20px",
          }}
        >
          {showFreeHelpModal ? <BsXLg /> : <BsQuestionLg />}
        </button>
      </>
    );
  }

  return null;
}
