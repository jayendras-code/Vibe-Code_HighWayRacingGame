import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Racer",
  description: "Endless 3D highway racer",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
