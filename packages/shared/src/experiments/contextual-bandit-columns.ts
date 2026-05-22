import { ATTR_CB_PREFIX, ATTR_CB_RAW_PREFIX } from "shared/constants";

export function contextualBanditAttrCol(alias: string): string {
  return `${ATTR_CB_PREFIX}${alias}`;
}

export function contextualBanditRawAttrCol(alias: string): string {
  return `${ATTR_CB_RAW_PREFIX}${alias}`;
}

export function isContextualBanditAttrColumn(key: string): boolean {
  return key.startsWith(ATTR_CB_PREFIX);
}
