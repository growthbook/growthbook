import { SupportedCurrencies, supportedCurrencies } from "@/pages/settings";
import { useUser } from "@/services/UserContext";

export function useCurrency(): SupportedCurrencies {
  const { settings } = useUser();
  return (
    (Object.keys(supportedCurrencies).find(
      (key) => key === settings.displayCurrency
    ) as SupportedCurrencies) || "USD"
  );
}
