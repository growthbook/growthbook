import { Link } from "react-router-dom";
import { formatPrice, type Product } from "../data/products";
import { FreeShippingBadge } from "./FreeShippingBadge";

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link to={`/product/${product.id}`} className="product-card">
      <div
        className="product-swatch"
        style={{ ["--hue" as string]: product.imageHue }}
      >
        <FreeShippingBadge />
      </div>
      <div className="product-card-body">
        <h2>{product.name}</h2>
        <div className="meta">{product.category}</div>
        <div className="price">{formatPrice(product.price)}</div>
      </div>
    </Link>
  );
}
