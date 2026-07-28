import React, { createContext, useContext, useState, ReactNode } from 'react';

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  dir: 'ltr' | 'rtl';
}

const translations: Record<string, Record<Language, string>> = {
  'home': { en: 'Home', ar: 'الرئيسية' },
  'menu': { en: 'Menu', ar: 'القائمة' },
  'catering': { en: 'Catering', ar: 'تجهيز الحفلات' },
  'contact': { en: 'Contact', ar: 'اتصل بنا' },
  'cart': { en: 'Cart', ar: 'السلة' },
  'track_order': { en: 'Track Order', ar: 'تتبع الطلب' },
  'hero_title': { en: 'Fresh. Natural. Delivered Daily.', ar: 'طازج. طبيعي. يوصل يومياً.' },
  'hero_subtitle': { en: '100% natural ingredients, open kitchen quality.', ar: 'مكونات طبيعية ١٠٠٪، جودة المطبخ المفتوح.' },
  'order_now': { en: 'Order Now', ar: 'اطلب الآن' },
  'view_menu': { en: 'View Menu', ar: 'عرض القائمة' },
  'featured_items': { en: 'Featured Items', ar: 'أصناف مميزة' },
  'add_to_cart': { en: 'Add to Cart', ar: 'أضف إلى السلة' },
  'total': { en: 'Total', ar: 'المجموع' },
  'checkout_whatsapp': { en: 'Checkout via WhatsApp', ar: 'إتمام الطلب عبر واتساب' },
  'dietary_vegan': { en: 'Vegan', ar: 'نباتي' },
  'dietary_gf': { en: 'Gluten Free', ar: 'خالي من الغلوتين' },
  'dietary_spicy': { en: 'Spicy', ar: 'حار' },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('en');

  const t = (key: string) => {
    return translations[key]?.[language] || key;
  };

  const dir = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, dir }}>
      <div dir={dir} className={language === 'ar' ? 'font-sans' : 'font-sans'}>
        {children}
      </div>
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
  return context;
};
