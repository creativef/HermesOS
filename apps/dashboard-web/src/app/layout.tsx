import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Hermes Dashboard",
  description: "Hermes-centered workspace dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Set theme before hydration to minimize flash.
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  try {
    const t = localStorage.getItem('DASHBOARD_THEME') || 'light-1';
    document.documentElement.dataset.theme = t;
  } catch {}
})();`.trim(),
          }}
        />
      </head>
      <body suppressHydrationWarning className="font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
