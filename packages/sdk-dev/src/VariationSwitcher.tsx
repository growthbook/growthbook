import * as React from "react";
// import { useBrowserStorage } from "./useBrowserStorage";
import { useCookie } from "./useCookie";
import style from "./style.css";

// const storageKey = "gbdev_";
// const storageTypeSession = "sessionStorage";
// const storageTypeLocal = "localStorage";

export type VariationData = Map<
  string,
  {
    assigned: number;
    // eslint-disable-next-line
    possible: any[];
  }
>;

export default function VariationSwitcher({
  forceVariation,
  variations,
}: {
  forceVariation: (key: string, variation: number) => void;
  variations: VariationData;
}): null | React.ReactElement {
  // const [open, setOpen] = useBrowserStorage<boolean>(
  //   storageTypeSession,
  //   storageKey + "open",
  //   false
  // );

  const [open, setOpen] = useCookie<boolean>("open", 10, false);

  if (!variations.size) {
    return null;
  }

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
                      onClick={() => forceVariation(key, i)}
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
