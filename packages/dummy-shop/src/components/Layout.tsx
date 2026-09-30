import { Link, Outlet } from "react-router-dom";
import { useCart } from "../lib/cart";
import { DogfoodPanel } from "./DogfoodPanel";

export function Layout() {
  const { itemCount } = useCart();

  return (
    <div className="shell">
      <header className="site-header">
        <Link to="/" className="brand">
          Cedar <span>Market</span>
        </Link>
        <nav className="nav">
          <Link to="/">Shop</Link>
          <Link to="/cart" className="cart-link">
            Cart · {itemCount}
          </Link>
        </nav>
      </header>
      <Outlet />
      <DogfoodPanel />
    </div>
  );
}
