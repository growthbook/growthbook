import { Link, useLocation } from "react-router-dom";
import { formatPrice } from "../data/products";

type SuccessState = {
  revenue?: number;
  checkoutFlow?: string;
};

export function SuccessPage() {
  const location = useLocation();
  const state = (location.state ?? {}) as SuccessState;

  return (
    <div className="success">
      <h1>Order confirmed</h1>
      <p className="muted">
        Mock checkout complete
        {typeof state.revenue === "number"
          ? ` · ${formatPrice(state.revenue)}`
          : ""}
        {state.checkoutFlow ? ` · flow “${state.checkoutFlow}”` : ""}.
      </p>
      <p className="muted">
        Check the dogfood panel for a <strong>Purchased</strong> event — useful
        as an experiment conversion metric.
      </p>
      <p>
        <Link to="/" className="btn">
          Back to shop
        </Link>
      </p>
    </div>
  );
}
