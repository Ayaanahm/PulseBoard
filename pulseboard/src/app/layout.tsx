import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "PulseBoard", description: "Multi-tenant API analytics & uptime monitoring" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
