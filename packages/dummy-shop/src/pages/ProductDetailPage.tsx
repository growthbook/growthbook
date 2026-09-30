import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { FreeShippingBadge } from "../components/FreeShippingBadge";
import { formatPrice, getProduct } from "../data/products";
import { EVENT_NAMES, track } from "../lib/analytics";
import { useCart } from "../lib/cart";
import { CTA_DEFAULT, FLAGS } from "../lib/flags";

export function ProductDetailPage() {
  const { id = "" } = useParams();
  const product = getProduct(id);
  const { addItem } = useCart();
  const navigate = useNavigate();
  const ctaCopy = String(useFeatureValue(FLAGS.ctaCopy, CTA_DEFAULT));

  useEffect(() => {
    if (!product) return;
    track(EVENT_NAMES.viewedProduct, {
      productId: product.id,
      name: product.name,
      price: product.price,
    });
  }, [product]);

  if (!product) {
    return (
      <div className="empty">
        <p>Product not found.</p>
        <Link to="/">Back to shop</Link>
      </div>
    );
  }

  const onAdd = () => {
    addItem(product.id, 1);
    track(EVENT_NAMES.addedToCart, {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      ctaCopy,
    });
  };

  return (
    <div>
      <Link to="/" className="back-link">
        ← All products
      </Link>
      <div className="detail">
        <div
          className="detail-swatch"
          style={{ ["--hue" as string]: product.imageHue }}
        >
          <FreeShippingBadge />
        </div>
        <div className="detail-copy">
          <div className="meta">{product.category}</div>
          <h1>{product.name}</h1>
          <p className="price">{formatPrice(product.price)}</p>
          <p className="muted">{product.description}</p>
          <div className="detail-actions">
            <button type="button" className="btn" onClick={onAdd}>
              {ctaCopy}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onAdd();
                navigate("/cart");
              }}
            >
              {ctaCopy} & checkout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
