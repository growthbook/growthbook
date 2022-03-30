export interface UserInterface {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  passwordHash?: string;
  admin: boolean;
}
