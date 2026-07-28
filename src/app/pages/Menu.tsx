import React, { useState, useMemo } from 'react';
import { Button } from '../components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Search } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useMenuData } from '../data/useMenuData';
import { RESTAURANT_SECTION_META } from '../data/menuData';
import type { MenuItem, SectionMeta } from '../data/menuData';
import { KiloOrderModal, kiloCartId } from '../components/KiloOrderModal';

const SECTIONS = ['Restaurant', 'Kids'] as const;
type Section = (typeof SECTIONS)[number];

// ------------------------------------------------------------------
// Card — extracted so it can be reused by the flat (search / single
// category) grid and by each section group in the "All" view without
// duplicating the (long) markup. Behaviour is unchanged: photo/no-photo
// header, dietary pills, per-kg "Enquire for today's price", add-to-cart.
// ------------------------------------------------------------------
function MenuCard({
  item,
  index,
  onAdd,
  onKiloAdd,
}: {
  item: MenuItem;
  index: number;
  onAdd: (item: MenuItem) => void;
  onKiloAdd: (item: MenuItem) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.05 }}
      className={`bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col ${
        item.status === 'sold_out' ? 'opacity-70 grayscale' : ''
      }`}
    >
      {item.image ? (
        <div className="relative h-48 overflow-hidden shrink-0">
          <img
            src={item.image}
            alt={item.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          {item.dietary && item.dietary.length > 0 && (
            <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
              {item.dietary.map((tag) => (
                <span
                  key={tag}
                  className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase text-[#12207e] shadow-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {item.status === 'limited' && (
            <div className="absolute top-3 right-3 bg-[#f0e6d2] text-[#12207e] px-3 py-1 rounded-full text-xs font-bold shadow-sm">
              Limited
            </div>
          )}
          {item.status === 'sold_out' && (
            <div className="absolute inset-0 bg-[#1b2350]/50 flex items-center justify-center backdrop-blur-[2px]">
              <span className="bg-white text-[#1b2350] px-4 py-2 rounded-full font-bold shadow-lg text-sm">
                SOLD OUT
              </span>
            </div>
          )}
        </div>
      ) : (
        // Elegant text-only header when no photo is available yet:
        // a slim brand-teal accent bar keeps the card intentional, not empty.
        <div className="h-1.5 bg-gradient-to-r from-[#12207e] to-[#3c6e8f] shrink-0" />
      )}
      <div className="p-5 flex flex-col flex-1">
        {/* No-image case: pills + status live in the body */}
        {!item.image && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            {item.dietary && item.dietary.length > 0 &&
              item.dietary.map((tag) => (
                <span
                  key={tag}
                  className="bg-[#e6eef4] px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase text-[#12207e]"
                >
                  {tag}
                </span>
              ))}
            {item.status === 'limited' && (
              <span className="bg-[#f0e6d2] text-[#12207e] px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase">
                Limited
              </span>
            )}
            {item.status === 'sold_out' && (
              <span className="bg-[#1b2350] text-white px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase">
                Sold Out
              </span>
            )}
          </div>
        )}
        <div className="flex justify-between items-start gap-2 mb-2">
          <h3 className="font-serif text-lg font-bold text-[#1b2350] leading-tight">{item.name}</h3>
          <span className="font-bold text-[#12207e] whitespace-nowrap">
            EGP {item.price}
            {item.unit === 'kg' && <span className="font-normal text-gray-400 text-sm"> / kg</span>}
          </span>
        </div>
        <p className="text-gray-500 text-sm leading-relaxed line-clamp-2 mb-4 flex-1">
          {item.description}
        </p>
        <div className="mt-auto">
          {item.status === 'sold_out' ? (
            <Button
              disabled
              className="w-full bg-gray-100 text-gray-400 border border-gray-200 rounded-xl h-11 text-sm"
            >
              Unavailable
            </Button>
          ) : item.unit === 'kg' ? (
            // Per-kg items (whole fish) are sold by weight — opening the picker
            // lets the guest choose a weight + cooking style before adding an
            // estimated line to the cart. Same footprint as Add-to-Cart.
            <Button
              onClick={() => onKiloAdd(item)}
              className="w-full bg-[#12207e] hover:bg-[#3c6e8f] text-white transition-all duration-300 shadow-md hover:shadow-[#3c6e8f]/25 h-11 rounded-xl text-sm font-semibold group-hover:-translate-y-0.5"
            >
              <Plus className="w-4 h-4 mr-2" /> Add to order
            </Button>
          ) : (
            <Button
              onClick={() => onAdd(item)}
              className="w-full bg-[#12207e] hover:bg-[#3c6e8f] text-white transition-all duration-300 shadow-md hover:shadow-[#3c6e8f]/25 h-11 rounded-xl text-sm font-semibold group-hover:-translate-y-0.5"
            >
              <Plus className="w-4 h-4 mr-2" /> Add to Cart
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Bordered, italic block echoing the print menu's Wood Fire Seafood footnotes.
function SectionNotes({ notes }: { notes: string[] }) {
  return (
    <div className="max-w-3xl mx-auto mt-10 border-l-2 border-[#12207e]/25 bg-[#f0e6d2]/50 rounded-r-lg px-5 py-4 space-y-2">
      {notes.map((note) => (
        <p key={note} className="text-sm italic text-[#12207e]/80 leading-relaxed">
          {note}
        </p>
      ))}
    </div>
  );
}

export function MenuPage() {
  const [activeSection, setActiveSection] = useState<Section>('Restaurant');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const { addItem } = useCart();
  const { menuItems, loading } = useMenuData();

  // Which per-kg item (if any) is being configured in the weight/style picker.
  const [kiloItem, setKiloItem] = useState<MenuItem | null>(null);

  const handleAdd = (item: MenuItem) =>
    addItem({ id: item.id, name: item.name, price: item.price, image: item.image });

  const handleKiloAdd = (item: MenuItem) => setKiloItem(item);

  // Only show section tabs that actually have items (empty sections like Kids disappear
  // automatically and reappear when items are added later).
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => menuItems.some((i) => i.section === s)),
    [menuItems]
  );

  // Items for the current section: use live data if it has section field, else fallback
  const sectionItems = useMemo(() => {
    const live = menuItems.filter((i) => i.section === activeSection);
    return live.length > 0 ? live : [];
  }, [menuItems, activeSection]);

  // Category display order: for the Restaurant section, follow the canonical
  // print order in RESTAURANT_SECTION_META (not first-appearance). Any present
  // category not in the meta list is appended so nothing is ever hidden. Other
  // sections (e.g. Kids) keep first-appearance ordering.
  const orderedCategories = useMemo(() => {
    const present = Array.from(new Set(sectionItems.map((i) => i.category)));
    if (activeSection === 'Restaurant') {
      const metaOrder = RESTAURANT_SECTION_META.map((m) => m.category).filter((c) =>
        present.includes(c)
      );
      const extras = present.filter((c) => !metaOrder.includes(c));
      return [...metaOrder, ...extras];
    }
    return present;
  }, [sectionItems, activeSection]);

  const categories = useMemo(() => ['All', ...orderedCategories], [orderedCategories]);

  // Lookup for a category's tagline/notes (Restaurant only).
  const metaFor = (category: string): SectionMeta | undefined =>
    activeSection === 'Restaurant'
      ? RESTAURANT_SECTION_META.find((m) => m.category === category)
      : undefined;

  // Reset category when section changes if current isn't valid
  React.useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory('All');
    }
  }, [categories, activeCategory]);

  const hasSearch = searchQuery.trim() !== '';

  const filteredItems = sectionItems.filter((item) => {
    const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const activeMeta = activeCategory !== 'All' ? metaFor(activeCategory) : undefined;

  const gridClass =
    'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 max-w-6xl mx-auto';

  return (
    <div className="min-h-screen bg-[#f6f2e8]">
      {/* ===== HERO HEADER ===== */}
      <section className="relative bg-[#1b2350] py-24 md:py-32 overflow-hidden">
        <img
          src="https://placehold.co/1920x600/1b2350/12207e?text=Our+Menu"
          alt="Our Menu"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1b2350]/50 to-[#1b2350]" />
        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-serif text-5xl md:text-7xl font-bold text-white mb-4"
          >
            Our Menu
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="font-serif italic text-[#f0e6d2] text-lg md:text-2xl tracking-wide"
          >
            — where the desert meets the sea —
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="text-[#f0e6d2]/70 text-sm md:text-base font-light tracking-wide mt-3"
          >
            Mediterranean | Ras El Hekma
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-[#f0e6d2]/50 text-xs md:text-sm tracking-wider uppercase mt-4"
          >
            All prices in Egyptian pounds (EGP)
          </motion.p>
        </div>
      </section>

      {/* ===== TABS ===== */}
      <div className="sticky top-16 z-30 bg-[#f6f2e8]/95 backdrop-blur-md border-b border-[#12207e]/10">
        <div className="container mx-auto px-4">
          <div className="flex justify-center gap-1 md:gap-2">
            {visibleSections.map((section) => (
              <button
                key={section}
                onClick={() => {
                  setActiveSection(section);
                  setActiveCategory('All');
                }}
                className="relative px-6 md:px-10 py-5 text-sm md:text-base font-semibold transition-colors duration-300"
              >
                <span className={activeSection === section ? 'text-[#12207e]' : 'text-gray-500 hover:text-[#12207e]'}>
                  {section}
                </span>
                {activeSection === section && (
                  <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-1 bg-[#12207e] rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ===== CONTENT ===== */}
      <div className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          {/* Search + Category pills */}
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between mb-10 max-w-5xl mx-auto">
            <div className="flex overflow-x-auto pb-2 gap-2 w-full lg:w-auto hide-scrollbar">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 whitespace-nowrap ${
                    activeCategory === category
                      ? 'bg-[#12207e] text-white shadow-md scale-105'
                      : 'bg-white text-gray-600 hover:bg-[#e6eef4] hover:text-[#12207e] border border-[#12207e]/10'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="relative w-full lg:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-full border border-[#12207e]/15 bg-white focus:outline-none focus:ring-2 focus:ring-[#12207e]/20 focus:border-[#12207e] text-sm"
              />
            </div>
          </div>

          {/* Menu content */}
          {loading ? (
            <div className={gridClass}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white rounded-2xl overflow-hidden shadow-sm animate-pulse">
                  <div className="h-48 bg-gray-200" />
                  <div className="p-6 space-y-3">
                    <div className="h-5 bg-gray-200 rounded w-2/3" />
                    <div className="h-4 bg-gray-200 rounded w-full" />
                    <div className="h-10 bg-gray-200 rounded-xl mt-4" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection + activeCategory + (hasSearch ? '-search' : '')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {hasSearch ? (
                  // --- SEARCH: flat filtered grid, no section headers ---
                  <div className={gridClass}>
                    {filteredItems.map((item, index) => (
                      <MenuCard key={item.id} item={item} index={index} onAdd={handleAdd} onKiloAdd={handleKiloAdd} />
                    ))}
                  </div>
                ) : activeCategory !== 'All' ? (
                  // --- SINGLE CATEGORY: tagline above, grid, optional notes below ---
                  <>
                    {activeMeta?.tagline && (
                      <p className="text-center font-serif italic text-xl md:text-2xl text-[#12207e]/70 mb-8">
                        {activeMeta.tagline}
                      </p>
                    )}
                    <div className={gridClass}>
                      {filteredItems.map((item, index) => (
                        <MenuCard key={item.id} item={item} index={index} onAdd={handleAdd} onKiloAdd={handleKiloAdd} />
                      ))}
                    </div>
                    {activeMeta?.notes && activeMeta.notes.length > 0 && (
                      <SectionNotes notes={activeMeta.notes} />
                    )}
                  </>
                ) : (
                  // --- ALL: grouped by category in canonical print order, each
                  //     group with a serif header + italic tagline; Wood Fire
                  //     Seafood group followed by its notes. Reads like the menu.
                  <div className="space-y-16 md:space-y-20">
                    {orderedCategories.map((category) => {
                      const meta = metaFor(category);
                      const items = sectionItems.filter((i) => i.category === category);
                      if (items.length === 0) return null;
                      return (
                        <section key={category}>
                          <div className="text-center mb-8">
                            <h2 className="font-serif text-3xl md:text-4xl font-bold text-[#1b2350]">
                              {category}
                            </h2>
                            {meta?.tagline && (
                              <p className="font-serif italic text-lg text-[#12207e]/70 mt-1">
                                {meta.tagline}
                              </p>
                            )}
                            <div className="w-16 h-1 bg-gradient-to-r from-[#12207e] to-[#3c6e8f] rounded-full mx-auto mt-4" />
                          </div>
                          <div className={gridClass}>
                            {items.map((item, index) => (
                              <MenuCard key={item.id} item={item} index={index} onAdd={handleAdd} onKiloAdd={handleKiloAdd} />
                            ))}
                          </div>
                          {meta?.notes && meta.notes.length > 0 && (
                            <SectionNotes notes={meta.notes} />
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Empty state */}
          {filteredItems.length === 0 && !loading && (
            <div className="text-center py-20 max-w-md mx-auto">
              <div className="w-16 h-16 bg-[#e6eef4] rounded-full flex items-center justify-center mx-auto mb-4 text-[#12207e]">
                <Search className="w-8 h-8" />
              </div>
              <h3 className="font-serif text-xl font-bold text-[#1b2350] mb-2">No items found</h3>
              <p className="text-gray-500 mb-4">Try adjusting your search or filter.</p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('All');
                }}
                className="border-2 border-[#12207e] text-[#12207e] hover:bg-[#12207e] hover:text-white rounded-full"
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Per-kg weight + cooking-style picker (whole fish / seafood) */}
      <KiloOrderModal
        open={kiloItem !== null}
        item={kiloItem}
        onClose={() => setKiloItem(null)}
        onConfirm={({ weightKg, cookingStyle, price }) => {
          if (!kiloItem) return;
          addItem({
            id: kiloCartId(kiloItem.id, weightKg, cookingStyle),
            name: kiloItem.name,
            price,
            image: '',
            unit: 'kg',
            weightKg,
            cookingStyle,
            pricePerKg: kiloItem.price,
          });
        }}
      />
    </div>
  );
}
