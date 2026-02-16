import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import TopNav from "./top-nav";

export const metadata: Metadata = {
  title: "AllYouNeedForFRP",
  description: "Voice, video, and chat rooms for tabletop sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
