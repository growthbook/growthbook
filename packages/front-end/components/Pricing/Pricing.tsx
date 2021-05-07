import { FC, useState, useEffect, useContext } from "react";
import LoadingOverlay from "../LoadingOverlay";
import { useAuth } from "../../services/auth";
import PricingSlider from "./PricingSlider";
import { UserContext } from "../ProtectedPage";
import LayoutLite from "../Layout/LayoutLite";

const Pricing: FC = () => {
  const [qty, setQty] = useState("100");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>(null);
  const { apiCall, orgId } = useAuth();
  const { update } = useContext(UserContext);

  // Populate starting qty from querystring
  useEffect(() => {
    const match = window.location.search.match(/[?&]qty=([0-9]+)/);
    if (match && match[1]) {
      setQty(match[1]);
    }
  }, []);

  return (
    <>
      <LayoutLite />
      <div className="container text-center pt-5">
        {loading && <LoadingOverlay />}
        <div className="row justify-content-center">
          <div className="col">
            <h1 className="my-5">Start Your 14-Day Free Trial</h1>
            <div className="container pricing-page">
              <div className="row">
                <div className="col">
                  <PricingSlider
                    qty={qty}
                    setQty={setQty}
                    error={error}
                    showRegistrationForm={!orgId}
                    name={name}
                    setName={setName}
                    onSubmit={async () => {
                      const qtyNumber = parseInt(qty);
                      if (qtyNumber < 10 || qtyNumber > 500) {
                        setError(
                          "Must select between 10,000 and 500,000 MTUs."
                        );
                        return;
                      }

                      setLoading(true);
                      try {
                        await apiCall<{ id: string }>("/subscription/start", {
                          method: "POST",
                          body: JSON.stringify({
                            qty: qtyNumber,
                            name,
                          }),
                        });
                        // Refresh user/organization info after subscription is created
                        await update();
                      } catch (e) {
                        setError(e.message);
                        setLoading(false);
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Pricing;
