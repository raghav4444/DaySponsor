export type ProductAccess = 'physical' | 'digital';

export type ProductDraft = {
  id: string;
  name: string;
  website: string;
  category: string;
  access: ProductAccess;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

const productStorageKey = 'daysponsor-product-catalog-v1';
const selectionStorageKey = 'daysponsor-campaign-product-selections-v1';

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readProductCatalog() {
  return readJson<ProductDraft[]>(productStorageKey, []);
}

export function saveProductCatalog(products: ProductDraft[]) {
  writeJson(productStorageKey, products);
}

export function upsertProduct(product: Omit<ProductDraft, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<ProductDraft, 'id'>>) {
  const catalog = readProductCatalog();
  const now = new Date().toISOString();
  const id = product.id || globalThis.crypto?.randomUUID?.() || `product-${Date.now()}`;
  const next: ProductDraft = {
    ...product,
    id,
    createdAt: catalog.find((item) => item.id === id)?.createdAt || now,
    updatedAt: now,
  };
  const updated = product.id
    ? catalog.map((item) => (item.id === product.id ? next : item))
    : [...catalog, next];
  saveProductCatalog(updated);
  return next;
}

export function deleteProduct(productId: string) {
  const catalog = readProductCatalog().filter((product) => product.id !== productId);
  saveProductCatalog(catalog);
  const selections = readCampaignProductSelections();
  const updatedSelections = Object.fromEntries(
    Object.entries(selections).filter(([, selectedProductId]) => selectedProductId !== productId),
  );
  writeJson(selectionStorageKey, updatedSelections);
}

export function readCampaignProductSelections() {
  return readJson<Record<string, string>>(selectionStorageKey, {});
}

export function readSelectedProductId(campaignId: string) {
  return readCampaignProductSelections()[campaignId] || null;
}

export function saveSelectedProductId(campaignId: string, productId: string | null) {
  const selections = readCampaignProductSelections();
  if (productId) {
    selections[campaignId] = productId;
  } else {
    delete selections[campaignId];
  }
  writeJson(selectionStorageKey, selections);
}

export function getProductAccessLabel(access: ProductAccess) {
  return access === 'digital' ? 'Digital access' : 'Physical product';
}
