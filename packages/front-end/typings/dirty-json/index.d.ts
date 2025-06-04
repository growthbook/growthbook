declare module "dirty-json" {
  export function parse(
    text: string,
    // eslint-disable-next-line
    config?: Record<string, any>
    // eslint-disable-next-line
  ): Record<string, any>;
}
