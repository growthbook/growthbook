import { supportedCurrencies } from "@front-end/services/settings";
import { useUser } from "@front-end/services/UserContext";

export function useCurrency(): string {
  const { settings } = useUser();
  return settings.displayCurrency &&
    settings.displayCurrency in supportedCurrencies
    ? settings.displayCurrency
    : "USD";
}
