export interface AITokenUsageInterface {
  id?: string;
  organization: string;
  numTokensUsed: number;
  lastResetAt: number;
  dailyLimit: number;
}
