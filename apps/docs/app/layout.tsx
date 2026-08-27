import "./global.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { CalSansGeo } from "@calcom/cal-sans-ui/geo";
import { CalSansText } from "@calcom/cal-sans-ui/text";
import { CalSansUI } from "@calcom/cal-sans-ui/ui";
import { RootProvider } from "fumadocs-ui/provider/next";

export const metadata: Metadata = {
  title: {
    default: "Magnemite",
    template: "%s — Magnemite",
  },
  description:
    "Over-the-air updater for a fleet of rooted Android TV boxes running the Unown# scanning stack.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The same three faces the dashboard loads, under the same variable names,
    // so the docs and the product read as one thing.
    <html
      lang="en"
      className={`${CalSansUI.variable} ${CalSansText.variable} ${CalSansGeo.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
