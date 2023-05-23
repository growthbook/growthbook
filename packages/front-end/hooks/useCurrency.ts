import { supportedCurrencies } from "@/pages/settings";
import { useUser } from "@/services/UserContext";

export function useCurrency(): string {
  const { settings } = useUser();
  return settings.displayCurrency &&
    settings.displayCurrency in supportedCurrencies
    ? settings.displayCurrency
    : "USD";
}
