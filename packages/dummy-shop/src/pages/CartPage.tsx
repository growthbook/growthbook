import { useEffect } from "react";
import { Link } from "react-router-dom";
import { formatPrice } from "../data/products";
import { EVENT_NAMES, track } from "../lib/analytics";
import { useCart } from "../lib/cart";

export function CartPage() {
  const { linesWithProducts, subtotal, setQuantity, removeItem, itemCount } =
    useCart();

  useEffect(() => {
    track(EVENT_NAMES.viewedCart, {
      itemCount,
      subtotal,
    });
  }, [itemCount, subtotal]);

  if (linesWithProducts.length === 0) {
    return (
      <div className="empty">
        <h1>Your cart is empty</h1>
        <p className="muted">Browse the shop and add something you like.</p>
        <p>
          <Link to="/" className="btn">
            Continue shopping
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Cart</h1>
      <table className="cart-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {linesWithProducts.map(({ product, quantity, productId }) => (
            <tr key={productId}>
              <td>
                <Link to={`/product/${productId}`}>{product.name}</Link>
              </td>
              <td>
                <input
                  className="qty-input"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(productId, Number(e.target.value) || 0)
                  }
                />
              </td>
              <td>{formatPrice(product.price * quantity)}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => removeItem(productId)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="price" style={{ marginTop: "1rem" }}>
        Subtotal: {formatPrice(subtotal)}
      </p>
      <div className="detail-actions">
        <Link to="/checkout" className="btn">
          Checkout
        </Link>
        <Link to="/" className="btn btn-secondary">
          Keep shopping
        </Link>
      </div>
    </div>
  );
}
