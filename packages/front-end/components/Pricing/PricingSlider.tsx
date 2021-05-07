import Slider from "react-rangeslider";
import { FC } from "react";

const PricingSlider: FC<{
  qty: string;
  setQty: (qty: string) => void;
  onSubmit: () => Promise<void>;
  showRegistrationForm: boolean;
  name: string;
  setName: (name: string) => void;
  error?: string;
}> = ({
  qty,
  setQty,
  onSubmit,
  error,
  name,
  setName,
  showRegistrationForm,
}) => {
  const minTraffic = 10;
  const maxTraffic = 500;
  const steps = 10;
  const pricePerVisitor = 5;

  const qtyInt = parseInt(qty);

  let contactUs = false;
  const totalPrice = qtyInt * pricePerVisitor - minTraffic * pricePerVisitor;

  let totalPriceDisplay = (
    <div className="totalprice">
      <span className="dollarsign">$</span>
      <span className="costnumber">{totalPrice}</span>
      <span className="permonth"> / month</span>
    </div>
  );
  let displayTrafficNumber = qty + "k";
  if (qtyInt >= maxTraffic) {
    displayTrafficNumber = maxTraffic + "k+";
    totalPriceDisplay = (
      <div className="totalprice singleline">
        <p className="trial">Custom Quote</p>
      </div>
    );
    contactUs = true;
  }

  return (
    <form
      className="pricing-slider row justify-content-center"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="pricingbox col-md-10 col-sm-12 col-lg-7 text-center">
        {showRegistrationForm && (
          <div className="mb-3">
            <input
              type="text"
              required
              minLength={3}
              className="form-control"
              style={{ fontSize: "1.4em" }}
              placeholder="Company Name"
              autoFocus={true}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <hr />
          </div>
        )}

        <h3 className="boxtitle">
          I get <strong>{displayTrafficNumber}</strong> unique visitors per
          month
        </h3>
        <div className="sliderwrap">
          <Slider
            min={minTraffic}
            max={maxTraffic}
            step={steps}
            value={qtyInt}
            className={"simple"}
            tooltip={false}
            orientation={"horizontal"}
            onChange={setQty}
          />
        </div>
        <div className="row justify-content-around align-items-center below-slider">
          <div className="col-md">{totalPriceDisplay}</div>
          <div className="col-md">
            {contactUs ? (
              <a
                className="btn btn-primary btn-lg  btn-block"
                href="https://www.growthbook.io/contact"
              >
                Contact Us
              </a>
            ) : (
              <button
                className="btn btn-primary btn-lg btn-block"
                type="submit"
              >
                {totalPrice > 0 ? "Start Trial" : "Join Free"}
              </button>
            )}
          </div>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    </form>
  );
};

export default PricingSlider;
