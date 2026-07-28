import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Scale } from 'lucide-react';
import { KILO_WEIGHT_OPTIONS, COOKING_STYLES } from '../data/menuData';

// ── Composite cart id ───────────────────────────────────────────────────────
// Both ordering surfaces build the per-kg line id through this helper so
// identical weight+style combos STACK (same id → quantity++) while different
// combos become separate lines. The existing by-id cart handlers
// (add/remove/updateQuantity) then work unchanged.
export const kiloCartId = (menuId: string, weightKg: number, cookingStyle: string) =>
  `${menuId}::${weightKg}::${cookingStyle.toLowerCase().replace(/[^a-z]+/g, '-')}`;

export interface KiloOrderItem {
  id: string;
  name: string;
  price: number; // per-kg rate
}

export interface KiloOrderConfirm {
  weightKg: number;
  cookingStyle: string;
  price: number; // estimated line unit price = round(rate × weight)
}

interface KiloOrderModalProps {
  open: boolean;
  onClose: () => void;
  item: KiloOrderItem | null;
  onConfirm: (data: KiloOrderConfirm) => void;
}

export function KiloOrderModal({ open, onClose, item, onConfirm }: KiloOrderModalProps) {
  const [weightKg, setWeightKg] = React.useState<number>(1);
  const [cookingStyle, setCookingStyle] = React.useState<string>('');

  // ── a11y refs ──────────────────────────────────────────────────────────────
  // dialogRef scopes the focus trap; closeButtonRef receives initial focus;
  // previouslyFocusedRef remembers what to restore focus to on close.
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  // Keep the latest onClose without re-running the focus effect on every parent
  // render (a fresh onClose identity would otherwise thrash focus while open).
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Reset selections each time the modal opens for a (possibly different) item.
  React.useEffect(() => {
    if (open) {
      setWeightKg(1);
      setCookingStyle('');
    }
  }, [open, item?.id]);

  // Escape-to-close, initial focus, focus restore, and a dependency-free focus
  // trap — all wired only while the dialog is open.
  React.useEffect(() => {
    if (!open) return;

    // Remember the element focused before opening so we can restore it on close.
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    // Move focus into the dialog once it has mounted.
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const getFocusable = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const insideDialog = !!active && !!dialogRef.current?.contains(active);

      if (e.shiftKey) {
        // Shift+Tab from the first element (or from outside) wraps to the last.
        if (active === first || !insideDialog) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab from the last element (or from outside) wraps to the first.
        if (active === last || !insideDialog) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus so it is never left lost on the detached dialog.
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus();
      } else if (typeof document.body?.focus === 'function') {
        document.body.focus();
      }
    };
  }, [open]);

  const rate = item?.price ?? 0;
  const estimate = Math.round(rate * weightKg);

  const handleConfirm = () => {
    if (!item || !cookingStyle) return;
    onConfirm({ weightKg, cookingStyle, price: estimate });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && item && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-[70] backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Order ${item.name} by weight`}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              ref={dialogRef}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto pointer-events-auto"
            >
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b bg-[#12207e] rounded-t-2xl">
                <div className="min-w-0 pr-2">
                  <h2 className="font-serif font-bold text-lg text-white leading-tight flex items-center gap-2">
                    <Scale className="w-5 h-5 text-[#3c6e8f] shrink-0" />
                    {item.name}
                  </h2>
                  <p className="text-[#f0e6d2]/80 text-sm mt-1">EGP {rate} / kg</p>
                </div>
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  aria-label="Close"
                  className="p-2 hover:bg-white/10 rounded-full text-white shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-6">
                {/* Weight chips */}
                <div>
                  <h3 className="font-serif font-bold text-gray-800 text-sm mb-3">
                    Choose weight
                  </h3>
                  <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Weight">
                    {KILO_WEIGHT_OPTIONS.map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWeightKg(w)}
                        role="radio"
                        aria-checked={weightKg === w}
                        aria-pressed={weightKg === w}
                        className={`py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                          weightKg === w
                            ? 'border-[#12207e] bg-[#12207e] text-white shadow-md'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-[#12207e]/40'
                        }`}
                      >
                        {w} kg
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cooking style */}
                <div>
                  <h3 className="font-serif font-bold text-gray-800 text-sm mb-3">
                    Cooking style <span className="text-[#12207e]">*</span>
                  </h3>
                  <div className="space-y-2" role="radiogroup" aria-label="Cooking style">
                    {COOKING_STYLES.map((style) => {
                      const selected = cookingStyle === style;
                      return (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setCookingStyle(style)}
                          role="radio"
                          aria-checked={selected}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                            selected
                              ? 'border-[#12207e] bg-[#12207e]/5'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              selected ? 'border-[#12207e] bg-[#12207e]' : 'border-gray-300'
                            }`}
                          >
                            {selected && <div className="w-2 h-2 bg-white rounded-full" />}
                          </div>
                          <span
                            className={`text-sm font-medium ${
                              selected ? 'text-[#12207e]' : 'text-gray-700'
                            }`}
                          >
                            {style}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Estimated price */}
                <div className="bg-[#f0e6d2]/50 border border-[#12207e]/15 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-serif font-bold text-gray-800 text-sm">
                      Estimated price
                    </span>
                    <span className="font-montserrat font-bold text-2xl text-[#12207e]">
                      EGP {estimate}
                    </span>
                  </div>
                  <p className="text-xs italic text-[#12207e]/70 mt-1.5 leading-relaxed">
                    Estimated for {weightKg} kg — final price is set by the actual weighed catch.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="p-5 border-t bg-[#f6f2e8] rounded-b-2xl flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!cookingStyle}
                  className="flex-1 py-3 rounded-xl bg-[#12207e] text-white font-bold text-sm disabled:opacity-50 hover:bg-[#3c6e8f] transition-colors flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" /> Add · EGP {estimate}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
