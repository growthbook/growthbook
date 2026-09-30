import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { formatPrice } from "../data/products";
import { EVENT_NAMES, track } from "../lib/analytics";
import { useCart } from "../lib/cart";
import { CHECKOUT_DEFAULT, FLAGS } from "../lib/flags";

export function CheckoutPage() {
  const { linesWithProducts, subtotal, itemCount, clear } = useCart();
  const navigate = useNavigate();
  const checkoutFlow = String(
    useFeatureValue(FLAGS.checkoutFlow, CHECKOUT_DEFAULT),
  );
  const isExpress = checkoutFlow === "express";
  const [email, setEmail] = useState("alli@example.com");
  const [name, setName] = useState("Alli");
  const [address, setAddress] = useState("100 Demo St");

  useEffect(() => {
    if (itemCount === 0) return;
    track(EVENT_NAMES.startedCheckout, {
      itemCount,
      subtotal,
      checkoutFlow,
    });
  }, [itemCount, subtotal, checkoutFlow]);

  if (linesWithProducts.length === 0) {
    return (
      <div className="empty">
        <p>Nothing to check out.</p>
        <Link to="/">Back to shop</Link>
      </div>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    track(EVENT_NAMES.purchased, {
      itemCount,
      revenue: subtotal,
      checkoutFlow,
      email,
    });
    clear();
    navigate("/success", {
      state: { revenue: subtotal, checkoutFlow },
    });
  };

  const summary = (
    <div className="panel">
      <h2>Order summary</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {linesWithProducts.map(({ product, quantity, productId }) => (
          <li
            key={productId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "0.35rem 0",
            }}
          >
            <span>
              {product.name} × {quantity}
            </span>
            <span>{formatPrice(product.price * quantity)}</span>
          </li>
        ))}
      </ul>
      <p className="price">Total: {formatPrice(subtotal)}</p>
    </div>
  );

  const form = (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{isExpress ? "Express checkout" : "Shipping details"}</h2>
      {isExpress ? (
        <p className="express-note">
          You are in the <strong>express</strong> checkout variant — fewer
          fields, one-click feel (still fake payment).
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {!isExpress ? (
        <>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="address">Address</label>
            <input
              id="address"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </>
      ) : null}
      <button type="submit" className="btn">
        {isExpress ? "Pay now (mock)" : "Place order (mock)"}
      </button>
    </form>
  );

  return (
    <div>
      <Link to="/cart" className="back-link">
        ← Cart
      </Link>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Checkout</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Flow variant: <code>{checkoutFlow}</code>
      </p>
      <div className={`checkout-layout ${isExpress ? "express" : "classic"}`}>
        {isExpress ? (
          <>
            {summary}
            {form}
          </>
        ) : (
          <>
            {form}
            {summary}
          </>
        )}
      </div>
    </div>
  );
}
