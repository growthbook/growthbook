export interface UserInterface {
  id: string;
  name?: string;
  email: string;
  verified: boolean;
  passwordHash?: string;
  superAdmin: boolean;
  minTokenDate?: Date;
  dateCreated?: Date;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
}
