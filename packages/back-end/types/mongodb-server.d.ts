// Non-public module of the mongodb 4.x driver, wrapped by src/util/mongoCallStats.ts
declare module "mongodb/lib/sdam/server" {
  export class Server {
    command(
      ns: unknown,
      cmd: unknown,
      options: unknown,
      callback: (...args: unknown[]) => void,
    ): void;
  }
}
