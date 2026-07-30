import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, X, ShoppingBag, Phone, MapPin, Instagram, Mail, User, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { useCart, CartProvider } from '../context/CartContext';
import { CartDrawer } from './CartDrawer';
import { useAuth } from '../auth/AuthProvider';

// Inner component to use cart hook
function LayoutContent() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { toggleCart, totalItems } = useCart();
  const { session, signOut } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Menu', path: '/menu' },
    { name: 'Events', path: '/events' },
    { name: 'Reservations', path: '/reserve' },
    { name: 'Membership', path: '/membership' },
  ];

  return (
    <div className="flex flex-col min-h-screen font-sans bg-[#f6f2e8]">
      <CartDrawer />
      
      {/* Header */}
      <header className={`sticky top-0 z-40 w-full transition-all duration-500 ${scrolled ? 'glass-nav shadow-float border-b border-[#12207e]/10' : 'bg-transparent border-b border-transparent'}`}>
        <div className={`container mx-auto px-4 md:px-6 flex items-center justify-between transition-all duration-500 ${scrolled ? 'h-16' : 'h-20'}`}>
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
              <img
              src="/mazi-logo-full.png"
              alt="Mazi"
              className={`w-auto object-contain transition-all duration-500 group-hover:scale-105 ${scrolled ? 'h-11 md:h-12' : 'h-12 md:h-16'}`}
            />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-9">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                className={`group relative text-[0.78rem] font-semibold uppercase tracking-[0.16em] transition-colors py-2 ${
                  location.pathname === link.path ? 'text-[#12207e]' : 'text-[#1b2350]/70 hover:text-[#12207e]'
                }`}
              >
                {link.name}
                <span className={`pointer-events-none absolute -bottom-0.5 left-0 h-[2px] rounded-full rule-gold transition-all duration-500 ${location.pathname === link.path ? 'w-full' : 'w-0 group-hover:w-full'}`} />
              </Link>
            ))}
            {session ? (
              <div className="flex items-center gap-4">
                <Link
                  to="/account"
                  className={`text-sm font-semibold transition-colors hover:text-[#12207e] flex items-center gap-1.5 ${
                    location.pathname === '/account' ? 'text-[#12207e]' : 'text-gray-600'
                  }`}
                >
                  <User className="w-4 h-4" />
                  Account
                </Link>
                <button
                  onClick={() => signOut()}
                  title="Sign out"
                  className="text-sm font-semibold text-gray-600 transition-colors hover:text-[#12207e] flex items-center gap-1.5"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                to="/signin"
                className={`text-sm font-semibold transition-colors hover:text-[#12207e] flex items-center gap-1.5 ${
                  location.pathname === '/signin' ? 'text-[#12207e]' : 'text-gray-600'
                }`}
              >
                <User className="w-4 h-4" />
                Sign in
              </Link>
            )}
            <Button
              onClick={toggleCart}
              className="sheen rounded-full h-11 px-6 bg-gradient-to-r from-[#12207e] to-[#2f6f9e] hover:from-[#0e1533] hover:to-[#12207e] text-white shadow-float hover:shadow-luxe transition-all relative overflow-hidden"
            >
              <ShoppingBag className="w-4 h-4 mr-2" />
              Cart
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#1b2350] text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full border-2 border-white">
                  {totalItems}
                </span>
              )}
            </Button>
          </nav>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-4 md:hidden">
            <button onClick={toggleCart} className="relative p-2 text-gray-600">
              <ShoppingBag className="w-6 h-6" />
              {totalItems > 0 && (
                <span className="absolute top-0 right-0 bg-[#12207e] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full">
                  {totalItems}
                </span>
              )}
            </button>
            <button onClick={toggleMenu} className="p-2 text-gray-600">
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="fixed inset-0 top-20 z-30 bg-white p-6 md:hidden flex flex-col gap-6 border-t"
          >
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-2xl font-bold text-gray-800 hover:text-[#12207e] flex items-center justify-between"
              >
                {link.name}
                <span className="text-gray-300 text-lg">→</span>
              </Link>
            ))}
            {session ? (
              <>
                <Link
                  to="/account"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-2xl font-bold text-gray-800 hover:text-[#12207e] flex items-center gap-3"
                >
                  <User className="w-6 h-6" />
                  Account
                </Link>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    signOut();
                  }}
                  className="text-2xl font-bold text-gray-800 hover:text-[#12207e] flex items-center gap-3 text-left"
                >
                  <LogOut className="w-6 h-6" />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/signin"
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-2xl font-bold text-gray-800 hover:text-[#12207e] flex items-center gap-3"
              >
                <User className="w-6 h-6" />
                Sign in
              </Link>
            )}
            <div className="mt-auto border-t pt-6">
               <Button onClick={() => { setIsMobileMenuOpen(false); toggleCart(); }} className="w-full h-12 text-lg">
                 View Cart ({totalItems})
               </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-black text-white pt-20 pb-10">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            <div>
              <Link to="/" className="mb-6 block">
                <img
                  src="/mazi-logo-header-white.png"
                  alt="Mazi"
                  className="h-16 w-auto object-contain"
                />
              </Link>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Ras El Hekma's premier restaurant & beach club. Mediterranean seafood, sunset sessions, and beach dining on the North Coast.
              </p>
              <div className="flex gap-4">
                <a href="https://instagram.com/mazibeach" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-[#12207e] transition-colors border border-white/10 hover:border-transparent">
                  <Instagram className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#12207e]">Explore</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li><Link to="/menu" className="hover:text-[#12207e] transition-colors">Our Menu</Link></li>
                <li><Link to="/reserve" className="hover:text-[#12207e] transition-colors">Reservations</Link></li>
                <li><Link to="/events" className="hover:text-[#12207e] transition-colors">Events</Link></li>
                <li><Link to="/membership" className="hover:text-[#12207e] transition-colors">Membership</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#12207e]">Get in Touch</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li className="flex items-start gap-3 group">
                  <MapPin className="w-5 h-5 text-[#12207e] shrink-0 group-hover:animate-bounce" />
                  <a
                    href="https://maps.app.goo.gl/Sefc3SW1Zud5midK8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-left hover:text-white transition-colors"
                  >
                    Mountain View, Ras El Hekma, North Coast, Egypt
                    <span className="block text-xs text-[#12207e] group-hover:text-white transition-colors">Get directions →</span>
                  </a>
                </li>
                <li className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-[#12207e] shrink-0 group-hover:rotate-12 transition-transform" />
                  <a href="tel:+201107772117" className="hover:text-white transition-colors">+20 110 777 2117</a>
                </li>
                <li className="flex items-center gap-3 group">
                  <Mail className="w-5 h-5 text-[#12207e] shrink-0 group-hover:scale-110 transition-transform" />
                  <a href="mailto:hello@mazibeach.com" className="hover:text-white transition-colors">hello@mazibeach.com</a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#12207e]">Opening Hours</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li className="flex justify-between border-b border-white/10 pb-2">
                  <span>Mon - Sun</span>
                  <span>12:00 PM - 2:00 AM</span>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-white/10 mt-16 pt-8 text-center text-gray-500 text-sm flex flex-col md:flex-row justify-between items-center gap-4">
            <p>© {new Date().getFullYear()} Mazi. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Layout() {
  return (
    <CartProvider>
      <LayoutContent />
    </CartProvider>
  );
}