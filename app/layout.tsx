import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Growth Intelligence", template: "%s · Growth Intelligence" },
  description: "Akidha performance marketing and growth intelligence (internal).",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
