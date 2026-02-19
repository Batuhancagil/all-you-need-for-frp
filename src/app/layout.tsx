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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("aynfrp:theme")||"light";document.documentElement.classList.toggle("dark",t==="dark");})();`,
          }}
        />
      </head>
      <body className="antialiased bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
