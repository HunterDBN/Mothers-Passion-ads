// Generates new-style ad images from the live amotherspassion.ca catalog.
//   node scripts/generate.mjs ensure [N]   make sure N unposted ads are ready (default 24)
//   node scripts/generate.mjs sample [N]   render N ads into ads/samples/ without touching state
// Rotation: products round-robin across every category (each product once before
// repeating), with a category ad every 4th post. Every image carries the logo and
// amotherspassion.ca. Rendering uses Playwright + templates/ad.html.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const P = (p) => path.join(ROOT, p);
const readJson = (p, d) => (fs.existsSync(P(p)) ? JSON.parse(fs.readFileSync(P(p), "utf8")) : d);
const writeJson = (p, v) => fs.writeFileSync(P(p), JSON.stringify(v, null, 2) + "\n");
const LOCAL = process.env.PREVIEW_LOCAL === "1";

function loadCatalog() {
  const c = readJson("site/catalog.json", null);
  const age = c ? Date.now() - Date.parse(c.fetched) : Infinity;
  if (!LOCAL && age > 20 * 3600 * 1000) {
    console.log("Refreshing site catalog...");
    execFileSync("node", [P("scripts/catalog.mjs")], { stdio: "inherit", cwd: ROOT });
    return readJson("site/catalog.json");
  }
  return c;
}

const money = (v) => `$${Number(v).toFixed(2)}`;
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const sized = (src, w = 1200) => src + (src.includes("?") ? "&" : "?") + `width=${w}`;

