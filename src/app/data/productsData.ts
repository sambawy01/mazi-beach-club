import wagyuImage from '@/assets/8c595f77b0f6c6a4e120f0ff7933588169362821.png';
import truffleTallowImage from '@/assets/160215f3ea9218f7a75c4b731c311da2201d5e42.png';
import garlicTallowImage from '@/assets/0e7adf1a8302b61a90b4137cc09ce905117461d4.png';
import smokedTallowImage from '@/assets/a8c41eee83ebf2ec311e73401c5c88657d0797ba.png';
import boneBrothImage from '@/assets/1494aeef704c5481b3858e6294f84ac9d6829a9d.png';

/**
 * A retail good sold from the Mazi Pantry shelf (tallow, broth) — NOT a menu
 * item. It deliberately does not reuse `MenuItem`: that type requires a
 * `section` ('Restaurant' | 'Beach Bar' | 'Bar' | 'Kids'), and none of those
 * apply to a jar of tallow. Making `section` optional on `MenuItem` would
 * weaken every genuine menu consumer just to fit a non-menu entity, so the
 * pantry gets its own shape instead.
 *
 * Structurally satisfies `Omit<CartItem, 'quantity'>` (id/name/price/image), so
 * these can be handed straight to CartContext's `addItem`.
 */
export interface RetailProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  /** Free-form; the pantry filter list is derived from these at runtime. */
  category: string;
  image: string;
  dietary?: string[];
  /** 'sold_out' is unused by current stock but is a real state the UI renders. */
  status?: 'available' | 'limited' | 'sold_out';
}

export const PRODUCTS: RetailProduct[] = [
  {
    id: 'p1',
    name: 'Wagyu Beef Tallow - Original',
    description: '310ml of pure, rendered Wagyu fat. The secret to restaurant-quality searing and roasting.',
    price: 350,
    category: 'Tallow',
    image: wagyuImage,
    dietary: ['Keto', 'Carnivore', 'GF'],
    status: 'available'
  },
  {
    id: 'p2',
    name: 'Wagyu Beef Tallow - Garlic & Herbs',
    description: '310ml infused with roasted garlic, rosemary, and thyme. Perfect for steaks and potatoes.',
    price: 375,
    category: 'Tallow',
    image: garlicTallowImage,
    dietary: ['Keto', 'Carnivore', 'GF'],
    status: 'available'
  },
  {
    id: 'p3',
    name: 'Wagyu Beef Tallow - Black Truffle',
    description: '310ml of luxury. Infused with black truffle essence for an earthy, aromatic finish.',
    price: 450,
    category: 'Tallow',
    image: truffleTallowImage,
    dietary: ['Keto', 'Carnivore', 'GF'],
    status: 'limited'
  },
  {
    id: 'p4',
    name: 'Wagyu Beef Tallow - Smoked',
    description: '310ml cold-smoked over hickory wood. Adds a deep, barbecue flavor to any dish.',
    price: 375,
    category: 'Tallow',
    image: smokedTallowImage,
    dietary: ['Keto', 'Carnivore', 'GF'],
    status: 'available'
  },
  {
    id: 'p5',
    name: 'Bone Broth Concentrate',
    description: '310ml of 48-hour slow-simmered beef bone broth. Rich in collagen and minerals.',
    price: 280,
    category: 'Broth',
    image: boneBrothImage,
    dietary: ['High Protein', 'Keto', 'GF'],
    status: 'available'
  }
];
