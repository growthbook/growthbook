export interface Card {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  type: "Card";
  wallet?: string;
}

export interface BankAccount {
  id: string;
  last4?: string;
  brand: string;
  isDefault: boolean;
  type: "Bank Account";
}

export type PaymentMethod = Card | BankAccount;
