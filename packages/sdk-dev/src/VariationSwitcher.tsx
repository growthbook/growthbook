import * as React from "react";
import { useLocalStorage, useLocalStorageWithTTL } from "./useBrowserStorage";
import style from "./style.css";
import { useEffect } from "react";

const storageKey_variationSwitcher = "gbdev_variationSwitcher_";
const storageKey_forcedVariation = "gbdev_forcedVariations";
const defaultTTL = 60 * 60 * 24; // 1 day

export type VariationData = Map<
  string,
  {
    assigned: number;
    // eslint-disable-next-line
    possible: any[];
  }
>;

export type ForcedVariations = { [key: string]: number };

export default function VariationSwitcher({
  forceVariation,
  variations,
}: {
  forceVariation: (key: string, variation: number) => void;
  variations: VariationData;
}): null | React.ReactElement {
  const [open, setOpen] = useLocalStorage<boolean>(
    storageKey_variationSwitcher + "open",
    false
  );

  // todo?? make this per variation key, so that each can have their own ttl?
  const [
    forcedVariations,
    setForcedVariations,
  ] = useLocalStorageWithTTL<ForcedVariations>(
    storageKey_forcedVariation,
    {},
    defaultTTL
  );

  const clickVariation = (key: string, assigned: number) => {
    setForcedVariations({ ...forcedVariations, [key]: assigned });
    forceVariation(key, assigned);
  };

  if (!variations.size) {
    return null;
  }

  useEffect(() => {
    for (const key in forcedVariations) {
      const val = forcedVariations[key];
      if (variations instanceof Map && variations.has(key)) {
        const variation = variations.get(key);
        if (
          variation &&
          "possible" in variation &&
          val >= 0 &&
          val < variation.possible.length
        ) {
          forceVariation(key, val);
        }
      }
    }
  }, []);

  return (
    <div className={`growthbook_dev ${open ? "open" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <h3>GrowthBook Dev</h3>
      <button className="toggle" onClick={() => setOpen(!open)}>
        {open ? "-" : "+"}
      </button>
      <div className="explist">
        {Array.from(variations).map(([key, { assigned, possible }]) => {
          return (
            <div className="exp" key={key}>
              <h5>{key}</h5>
              <table>
                <tbody>
                  {possible.map((value, i) => (
                    <tr
                      key={i}
                      className={assigned === i ? "current" : ""}
                      onClick={() => clickVariation(key, i)}
                    >
                      <th>{i}</th>
                      <td>{JSON.stringify(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
