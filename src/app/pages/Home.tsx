import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useCart } from '../context/CartContext';
import { useMenuData } from '../data/useMenuData';
import { Music, Sunset, Wine, Plus, ChevronDown, ArrowRight } from 'lucide-react';

const HERO_IMAGES = [
  '/hero-1.jpg',
  '/hero-2.jpg',
  '/hero-3.jpg',
  '/hero-4.jpg',
  '/hero-5.jpg',
  '/hero-6.jpg',
  '/hero-7.jpg',
  '/hero-8.jpg',
  '/hero-9.jpg',
  '/hero-10.jpg',
];

const STORY_IMAGES = [
  '/hero-8.jpg',
  '/hero-9.jpg',
  '/hero-10.jpg',
  '/hero-2.jpg',
];
const CTA_BG = '/hero-8.jpg';

const GALLERY_IMAGES = [
  { label: 'The Lounge', span: 'md:row-span-2', url: '/hero-1.jpg' },
  { label: 'Sunset Deck', span: '', url: '/hero-2.jpg' },
  { label: 'The Bar', span: '', url: '/hero-3.jpg' },
  { label: 'Beachfront', span: 'md:row-span-2', url: '/hero-4.jpg' },
  { label: 'Bar Counter', span: '', url: '/hero-6.jpg' },
  { label: 'Twilight Lounge', span: '', url: '/hero-10.jpg' },
  { label: 'The Bar', span: 'md:row-span-2', url: '/hero-7.jpg' },
  { label: 'Open Air', span: '', url: '/hero-8.jpg' },
  { label: 'Canopy Bar', span: '', url: '/hero-9.jpg' },
  { label: 'Interior', span: '', url: '/hero-5.jpg' },
];

const WEEKLY_EVENTS = [
  { day: 'Sunday', theme: 'Seafood Sundays', desc: 'Whole fresh catch of the day, grilled on charcoal.' },
  { day: 'Monday', theme: 'Mediterranean Night', desc: 'A tasting menu celebrating the Aegean.' },
  { day: 'Tuesday', theme: 'Sunset Acoustic', desc: 'Live acoustic sets as the sun melts into the sea.' },
  { day: 'Wednesday', theme: 'Mazi Sunset Session', desc: 'Our signature DJ night from golden hour till late.' },
  { day: 'Thursday', theme: 'Throwback Thursday', desc: 'Classic hits, vintage cocktails, barefoot dancing.' },
  { day: 'Friday', theme: 'Friday Fiesta', desc: 'Latin rhythms, mezcal cocktails, and ceviche bar.' },
  { day: 'Saturday', theme: 'Beach Beats', desc: 'Local DJs, sunset cocktails, and dancing on the sand till late.' },
];

