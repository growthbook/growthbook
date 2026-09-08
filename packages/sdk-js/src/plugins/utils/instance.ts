import type { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";

export type AnyGrowthBook =
  | GrowthBook
  | UserScopedGrowthBook
  | GrowthBookClient;

// Duck-typed rather than instanceof so a CDN bundle and an npm copy of the
// SDK recognize each other's instances

export function isFullGrowthBook(gb: AnyGrowthBook): gb is GrowthBook {
  return "getAttributes" in gb && "onDestroy" in gb;
}

export function isGrowthBookClient(gb: AnyGrowthBook): gb is GrowthBookClient {
  return "createScopedInstance" in gb;
}
