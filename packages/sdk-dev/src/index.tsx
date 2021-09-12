import type { GrowthBook } from "@growthbook/growthbook-react";
import { GrowthBookContext } from "@growthbook/growthbook-react";
import * as React from "react";
import * as ReactDOM from "react-dom";
import VariationSwitcher, { VariationData } from "./VariationSwitcher";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
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

export const GrowthBookAutoLoad = () => {
  const [growthbook, setGrowthbook] = React.useState<GrowthBook>();

  // Poll for global window._growthbook to exist
  React.useEffect(() => {
    let cancel = false;
    let timer: number;
    const cb = () => {
      if (cancel) return;
      if (window._growthbook) {
        setGrowthbook(window._growthbook);
      } else {
        timer = window.setTimeout(cb, 200);
      }
    };
    cb();

    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, []);

  if (!growthbook) return null;
  return <GrowthBookDev growthbook={growthbook} />;
};

export const GrowthBookDev = ({ growthbook }: { growthbook?: GrowthBook }) => {
  const ctx = React.useContext(GrowthBookContext);

  const instance = growthbook || ctx?.growthbook;

  const [variations, setVariations] = React.useState<VariationData>();

  // Subscribe to experiment changes
  React.useEffect(() => {
    if (!instance) return;
    const cb = instance.subscribe(() => {
      window.requestAnimationFrame(() => {
        setVariations(() => getVariations(instance));
      });
    });
    setVariations(() => getVariations(instance));
    return cb;
  }, [instance]);

  if (!instance || !variations) return null;

  return (
    <VariationSwitcher
      forceVariation={(key, variation) => {
        if (!instance?.forceVariation) return;
        instance.forceVariation(key, variation);
      }}
      variations={variations}
    />
  );
};

export function autoload() {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }

  ReactDOM.render(
    <React.StrictMode>
      <GrowthBookAutoLoad />
    </React.StrictMode>,
    root
  );
}
