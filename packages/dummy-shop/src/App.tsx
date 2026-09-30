import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { GrowthBookProvider } from "@growthbook/growthbook-react";
import { Layout } from "./components/Layout";
import { CartProvider } from "./lib/cart";
import { growthbook } from "./lib/growthbook";
import { CartPage } from "./pages/CartPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { HomePage } from "./pages/HomePage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { SuccessPage } from "./pages/SuccessPage";

export function App() {
  useEffect(() => {
    const onNav = () => {
      void growthbook.setURL(window.location.href);
      growthbook.setAttributes({
        ...growthbook.getAttributes(),
        url: window.location.pathname,
      });
    };
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  return (
    <GrowthBookProvider growthbook={growthbook}>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="product/:id" element={<ProductDetailPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="success" element={<SuccessPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </GrowthBookProvider>
  );
}
