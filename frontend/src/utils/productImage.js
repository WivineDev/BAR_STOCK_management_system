// Product imagery resolver. Every catalogue product can carry its own photo
// (a Fanta shows Fanta, water shows water); products without one fall back
// to their category's default photo, then to an icon glyph in the caller.
const CATEGORY_IMAGES = {
  beer: 'beer.jpg', beers: 'beer.jpg', lager: 'beer.jpg',
  wine: 'wine.jpg', wines: 'wine.jpg',
  spirit: 'spirit.jpg', spirits: 'spirit.jpg', liquor: 'spirit.jpg', whisky: 'spirit.jpg', whiskey: 'spirit.jpg',
  soda: 'soda.jpg', sodas: 'soda.jpg', 'soft drink': 'soda.jpg', 'soft drinks': 'soda.jpg',
  water: 'water.jpg', waters: 'water.jpg',
  juice: 'juice.jpg', juices: 'juice.jpg',
  energy: 'energy.jpg', 'energy drink': 'energy.jpg', 'energy drinks': 'energy.jpg',
  coffee: 'coffee.jpg', coffees: 'coffee.jpg', tea: 'coffee.jpg', teas: 'coffee.jpg',
};

export function productImage(product) {
  const direct = product?.imagePath;
  if (direct) return `/images/products/${direct}`;
  const category = (product?.categoryName || '').trim().toLowerCase();
  const fallback = CATEGORY_IMAGES[category];
  return fallback ? `/images/products/${fallback}` : null;
}

// The curated photo set shipped in frontend/public/images/products/ —
// mirrored by the backend whitelist in src/routes/business.js.
export const PRODUCT_IMAGE_CHOICES = [
  { key: 'beer.jpg', label: 'Beer' },
  { key: 'wine.jpg', label: 'Wine' },
  { key: 'spirit.jpg', label: 'Spirit' },
  { key: 'fanta.jpg', label: 'Fanta' },
  { key: 'cola.jpg', label: 'Cola' },
  { key: 'soda.jpg', label: 'Soda' },
  { key: 'water.jpg', label: 'Water' },
  { key: 'juice.jpg', label: 'Juice' },
  { key: 'energy.jpg', label: 'Energy' },
  { key: 'coffee.jpg', label: 'Coffee' },
];
