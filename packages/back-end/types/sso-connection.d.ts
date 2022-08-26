export interface SSOConnectionInterface {
  id?: string;
  dateCreated?: Date;
  organization?: string;
  emailDomain?: string;
  idpType?: string;
  authority: string;
  clientId: string;
}

export interface SSOConnectionParams {
  id: string;
  authority: string;
  clientId: string;
}
