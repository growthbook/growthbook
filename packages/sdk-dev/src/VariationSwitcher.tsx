import * as React from "react";
import { default as COLORS } from "./colors";

const SESSION_STORAGE_OPEN_KEY = "gbdev_open";

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
  const [open, setOpen] = React.useState(false);

  // Restore open state from sessionStorage
  React.useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SESSION_STORAGE_OPEN_KEY)) {
        setOpen(true);
      }
    } catch (e) {
      // Ignore session storage errors
    }
  }, []);

  if (!variations.size) {
    return null;
  }

  return (
    <div className={`growthbook_dev ${open ? "open" : ""}`}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
.growthbook_dev {
  position: fixed;
  bottom: 5px;
  left: 5px;
  width: 250px;
  padding: 5px 15px;
  background: ${COLORS.bg};
  color: ${COLORS.text};
  border-radius: 6px;
  opacity: 0.6;
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  transition: opacity 0.2s, padding 0.2s;
  box-shadow: 0 0 6px 2px ${COLORS.shadow};
  z-index: 999;
}
.growthbook_dev:hover {
  opacity: 1;
}
.growthbook_dev.open {
  opacity: 1;
  padding: 15px;
}
.growthbook_dev .toggle {
  position: absolute;
  color: ${COLORS.text};
  top: -10px;
  right: -10px;
  width: 30px;
  height: 30px; 
  border-radius: 30px;
  background: ${COLORS.bg};
  border: 2px solid ${COLORS.text};
  text-align: center;
  line-height: 20px;
  box-sizing: border-box;
  font-size: 24px;
  box-shadow: 0 0 6px 2px ${COLORS.shadow};
  cursor: pointer;
}
.growthbook_dev .toggle:hover {
  transform: scale(1.1);
}
.growthbook_dev h3 {
  font-size: 1.3em;
}
.growthbook_dev h5 {
  font-size: 1.1em;
}
.growthbook_dev h3, .growthbook_dev h5 {
  padding: 0;
  margin: 0;
}
.growthbook_dev .exp {
  margin: 0;
  overflow-y: hidden;
  max-height: 0;
  transition: max-height 0.2s, margin 0.2s;
}
.growthbook_dev.open .exp {
  max-height: 200px;
  margin: 10px 0;
}
.growthbook_dev .exp:last-child {
  margin-bottom: 0;
}
.growthbook_dev table {
  color: ${COLORS.bg};
  border-collapse: collapse;
  font-size: 0.9em;
  width: 100%;
  margin: 5px 0 10px;
  border-radius: 6px;
}
.growthbook_dev tr {
  cursor: pointer;
  transition: background-color 0.2s;
  background: ${COLORS.text};
}
.growthbook_dev tr:first-child th {
  border-top-left-radius: 6px;
}
.growthbook_dev tr:first-child td:last-child {
  border-top-right-radius: 6px;
}
.growthbook_dev tr:last-child th {
  border-bottom-left-radius: 6px;
}
.growthbook_dev tr:last-child td:last-child {
  border-bottom-right-radius: 6px;
}
.growthbook_dev tr:not(.current):hover {
  background: ${COLORS.hover};
}
.growthbook_dev td, .growthbook_dev th {
  border: 1px solid ${COLORS.bg};
  padding: 4px;
}
.growthbook_dev th {
  text-align: right;
  width: 2em;
}
.growthbook_dev table tr.current {
  background: ${COLORS.selected};
  cursor: default;
}
.growthbook_dev .explist {
  max-height: 400px;
  overflow-y: auto;
  margin-right: -6px;
  padding-right: 6px;
}
.growthbook_dev ::-webkit-scrollbar {
  width: 8px;
}
.growthbook_dev ::-webkit-scrollbar-thumb {
  background: rgba(255,255,255, 40%);
  border-radius: 6px;
}
.growthbook_dev button {
  background: transparent;
  border: 0;
  padding: 3px;
  cursor: pointer;
  vertical-align: middle;
  transition: transform 0.1s;
  color: ${COLORS.text}
}
@media (max-width: 768px) {
  .growthbook_dev h5 button {
    display: none;
  }
}
.growthbook_dev button:hover {
  transform: scale(1.1);
}
      `,
        }}
      />
      <h3>GrowthBook Dev</h3>
      <button
        className="toggle"
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => {
            try {
              window.sessionStorage.setItem(
                SESSION_STORAGE_OPEN_KEY,
                o ? "" : "1"
              );
            } catch (e) {
              // Ignore sessionStorage errors
            }
            return !o;
          });
        }}
      >
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
                      onClick={(e) => {
                        e.preventDefault();
                        forceVariation(key, i);
                      }}
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
