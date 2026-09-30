import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initGrowthBook } from "./lib/growthbook";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

void initGrowthBook().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
