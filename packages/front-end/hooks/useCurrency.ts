import { supportedCurrencies } from "@/pages/settings";
import { useUser } from "@/services/UserContext";

export function useCurrency(): string {
  const { settings } = useUser();
  return (
    Object.keys(supportedCurrencies).find(
      (key) => key === settings.displayCurrency
    ) || "USD"
  );
}
