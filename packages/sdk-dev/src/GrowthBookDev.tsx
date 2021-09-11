import type { GrowthBook } from "@growthbook/js";
import * as React from "react";
import * as ReactDOM from "react-dom";
import VariationSwitcher, { VariationData } from "./VariationSwitcher";

declare global {
  interface Window {
    growthbookDev?: {
      init: (gb: GrowthBook) => void;
    };
  }
}

const ROOT_ID = "growthbook_dev";

function getVariations(growthbook: GrowthBook) {
  const assigned = growthbook.getAllResults();
  const newValue: VariationData = new Map();
  assigned.forEach(({ experiment, result }) => {
    newValue.set(experiment.key, {
      assigned: result.variationId,
      possible: [...experiment.variations],
    });
  });
  return newValue;
}

export const GrowthBookDev = () => {
  const [variations, setVariations] = React.useState<VariationData>();
  const [growthbook, setGrowthbook] = React.useState<GrowthBook>();

  // Get reference to GrowthBook instance
  React.useEffect(() => {
    // Add growthbookDev init object to window
    window.growthbookDev = {
      init: (gb) => {
        setGrowthbook(gb);
      },
    };
    document.body.dispatchEvent(new Event("GROWTHBOOK_DEV_LOADED"));

    return () => {
      delete window.growthbookDev;
    };
  }, []);

  // Subscribe to experiment changes
  React.useEffect(() => {
    if (!growthbook) return;
    const cb = growthbook.subscribe(() => {
      window.requestAnimationFrame(() => {
        setVariations(() => getVariations(growthbook));
      });
    });
    setVariations(() => getVariations(growthbook));
    return cb;
  }, [growthbook]);

  if (!growthbook || !variations) return null;

  return (
    <VariationSwitcher
      forceVariation={(key, variation) => {
        if (!growthbook?.forceVariation) return;
        growthbook.forceVariation(key, variation);
      }}
      variations={variations}
    />
  );
};

export function init() {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }

  ReactDOM.render(
    <React.StrictMode>
      <GrowthBookDev />
    </React.StrictMode>,
    root
  );
}
