"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The pages are already re-rendering on every fleet event; animating a
      // full-page colour change on top of that just looks like tearing.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
