declare module "next-auth/providers/email" {
  import type { EmailProvider as EmailProviderFactory } from "next-auth/providers";
  const EmailProvider: EmailProviderFactory;
  export default EmailProvider;
}