export function HomePage() {
  const { addItem } = useCart();
  const { menuItems } = useMenuData();
  const [heroIndex, setHeroIndex] = useState(0);
  const [storyIndex, setStoryIndex] = useState(0);

  // Rotate hero images every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Rotate story images every 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setStoryIndex((prev) => (prev + 1) % STORY_IMAGES.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const signatureCategories = ['Raw Bar', 'Signature Seafood', 'Wood Fire Meat'];
  const dishes = menuItems
    .filter((item) => signatureCategories.includes(item.category))
    .slice(0, 6);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div className="w-full bg-[#f6f2e8]">
      {/* ============ 1. HERO — cinematic ============ */}
      <section className="relative h-screen min-h-[640px] flex items-center justify-center overflow-hidden bg-[#0e1533] noise">
        {/* Rotating hero images with crossfade + Ken Burns zoom */}
        {HERO_IMAGES.map((src, i) => (
          <motion.div
            key={src}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: i === heroIndex ? 1 : 0, scale: i === heroIndex ? 1.12 : 1 }}
            transition={{ opacity: { duration: 1.6, ease: 'easeInOut' }, scale: { duration: 7, ease: 'easeOut' } }}
          >
            <img src={src} alt="Mazi Beach Restaurant" className="w-full h-full object-cover" />
          </motion.div>
        ))}

        {/* Cinematic scrims + vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0e1533]/55 via-[#0e1533]/15 to-[#0e1533]" />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 8%, transparent 42%, rgba(14,21,51,0.6))' }} />
        {/* Aurora light glows */}
        <div className="pointer-events-none absolute -top-1/3 left-1/2 -translate-x-1/2 w-[80vw] h-[80vw] rounded-full blur-3xl animate-aurora" style={{ background: 'radial-gradient(circle, rgba(47,111,158,0.35), transparent 60%)' }} />
        <div className="pointer-events-none absolute bottom-0 right-0 w-[52vw] h-[52vw] rounded-full blur-3xl animate-aurora" style={{ background: 'radial-gradient(circle, rgba(201,162,74,0.18), transparent 60%)', animationDelay: '-9s' }} />

        {/* Content */}
        <div className="relative z-10 text-center px-4 max-w-4xl">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1 }}
            className="font-elegant italic text-gold-gradient text-xl md:text-3xl mb-5"
          >
            — together, by the sea —
          </motion.p>

          {/* Logo with glow */}
          <motion.div
            initial={{ opacity: 0, scale: 0.86, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1.3, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative inline-block"
          >
            <div className="absolute inset-0 bg-[#2f6f9e] blur-[70px] rounded-full animate-glow" />
            <img src="/mazi-logo-full-white.png" alt="Mazi" className="relative z-10 mx-auto w-56 md:w-80 h-auto drop-shadow-2xl" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9 }}
            className="mt-7 text-[0.68rem] md:text-xs text-white/70 uppercase tracking-[0.34em]"
          >
            Mediterranean Beach Club &nbsp;·&nbsp; Ras El Hekma, North Coast
          </motion.p>

          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: '140px', opacity: 1 }}
            transition={{ duration: 0.9, delay: 1.2 }}
            className="mx-auto h-px rule-gold mt-7"
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.4 }}
            className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link to="/reserve">
              <Button className="sheen group bg-gradient-to-r from-[#c9a24a] to-[#e3c878] hover:from-[#e3c878] hover:to-[#c9a24a] text-[#1b2350] border-none rounded-full px-9 h-14 text-sm font-semibold uppercase tracking-[0.14em] transition-all duration-300 hover:scale-[1.03] shadow-gold">
                Reserve a Table <ArrowRight className="w-4 h-4 ml-2 inline transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link to="/menu">
              <Button variant="outline" className="glass text-white border-white/40 hover:bg-white hover:text-[#12207e] rounded-full px-9 h-14 text-sm font-semibold uppercase tracking-[0.14em] transition-all duration-300 hover:scale-[1.03]">
                Explore the Menu
              </Button>
            </Link>
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-2"
        >
          <span className="text-white/50 text-[0.6rem] uppercase tracking-[0.3em]">Scroll</span>
          <motion.div animate={{ y: [0, 10, 0] }} transition={{ duration: 2, repeat: Infinity }} className="text-white/60">
            <ChevronDown className="w-6 h-6" />
          </motion.div>
        </motion.div>
      </section>

      {/* ============ 2. INTRO / STORY ============ */}
      <section className="py-24 md:py-32 bg-[#f6f2e8]">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-center max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="relative"
            >
              {/* Rotating story images with crossfade */}
              {STORY_IMAGES.map((src, i) => (
                <motion.img
                  key={src}
                  src={src}
                  alt="Mazi beachfront restaurant"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: i === storyIndex ? 1 : 0,
                    scale: i === storyIndex ? 1.05 : 1,
                  }}
                  transition={{
                    opacity: { duration: 1.5, ease: 'easeInOut' },
                    scale: { duration: 6, ease: 'easeOut' },
                  }}
                  className="rounded-3xl shadow-2xl w-full h-[500px] object-cover absolute inset-0"
                />
              ))}
              <div className="relative h-[500px]" />
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="absolute -bottom-6 -right-6 bg-[#12207e] px-6 py-4 rounded-2xl shadow-xl hidden md:block flex items-center justify-center"
              >
                <img
                  src="/mazi-logo-full-white.png"
                  alt="Mazi"
                  className="h-12 w-auto object-contain"
                />
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              <span className="eyebrow-gold block mb-5">Our Story</span>
              <h2 className="display-xl text-5xl md:text-6xl text-[#1b2350] mb-6">
                Mazi Means <span className="italic text-aegean-gradient">Together</span>
              </h2>
              <p className="text-gray-600 text-lg leading-relaxed mb-5">
                In Greek, <span className="text-[#12207e] font-semibold">mazi means together</span> — and that
                single word is the whole idea. Set on the white sand of Ras El Hekma inside Mountain View,
                Mazi is a Greek-Mediterranean table made for long, unhurried gatherings, where the sea
                keeps the pace and no one is in a hurry to leave.
              </p>
              <p className="text-gray-600 text-lg leading-relaxed mb-8">
                We cook with fire and restraint — a raw bar from the morning boats, whole fish over
                olive-wood embers, and salads bright with Cretan oil and fresh herbs. From the first
                plate at golden hour to the last as the music rises, Mazi is where the coast, the table
                and the people come <span className="italic">together, by the sea.</span>
              </p>
              <div className="flex flex-wrap gap-3">
                {['Wood-Fire Seafood', 'Raw Bar Daily', 'Greek Hospitality', 'Sunset to Late'].map((tag, i) => (
                  <motion.span
                    key={tag}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: i * 0.08 }}
                    className="px-4 py-2 rounded-full bg-[#e6eef4] text-[#12207e] text-sm font-semibold border border-[#12207e]/10"
                  >
                    {tag}
                  </motion.span>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ============ 3. SIGNATURE DISHES ============ */}
      <section className="py-24 md:py-32 bg-[#1b2350] relative overflow-hidden">
        {/* Subtle glow */}
        <motion.div
          animate={{ opacity: [0.05, 0.12, 0.05] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#12207e] rounded-full blur-[200px]"
        />
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <span className="eyebrow-gold block mb-5">From the Sea</span>
            <h2 className="display-xl text-5xl md:text-7xl text-white mb-5">
              Signature <span className="italic text-gold-gradient">Dishes</span>
            </h2>
            <p className="font-elegant text-sea-glass/90 max-w-2xl mx-auto text-xl md:text-2xl italic">
              A taste of what's coming out of our kitchen — fresh, charcoal-grilled, and sea-focused.
            </p>
          </div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"
          >
            {dishes.map((dish) => (
              <motion.div
                key={dish.id}
                variants={itemVariants}
                whileHover={{ y: -6 }}
                className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden group flex flex-col ${
                  dish.status === 'sold_out' ? 'opacity-60 grayscale' : ''
                }`}
              >
                <div className="relative h-56 overflow-hidden shrink-0">
                  {dish.image ? (
                    <img
                      src={dish.image}
                      alt={dish.name}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                  ) : (
                    // Branded no-photo treatment matching the dark section aesthetic.
                    // Lights up automatically once a real image is provided.
                    <div className="w-full h-full flex flex-col items-center justify-center text-center px-6 bg-gradient-to-br from-[#12207e] to-[#1b2350]">
                      <span className="text-[#3c6e8f] font-bold tracking-[0.3em] uppercase text-[10px] mb-3">
                        {dish.category}
                      </span>
                      <span className="font-serif text-xl font-bold text-[#f0e6d2] leading-tight">
                        {dish.name}
                      </span>
                      <span className="mt-4 h-px w-10 bg-[#3c6e8f]/50" />
                    </div>
                  )}
                  {dish.status === 'sold_out' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="bg-white text-[#1b2350] px-4 py-2 rounded-full font-bold text-sm">SOLD OUT</span>
                    </div>
                  )}
                </div>
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="font-serif text-xl font-bold text-white leading-tight mb-2">{dish.name}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed line-clamp-2 mb-4 flex-1">{dish.description}</p>
                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[#3c6e8f] font-bold text-lg">EGP {dish.price}</span>
                    {dish.status === 'sold_out' ? (
                      <Button disabled className="bg-white/10 text-white/40 border-none rounded-full px-4 h-9 text-sm">
                        Unavailable
                      </Button>
                    ) : (
                      <Button
                        onClick={() => addItem({ id: dish.id, name: dish.name, price: dish.price, image: dish.image })}
                        className="bg-[#12207e] hover:bg-[#3c6e8f] text-white border-none rounded-full px-4 h-9 text-sm font-semibold transition-all"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {dishes.length === 0 && (
            <div className="text-center mt-14">
              <Link to="/menu">
                <Button className="bg-[#12207e] hover:bg-[#3c6e8f] text-white border-none rounded-full px-8 h-12 text-base font-semibold transition-all group">
                  View Full Menu <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          )}

          {dishes.length > 0 && (
            <div className="text-center mt-14">
              <Link to="/menu">
                <Button variant="outline" className="border-2 border-[#3c6e8f] text-[#3c6e8f] hover:bg-[#3c6e8f] hover:text-white bg-transparent rounded-full px-8 h-12 text-base font-semibold transition-all group">
                  View Full Menu <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ============ 4. SUNSET SESSIONS ============ */}
      <section className="relative py-24 md:py-32 bg-gradient-to-br from-[#12207e] to-[#3c6e8f] overflow-hidden">
        {/* Animated floating orbs */}
        <motion.div
          animate={{ y: [0, -40, 0], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-10 right-10 w-96 h-96 bg-white rounded-full blur-[150px]"
        />
        <motion.div
          animate={{ y: [0, 50, 0], opacity: [0.08, 0.15, 0.08] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-10 left-10 w-96 h-96 bg-[#f0e6d2] rounded-full blur-[150px]"
        />
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-serif text-4xl md:text-6xl font-bold text-white mb-3"
            >
              Sunset Sessions
            </motion.h2>
            <p className="text-[#f0e6d2] text-lg md:text-xl font-light tracking-wide mb-4">Every evening from 6 PM</p>
            <p className="text-white/80 max-w-2xl mx-auto text-lg leading-relaxed">
              As the sun dips into the Mediterranean, Mazi comes alive. DJ sets, signature cocktails,
              and golden hour on the beach — the way summer was meant to be spent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              { icon: Music, title: 'Live DJ Sets', desc: 'Resident and guest DJs spinning from sunset till late.' },
              { icon: Sunset, title: 'Signature Cocktails', desc: 'Mazi Sunset, Aegean Spritz, and Mediterranean Negroni.' },
              { icon: Wine, title: 'Beachfront Dining', desc: 'Tables on the sand, toes in the water, stars overhead.' },
            ].map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-8 text-center hover:bg-white/15 transition-all duration-300 group"
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 5 }}
                  className="w-16 h-16 bg-[#f0e6d2] rounded-full flex items-center justify-center mx-auto mb-6 transition-transform"
                >
                  <feature.icon className="w-8 h-8 text-[#12207e]" />
                </motion.div>
                <h3 className="font-serif text-2xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-white/80 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 5. GALLERY ============ */}
      <section className="py-24 md:py-32 bg-[#f6f2e8]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="eyebrow-gold block mb-5">Gallery</span>
            <h2 className="display-xl text-5xl md:text-7xl text-[#1b2350] mb-4">Life at <span className="italic text-aegean-gradient">Mazi</span></h2>
            <p className="text-gray-600 max-w-2xl mx-auto text-lg">Beach, food, cocktails, and golden hour — a glimpse of summer.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-6xl mx-auto auto-rows-[200px] md:auto-rows-[240px]">
            {GALLERY_IMAGES.map((img, i) => (
              <motion.div
                key={img.url}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`relative overflow-hidden rounded-2xl group ${img.span}`}
              >
                <img
                  src={img.url}
                  alt={img.label}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1b2350]/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                  <span className="text-white font-semibold text-sm tracking-wide">{img.label}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 6. EVENTS CALENDAR ============ */}
      <section className="py-24 md:py-32 bg-[#1b2350] relative overflow-hidden">
        <motion.div
          animate={{ opacity: [0.03, 0.08, 0.03] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-[#3c6e8f] rounded-full blur-[200px]"
        />
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <span className="eyebrow-gold block mb-5">Weekly Calendar</span>
            <h2 className="display-xl text-5xl md:text-7xl text-white mb-4">This Summer at <span className="italic text-gold-gradient">Mazi</span></h2>
            <p className="text-gray-400 max-w-2xl mx-auto text-lg">Seven nights, seven moods. Find your night.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            {WEEKLY_EVENTS.map((event, i) => (
              <motion.div
                key={event.day}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                whileHover={{ scale: 1.03 }}
                className={`rounded-2xl p-6 border transition-all duration-300 ${
                  event.day === 'Wednesday'
                    ? 'bg-gradient-to-br from-[#12207e] to-[#3c6e8f] border-transparent col-span-1 lg:col-span-1'
                    : 'bg-white/5 border-white/10 hover:border-[#3c6e8f]/40'
                }`}
              >
                <p className={`text-xs uppercase tracking-[0.2em] font-bold mb-2 ${event.day === 'Wednesday' ? 'text-[#f0e6d2]' : 'text-[#3c6e8f]'}`}>
                  {event.day}
                </p>
                <h3 className="font-serif text-xl font-bold text-white mb-2 leading-tight">{event.theme}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{event.desc}</p>
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-14">
            <Link to="/events">
              <Button variant="outline" className="border-2 border-[#3c6e8f] text-[#3c6e8f] hover:bg-[#3c6e8f] hover:text-white bg-transparent rounded-full px-8 h-12 text-base font-semibold transition-all group">
                View All Events <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ============ 7. CTA SECTION ============ */}
      <section className="relative py-36 md:py-48 overflow-hidden bg-[#0e1533] noise">
        {/* Real photo, fixed for parallax feel */}
        <div className="absolute inset-0 bg-fixed bg-center bg-cover" style={{ backgroundImage: `url(${CTA_BG})` }} />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0e1533]/70 via-[#0e1533]/60 to-[#0e1533]/90" />
        {/* Gold aurora */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] rounded-full blur-3xl animate-aurora" style={{ background: 'radial-gradient(circle, rgba(201,162,74,0.16), transparent 62%)' }} />

        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-elegant italic text-gold-gradient text-2xl md:text-3xl mb-4"
          >
            your table by the sea awaits
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="font-display text-5xl md:text-7xl font-semibold text-white leading-[1.05] mb-6"
          >
            Spend the summer<br />with us
          </motion.h2>
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            whileInView={{ width: '120px', opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.25 }}
            className="mx-auto h-px rule-gold mb-10"
          />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.35 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link to="/reserve">
              <Button className="sheen group bg-gradient-to-r from-[#c9a24a] to-[#e3c878] hover:from-[#e3c878] hover:to-[#c9a24a] text-[#1b2350] border-none rounded-full px-10 h-14 text-sm font-semibold uppercase tracking-[0.14em] transition-all duration-300 hover:scale-[1.03] shadow-gold">
                Reserve a Table <ArrowRight className="ml-2 w-4 h-4 inline transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link to="/menu">
              <Button variant="outline" className="glass text-white border-white/40 hover:bg-white hover:text-[#12207e] rounded-full px-10 h-14 text-sm font-semibold uppercase tracking-[0.14em] transition-all duration-300 hover:scale-[1.03]">
                View the Menu
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}