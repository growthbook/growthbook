export interface PaymentMethod {
  id: string;
  brand: string;
  type: "card" | "us_bank_account" | "unknown";
  isDefault: boolean;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  wallet?: string;
}
