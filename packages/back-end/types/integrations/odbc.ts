// TODO: Add more drivers as needed
export type ODBCDriver = "impala";

export interface ODBCConnectionParams {
  dsn: string;
  driver: ODBCDriver;
}
