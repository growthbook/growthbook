declare module "dirty-json" {
  export function parse(
    text: string,
    // eslint-disable-next-line
    config?: Record<string, any>
    // eslint-disable-next-line
  ): Record<string, any>;
}

declare module "jstat" {
  namespace jStat {
    namespace normal {
      export function inv(n: number, mean: number, stddev: number): number;
      export function pdf(x: number, mean: number, stddev: number): number;
      export function sample(mean: number, stddev: number): number;
    }
    namespace chisquare {
      export function cdf(x: number, l: number): number;
    }
  }
}
