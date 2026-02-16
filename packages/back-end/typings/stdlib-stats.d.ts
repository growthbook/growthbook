declare module "@stdlib/stats/base/dists/normal/lib/index.js" {
  const normal: {
    cdf: (x: number, mu: number, sigma: number) => number;
    pdf: (x: number, mu: number, sigma: number) => number;
    quantile: (p: number, mu: number, sigma: number) => number;
    [key: string]: unknown;
  };
  export default normal;
}