function shortTitle(t) {
  const parts = t.replace(/\s+/g, " ").split(/\s[–—|-]\s|\||:|\(|,/).map((s) => s.trim()).filter(Boolean);
  let out = parts[0] || t;
  for (let i = 1; out.length < 14 && i < parts.length; i++) out += " " + parts[i];
  if (out.length > 48) out = out.slice(0, 48).replace(/\s+\S*$/, "");
  return out.replace(/\b([A-Z]{4,})\b/g, (w) => w[0] + w.slice(1).toLowerCase());
}

function plan(n, catalog, copy, st) {
  const cols = catalog.collections.filter((c) => c.count > 0);
  const catCols = cols.filter((c) => c.count >= 4);
  const byCol = Object.fromEntries(cols.map((c) => [c.handle, catalog.products.filter((p) => p.collections.includes(c.handle))]));
  const allHandles = new Set(catalog.products.map((p) => p.handle));
  st.used = (st.used || []).filter((h) => allHandles.has(h));
  const used = new Set(st.used);
  const out = [];
  for (let k = 0; k < n; k++) {
    const idx = st.count++;
    if (idx % 4 === 2 && catCols.length) {
      const c = catCols[st.cat_i++ % catCols.length];
      const cc = copy.collections[c.handle] || copy.default;
      const picks = byCol[c.handle];
      const off = (st.cat_round = (st.cat_round || 0) + 1) * 4;
      const four = [0, 1, 2, 3].map((i) => picks[(off + i) % picks.length]);
      out.push({
        id: `g${String(idx).padStart(4, "0")}-cat-${slug(c.handle)}`,
        template: "cat", theme: cc.theme === "blush" ? "blush" : "",
        eyebrow: cc.eyebrow, headline: cc.headline, sub: cc.sub, shop: `Shop ${c.title} →`,
        images: four.map((p) => p.image),
        caption: `${cc.headline} 💗\n\n${cc.sub}\n\nShop ${c.title} at amotherspassion.ca/collections/${c.handle}`,
        tags: cc.tags, kind: "category", ref: c.handle,
      });
      continue;
    }
    let product = null;
    let col = null;
    for (let tries = 0; tries < cols.length && !product; tries++) {
      col = cols[st.col_i++ % cols.length];
      product = byCol[col.handle].find((p) => !used.has(p.handle));
    }
    if (!product) {
      // every product has had a turn: start a new lap
      used.clear();
      st.used = [];
      col = cols[st.col_i++ % cols.length];
      product = byCol[col.handle][0];
    }
    used.add(product.handle);
    st.used.push(product.handle);
    const cc = copy.collections[col.handle] || copy.default;
    const name = shortTitle(product.title);
    const sale = product.compare_at && Number(product.compare_at) > Number(product.price);
    st.prod_n = (st.prod_n || 0) + 1;
    const template = sale ? "sale" : st.prod_n % 2 ? "arch" : "frame";
    const pct = sale ? Math.round((1 - product.price / product.compare_at) * 100) : 0;
    const quote = cc.quotes[Math.floor(st.prod_n / 2) % cc.quotes.length];
    out.push({
      id: `g${String(idx).padStart(4, "0")}-${slug(product.handle)}`,
      template, theme: template === "sale" ? "" : cc.theme === "sage" ? "sage" : "",
      eyebrow: cc.eyebrow, headline: name, quote,
      price: `${money(product.price)} CAD`, was: sale ? money(product.compare_at) : "",
      price_num: money(product.price), was_line: sale ? `WAS ${money(product.compare_at)} CAD` : "",
      save: pct >= 5 ? `SAVE ${pct}%` : "SALE",
      images: product.images.slice(0, 1),
      caption: `${name} ✨\n\n${cc.line}\n\n${sale ? `On sale: ${money(product.price)} CAD (was ${money(product.compare_at)} CAD)` : `${money(product.price)} CAD`}\n\nShop now at amotherspassion.ca/products/${product.handle}`,
      tags: cc.tags, kind: "product", ref: product.handle,
    });
  }
  return out;
}

async function render(items, outDir) {
  const { chromium } = require("playwright");
  fs.mkdirSync(P(outDir), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const placeholders = LOCAL
    ? fs.readdirSync(P("ads/images")).filter((f) => f.endsWith(".jpg")).map((f) => pathToFileURL(P("ads/images/" + f)).href)
    : [];
  const done = [];
  for (const [i, it] of items.entries()) {
    await page.goto(pathToFileURL(P("templates/ad.html")).href);
    const images = LOCAL ? it.images.map((_, j) => placeholders[(i + j) % placeholders.length]) : it.images.map((s) => sized(s));
    const logo = pathToFileURL(P("assets/logo.png")).href;
    await page.evaluate((d) => window.render(d), { ...it, images, logo });
    const broken = await page.evaluate(
      () => [...document.querySelectorAll(".ad img")].filter((im) => im.offsetParent && !im.naturalWidth).length,
    );
    if (broken) {
      console.log(`skip ${it.id}: ${broken} image(s) failed to load`);
      continue;
    }
    const file = `${outDir}/${it.id}.jpg`;
    await page.screenshot({ path: P(file), type: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    console.log(`rendered ${file}`);
    done.push({ ...it, file });
  }
  await browser.close();
  return done;
}

const [cmd = "ensure", nArg] = process.argv.slice(2);
const catalog = loadCatalog();
const copy = readJson("ads/copy.json");

if (cmd === "sample") {
  const st = { count: 0, col_i: 0, cat_i: 0, used: [] };
  const items = plan(Number(nArg || 8), catalog, copy, st);
  await render(items, "ads/samples");
} else if (cmd === "ensure") {
  const want = Number(nArg || 24);
  const gen = readJson("ads/generated.json", { ads: [] });
  const next = readJson("ads/state.json", {}).gen_next || 0;
  const st = readJson("ads/gen-state.json", { count: 0, col_i: 0, cat_i: 0, used: [] });
  let need = want - (gen.ads.length - next);
  for (let round = 0; need > 0 && round < 5; round++) {
    const ok = await render(plan(need, catalog, copy, st), "ads/gen");
    for (const it of ok) {
      gen.ads.push({ id: it.id, image: `gen/${it.id}.jpg`, caption: it.caption, tags: it.tags, kind: it.kind, ref: it.ref, template: it.template });
    }
    need = want - (gen.ads.length - next);
  }
  // Images for ads posted more than ~60 posts ago are no longer needed by Buffer.
  for (const a of gen.ads.slice(0, Math.max(0, next - 60))) {
    const f = P("ads/" + a.image);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  writeJson("ads/generated.json", gen);
  writeJson("ads/gen-state.json", st);
  console.log(`Generated ads ready: ${gen.ads.length - next} unposted (of ${gen.ads.length} total).`);
}
