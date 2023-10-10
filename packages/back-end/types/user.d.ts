export interface UserInterface {
  id: string;
  name?: string;
  email: string;
  verified: boolean;
  passwordHash?: string;
  admin: boolean;
  minTokenDate?: Date;
  externalId?: string;
  managedByIdp?: boolean;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
}
