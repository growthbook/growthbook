import { Condition } from "shared/types/metric";

export function getMixpanelPropertyColumn(col: string) {
  // Use the column directly if it contains a reference to `event`
  if (col.match(/\bevent\b/)) {
    return col;
  }

  const colAccess = col.split(".").map((part) => {
    if (part.substr(0, 1) !== "[") return `["${part}"]`;
    return part;
  });
  return `event.properties${colAccess.join("")}`;
}

export function conditionToJavascript({ operator, value, column }: Condition) {
  const col = getMixpanelPropertyColumn(column);
  const encoded = JSON.stringify(value);

  // Some operators map to special javascript syntax
  if (operator === "~") {
    return `(${col}||"").match(new RegExp(${encoded}))`;
  } else if (operator === "!~") {
    return `!(${col}||"").match(new RegExp(${encoded}))`;
  } else if (operator === "=") {
    return `${col}+'' == ${encoded}`;
  } else if (operator === "=>") {
    // Callback function
    return `((value) => (${value}))(${col})`;
  } else {
    // If the value is a number, don't use the JSON encoded version for comparison
    const comp = !value || isNaN(Number(value)) ? encoded : value;

    // All the other operators exactly match the javascript syntax so we can use them directly
    return `${col}+'' ${operator} ${comp}`;
  }
}

export const AGGREGATE_JS_FUNCTIONS = {
  sum: `(arr) => arr.reduce((sum, x) => sum + x, 0)`,
  count: `(arr) => arr.length`,
  countDistinct: `(arr) => new Set(arr).size`,
  min: `(arr) => Math.min(...arr)`,
  max: `(arr) => Math.max(...arr)`,
  avg: `(arr) => count(arr)>0?(sum(arr)/count(arr)):0`,
  percentile: `(arr, p) => {
    const s = [...arr].sort((a,b)=>a-b);
    if(!s.length) return 0;
    if(p<=0) return s[0];
    if(p>=100) return s[arr.length-1];
    const r = (s.length-1)*p/100;
    const rf = Math.ceil(r) - r;
    return s[Math.floor(r)]*rf + s[Math.ceil(r)]*(1-rf);
  }`,
  median: `(arr) => percentile(arr, 50)`,
};

export function getAggregateFunctions() {
  return Object.keys(AGGREGATE_JS_FUNCTIONS)
    .map(
      (k: keyof typeof AGGREGATE_JS_FUNCTIONS) =>
        `const ${k} = ${AGGREGATE_JS_FUNCTIONS[k]};`,
    )
    .join("\n");
}
