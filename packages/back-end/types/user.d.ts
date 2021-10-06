export interface UserInterface {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  admin: boolean;
  isVerified?: boolean;
  verificationSecret?: string;
  verificationSent?: Date;
}
