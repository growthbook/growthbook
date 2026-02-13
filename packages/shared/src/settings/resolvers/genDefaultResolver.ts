import lodash from "lodash";
const { get } = lodash;
import { Settings, ScopeDefinition, SettingsResolver } from "../types.js";

const scopeOrder: Array<keyof ScopeDefinition> = [
  "project",
  "datasource",
  "experiment",
  "metric",
  "report",
];

export default function genDefaultResolver(
  baseFieldName: keyof Settings,
  scopesToApply:
    | Partial<Record<keyof ScopeDefinition, boolean | string>>
    | undefined = {},
  options?: {
    bypassEmpty?: boolean;
  },
): SettingsResolver<Settings[keyof Settings]> {
  const filteredScopes = scopeOrder
    .filter((s) => scopesToApply?.[s])
    .map((s) => ({
      scope: s,
      fieldName:
        typeof scopesToApply?.[s] === "string"
          ? scopesToApply[s]
          : baseFieldName,
    }));
  return (ctx) => {
    const baseSetting = ctx.baseSettings[baseFieldName]?.value;
    return filteredScopes.reduce(
      (acc, { scope, fieldName }) => {
        let scopedValue = get(ctx.scopes, `${scope}.${fieldName}`);
        if (options?.bypassEmpty && scopedValue === "") {
          scopedValue = undefined;
        }
        if (typeof scopedValue === "undefined") return acc;
        return {
          value: scopedValue,
          meta: {
            scopeApplied: scope,
            reason: `${scope}-level setting applied`,
          },
        };
      },
      {
        value: baseSetting,
        meta: {
          scopeApplied: "organization",
          reason: "org-level setting applied",
        },
      },
    );
  };
}
