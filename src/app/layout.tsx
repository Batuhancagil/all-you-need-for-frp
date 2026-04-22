import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";
import TopNav from "./top-nav";

export const metadata: Metadata = {
  title: "AllYouNeedForFRP",
  description: "Voice, video, chat and dice rooms for tabletop sessions",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("aynfrp:theme")||"light";document.documentElement.classList.toggle("dark",t==="dark");}catch(_){}})();`,
          }}
        />
      </head>
      <body className="app-surface min-h-screen antialiased">
        <Providers>
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
