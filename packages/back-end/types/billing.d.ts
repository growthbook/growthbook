export type GetQuoteResponse = {
  status: number;
  actualUsage: { requests: number; bandwidth: number };
  projectedUsage: { requests: number; bandwidth: number };
  projectedCost: { requests: number; bandwidth: number };
};
