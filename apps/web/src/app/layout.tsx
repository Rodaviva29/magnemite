import type { Metadata, Viewport } from "next";
import { CalSansGeo } from "@calcom/cal-sans-ui/geo";
import { CalSansText } from "@calcom/cal-sans-ui/text";
import { CalSansUI } from "@calcom/cal-sans-ui/ui";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnemite",
  description: "Fleet updater for rooted Android TV boxes",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101010" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the class before React runs,
    // so the server and client markup differ on <html> by design.
    <html
      lang="en"
      className={`${CalSansUI.variable} ${CalSansText.variable} ${CalSansGeo.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
