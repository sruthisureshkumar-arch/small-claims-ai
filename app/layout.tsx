import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Small Claims AI: escrow with a judge",
  description: "PayPal holds the money. An AI judge hears the dispute. Only the fair share moves.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="in">
            <a className="brand" href="/"><i />Small Claims</a>
            <nav>
              <a href="/">New deal</a>
              <a href="/agents">Agent court</a>
              <a href="/impact">Impact</a>
              <a href="/api/openapi">API</a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
