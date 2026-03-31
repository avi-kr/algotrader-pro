'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, Home, Layers, FlaskConical, Menu, X, Zap } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/charts', label: 'Charts', icon: BarChart2 },
  { href: '/strategies', label: 'Strategies', icon: Layers },
  { href: '/backtest', label: 'Backtest', icon: FlaskConical },
]

export default function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [time, setTime] = useState('')
  const [marketStatus, setMarketStatus] = useState('Checking...')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST')

      // NSE hours: 9:15 AM – 3:30 PM IST Mon-Fri
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const h = ist.getHours(), m = ist.getMinutes(), d = ist.getDay()
      const open = (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30))
      const weekday = d >= 1 && d <= 5
      setMarketStatus(weekday && open ? 'MARKET OPEN' : 'MARKET CLOSED')
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
        <div className="max-w-screen-2xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <Zap size={16} className="text-bg" />
            </div>
            <span className="font-display font-bold text-lg gradient-text hidden sm:block">AlgoTrader Pro</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-display font-medium transition-all duration-200 ${
                  pathname === href
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'text-textsecondary hover:text-textprimary hover:bg-surface2'
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            ))}
          </div>

          {/* Market status + time */}
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${marketStatus === 'MARKET OPEN' ? 'bg-accent pulse-live' : 'bg-muted'}`} />
              <span className={marketStatus === 'MARKET OPEN' ? 'text-accent' : 'text-muted'}>
                {marketStatus}
              </span>
            </div>
            <span className="text-muted">{time}</span>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 text-muted hover:text-textprimary"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border bg-surface">
            <div className="px-4 py-3 flex flex-col gap-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-display font-medium transition-all ${
                    pathname === href
                      ? 'bg-accent/10 text-accent'
                      : 'text-textsecondary hover:text-textprimary hover:bg-surface2'
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
              <div className="mt-2 pt-2 border-t border-border flex items-center gap-2 px-4 text-xs font-mono text-muted">
                <span className={`w-2 h-2 rounded-full ${marketStatus === 'MARKET OPEN' ? 'bg-accent' : 'bg-muted'}`} />
                {marketStatus} · {time}
              </div>
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
