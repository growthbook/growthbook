export interface UserInterface {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  admin: boolean;
  isVerified?: boolean;
  verificationToken?: string;
  verificationSent?: Date;
}
