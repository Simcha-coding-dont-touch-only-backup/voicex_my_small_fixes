import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X, Phone } from 'lucide-react';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/features', label: 'Features' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export function MarketingLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Reset scroll position on route change so each page starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header
        className={`sticky top-0 z-40 w-full transition-all duration-200 ${
          scrolled
            ? 'border-b border-slate-200/70 bg-slate-50/85 backdrop-blur-md'
            : 'bg-slate-50'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 group">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm group-hover:shadow-md transition-shadow">
              <Phone size={18} strokeWidth={2.5} />
            </span>
            <span className="text-lg font-bold tracking-tight">VoiceX</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-indigo-700'
                      : 'text-slate-600 hover:text-slate-900'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              Sign in
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
            >
              Request demo
            </Link>
          </div>

          <button
            type="button"
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-slate-200 bg-slate-50">
            <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
              <nav className="flex flex-col gap-1">
                {NAV_LINKS.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `rounded-md px-3 py-2.5 text-base font-medium ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
                <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
                  <Link
                    to="/login"
                    className="rounded-md px-3 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/contact"
                    className="rounded-lg bg-slate-900 px-3 py-2.5 text-center text-base font-semibold text-white"
                  >
                    Request demo
                  </Link>
                </div>
              </nav>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
                <Phone size={18} strokeWidth={2.5} />
              </span>
              <span className="text-lg font-bold tracking-tight">VoiceX</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-600">
              Voice-first commerce for the millions of customers who can't or
              won't shop online. We turn any phone call into a complete shopping
              experience — no app, no internet, no learning curve.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Product</h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <Link to="/features" className="text-slate-600 hover:text-slate-900">
                  Features
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-slate-600 hover:text-slate-900">
                  About
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-slate-600 hover:text-slate-900">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Company</h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <Link to="/contact" className="text-slate-600 hover:text-slate-900">
                  Request demo
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-slate-600 hover:text-slate-900">
                  Admin sign in
                </Link>
              </li>
              <li>
                <a
                  href="mailto:support@voicexservice.com"
                  className="text-slate-600 hover:text-slate-900"
                >
                  support@voicexservice.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>© {year} VoiceX LLC. All rights reserved.</p>
          <p>Voice-powered phone commerce.</p>
        </div>
      </div>
    </footer>
  );
}
