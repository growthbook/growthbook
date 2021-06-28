declare module "jstat" {
  namespace jStat {
    namespace normal {
      export function inv(n: number, mean: number, stddev: number): number;
      export function pdf(x: number, mean: number, stddev: number): number;
    }
    namespace chisquare {
      export function cdf(x: number, l: number): number;
    }
  }
}
