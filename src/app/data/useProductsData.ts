import { useState, useEffect } from 'react';
import { PRODUCTS, RetailProduct } from './productsData';

export function useProductsData() {
    const [products] = useState<RetailProduct[]>(PRODUCTS);
    const [loading] = useState(false);
    const [error] = useState<string | null>(null);

  useEffect(() => {
    // No external fetch — products data is local in productsData.ts
  }, []);

  const categories = ['All', ...Array.from(new Set(products.map(item => item.category)))];

  return { products, categories, loading, error };
}