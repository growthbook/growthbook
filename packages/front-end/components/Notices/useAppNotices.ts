import { usePayloadSizeNotices } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import { AppNotice, rankNotices } from "./notices";
import useAccountPlanNotices from "./useAccountPlanNotices";
import useKeyExpiryNotices from "./useKeyExpiryNotices";

// Every notice for the viewer, most important first. Where they're shown is up
// to the caller.
export default function useAppNotices(): AppNotice[] {
  return rankNotices([
    ...useAccountPlanNotices(),
    ...usePayloadSizeNotices(),
    ...useKeyExpiryNotices(),
  ]);
}
