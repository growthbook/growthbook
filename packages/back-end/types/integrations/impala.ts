export interface ImpalaConnectionParams {
  host: string;
  port: number;
  authMech: "0" | "1" | "2";
  username: string;
  password: string;
  defaultSchema: string;
}
