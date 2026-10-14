import { usePayloadSizeNotices } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import { AppNotice, rankNotices } from "./notices";
import useAccountPlanNotices from "./useAccountPlanNotices";
import useKeyExpiryNotices from "./useKeyExpiryNotices";

export default function useAppNotices(): AppNotice[] {
  return rankNotices([
    ...useAccountPlanNotices(),
    ...usePayloadSizeNotices(),
    ...useKeyExpiryNotices(),
  ]);
}
