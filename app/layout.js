import './globals.css'
import Navbar from '@/components/Navbar'

export const metadata = {
  title: 'AlgoTrader Pro | Indian & Crypto Markets',
  description: 'Personal automated trading platform for Indian stocks and crypto with backtesting',
  viewport: 'width=device-width, initial-scale=1',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-bg text-textprimary font-body min-h-screen">
        <div className="flex flex-col min-h-screen">
          <Navbar />
          <main className="flex-1 pt-16">
            {children}
          </main>
          <footer className="border-t border-border py-4 px-6 text-center text-muted text-xs font-mono">
            <span className="gradient-text font-display font-semibold">AlgoTrader Pro</span>
            <span className="mx-2">·</span>
            Data via Yahoo Finance & CoinGecko
            <span className="mx-2">·</span>
            For educational purposes only
          </footer>
        </div>
      </body>
    </html>
  )
}
