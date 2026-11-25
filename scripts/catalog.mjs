// Builds site/catalog.json: every product and collection on amotherspassion.ca
// (Shopify public JSON endpoints), compacted for ad generation.
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "https://amotherspassion.ca";
const UA = { "user-agent": "Mozilla/5.0 (compatible; catalog-snapshot)" };
const get = async (path) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(BASE + path, { headers: UA });
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  throw new Error(`fetch failed ${path}`);
};
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function pages(path) {
  const out = [];
  for (let p = 1; p < 40; p++) {
    const j = await get(`${path}${path.includes("?") ? "&" : "?"}limit=250&page=${p}`);
    if (!j.products?.length) break;
    out.push(...j.products);
    if (j.products.length < 250) break;
  }
  return out;
}

const raw = await pages("/products.json");
const products = raw
  .filter((p) => p.images?.length && p.variants?.some((v) => v.available !== false))
  .map((p) => {
    const v = p.variants.find((x) => x.available !== false) || p.variants[0];
    return {
      handle: p.handle,
      title: p.title,
      type: p.product_type,
      vendor: p.vendor,
      tags: p.tags,
      price: v.price,
      compare_at: v.compare_at_price && Number(v.compare_at_price) > Number(v.price) ? v.compare_at_price : null,
      image: p.images[0].src,
      images: p.images.slice(0, 4).map((i) => i.src),
      blurb: strip(p.body_html).slice(0, 400),
      collections: [],
    };
  });
const byHandle = Object.fromEntries(products.map((p) => [p.handle, p]));

const cols = (await get("/collections.json?limit=250")).collections;
const collections = [];
for (const c of cols) {
  const items = await pages(`/collections/${c.handle}/products.json`);
  const handles = items.map((p) => p.handle).filter((h) => byHandle[h]);
  handles.forEach((h) => byHandle[h].collections.push(c.handle));
  collections.push({
    handle: c.handle,
    title: String(c.title || c.handle).replace(/\s+/g, " ").trim(),
    image: c.image?.src || null,
    description: strip(c.description).slice(0, 300),
    count: handles.length,
    sample: handles.slice(0, 12),
  });
}

mkdirSync("site", { recursive: true });
writeFileSync("site/catalog.json", JSON.stringify({ fetched: new Date().toISOString(), collections, products }, null, 1));
console.log(`products: ${raw.length} total, ${products.length} in stock with images; collections: ${collections.length}`);
for (const c of collections) console.log(`  ${c.handle}: ${c.count}`);
