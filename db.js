import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "bench.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS parts (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    specs TEXT NOT NULL
  )
`);

/* ---------------------------------------------------------
   LIVE DATA SOURCES

   CPU, motherboard, RAM, storage, PSU, and case all come from
   docyx/pc-part-dataset on GitHub -- a public dataset scraped
   from PCPartPicker (66k+ parts, real prices, MIT licensed).
   GPU comes from RightNow-AI/RightNow-GPU-Database (real specs,
   Apache-2.0), since that dataset has TDP + physical length,
   which the PCPartPicker dataset's GPU category doesn't include.

   Every fetch has a small hardcoded fallback for that ONE
   category, so if one dataset is down the rest of the catalog
   still loads instead of the whole seed failing.

   Two categories stay fully hand-curated: cooler (the dataset
   has no socket-compatibility field at all) and case sizing for
   GPU clearance (the dataset has no max-GPU-length field). Using
   the live data there would mean silently losing the compatibility
   checks that are the actual point of this app.
--------------------------------------------------------- */
const PCPP_BASE = "https://raw.githubusercontent.com/docyx/pc-part-dataset/main/data/json";

// Only real desktop microarchitectures we support a platform for.
// Anything else (Threadripper, Xeon, old chips, etc.) is excluded
// by name pattern below, not just by architecture.
const CPU_PLATFORM_BY_ARCH = {
  "Zen 5": { socket: "AM5", ramType: "DDR5" },
  "Zen 4": { socket: "AM5", ramType: "DDR5" },
  "Zen 3": { socket: "AM4", ramType: "DDR4" },
  "Zen 2": { socket: "AM4", ramType: "DDR4" },
  "Zen+": { socket: "AM4", ramType: "DDR4" },
  "Zen": { socket: "AM4", ramType: "DDR4" },
  "Raptor Lake Refresh": { socket: "LGA1700", ramType: "DDR5" },
  "Raptor Lake": { socket: "LGA1700", ramType: "DDR5" },
  "Alder Lake": { socket: "LGA1700", ramType: "DDR5" },
};

function isMainstreamCpuName(name) {
  return /^(AMD Ryzen [3579]|Intel Core i[3579])\b/.test(name) && !name.includes("Threadripper");
}

function cpuTierFromPrice(price) {
  if (price < 150) return "Budget";
  if (price < 300) return "Gaming";
  if (price < 450) return "High-end";
  return "Enthusiast";
}

const FORM_FACTOR_MAP = { "ATX": "ATX", "Micro ATX": "mATX", "Mini ITX": "ITX" };

function caseFormFactorSupport(typeStr) {
  if (!typeStr) return null;
  if (typeStr.includes("Mini ITX")) return ["ITX"];
  if (typeStr.includes("Micro ATX")) return ["mATX", "ITX"];
  if (typeStr.includes("ATX")) return ["ATX", "mATX", "ITX"];
  return null;
}

/** Dedupes by name (datasets have many near-identical color variants of the
 * same product) and picks an evenly-spaced spread across the price range,
 * instead of the cheapest N or a random N, so the catalog covers budget
 * through high-end rather than clustering at one end. */
function dedupeAndSpread(itemsByName, count) {
  const items = Object.values(itemsByName).sort((a, b) => a.price - b.price);
  if (items.length <= count) return items;
  const step = items.length / count;
  const sampled = [];
  for (let i = 0; i < count; i++) sampled.push(items[Math.floor(i * step)]);
  return sampled;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  return res.json();
}

async function fetchCpusFromApi() {
  const data = await fetchJson(`${PCPP_BASE}/cpu.json`);
  const byName = {};
  for (const c of data) {
    const plat = CPU_PLATFORM_BY_ARCH[c.microarchitecture];
    if (!plat || !c.price || !c.tdp) continue;
    if (!isMainstreamCpuName(c.name)) continue;
    if (c.price < 60 || c.price > 700) continue;
    byName[c.name] = {
      name: c.name,
      price: Math.round(c.price),
      specs: { socket: plat.socket, ramType: plat.ramType, tdp: c.tdp, tier: cpuTierFromPrice(c.price) },
    };
  }
  return dedupeAndSpread(byName, 24).map((p, i) => ({ id: `cpu-api-${i}`, category: "cpu", ...p }));
}

async function fetchMotherboardsFromApi() {
  const data = await fetchJson(`${PCPP_BASE}/motherboard.json`);
  const byName = {};
  for (const m of data) {
    if (!["AM5", "AM4", "LGA1700"].includes(m.socket)) continue;
    const formFactor = FORM_FACTOR_MAP[m.form_factor];
    if (!formFactor || !m.price) continue;
    if (m.price < 50 || m.price > 500) continue;
    const ramType = m.socket === "AM4" ? "DDR4" : "DDR5";
    byName[m.name] = { name: m.name, price: Math.round(m.price), specs: { socket: m.socket, ramType, formFactor } };
  }
  return dedupeAndSpread(byName, 24).map((p, i) => ({ id: `mobo-api-${i}`, category: "motherboard", ...p }));
}

async function fetchRamFromApi() {
  const data = await fetchJson(`${PCPP_BASE}/memory.json`);
  const byName = {};
  for (const r of data) {
    if (!r.speed || !r.modules || !r.price) continue;
    const gen = r.speed[0];
    if (gen !== 4 && gen !== 5) continue;
    const totalGB = r.modules[0] * r.modules[1];
    if (totalGB > 128 || r.price > 300) continue;
    byName[r.name] = { name: r.name, price: Math.round(r.price), specs: { type: `DDR${gen}`, capacity: `${totalGB}GB` } };
  }
  return dedupeAndSpread(byName, 20).map((p, i) => ({ id: `ram-api-${i}`, category: "ram", ...p }));
}

async function fetchStorageFromApi() {
  const data = await fetchJson(`${PCPP_BASE}/internal-hard-drive.json`);
  const byName = {};
  for (const s of data) {
    if (!s.capacity || !s.price) continue;
    if (s.capacity > 8000 || s.price > 500) continue;
    const capStr = s.capacity >= 1000 && s.capacity % 1000 === 0 ? `${s.capacity / 1000}TB` : `${s.capacity}GB`;
    const type = s.type === "SSD" ? "SSD" : "HDD";
    byName[s.name] = { name: s.name, price: Math.round(s.price), specs: { capacity: capStr, type } };
  }
  return dedupeAndSpread(byName, 18).map((p, i) => ({ id: `storage-api-${i}`, category: "storage", ...p }));
}

async function fetchPsuFromApi() {
  const data = await fetchJson(`${PCPP_BASE}/power-supply.json`);
  const byName = {};
  for (const p of data) {
    if (!p.wattage || !p.price) continue;
    if (p.price > 300 || p.wattage > 1200) continue;
    byName[p.name] = { name: p.name, price: Math.round(p.price), specs: { wattage: p.wattage, efficiency: p.efficiency } };
  }
  return dedupeAndSpread(byName, 16).map((p, i) => ({ id: `psu-api-${i}`, category: "psu", ...p }));
}

async function fetchCasesFromApi() {
  const data = await fetchJson(`${PCPP_BASE}/case.json`);
  const byName = {};
  for (const c of data) {
    const formFactorSupport = caseFormFactorSupport(c.type);
    if (!formFactorSupport || !c.price) continue;
    if (c.price > 300) continue;
    // No max-GPU-length field in this dataset -- omitted rather than guessed.
    // checkCompatibility() treats a missing maxGpuLengthMM as "unknown, assume it fits".
    byName[c.name] = { name: c.name, price: Math.round(c.price), specs: { formFactorSupport } };
  }
  return dedupeAndSpread(byName, 16).map((p, i) => ({ id: `case-api-${i}`, category: "case", ...p }));
}

/* ---------------------------------------------------------
   GPU: separate dataset (see comment above), unchanged from
   before -- real specs (TDP, length) merged with our own price
   estimates, since neither free dataset has both.
--------------------------------------------------------- */
const GPU_SOURCES = [
  "https://raw.githubusercontent.com/RightNow-AI/RightNow-GPU-Database/main/data/nvidia/all.json",
  "https://raw.githubusercontent.com/RightNow-AI/RightNow-GPU-Database/main/data/amd/all.json",
];

const GPU_PRICE_MAP = {
  "GeForce RTX 3050 8 GB": { price: 219, tier: "1080p" },
  "GeForce RTX 3060 12 GB": { price: 279, tier: "1080p" },
  "GeForce RTX 3060 Ti": { price: 329, tier: "1080p" },
  "GeForce RTX 3070": { price: 399, tier: "1440p" },
  "GeForce RTX 3080 12 GB": { price: 599, tier: "1440p" },
  "GeForce RTX 3090": { price: 799, tier: "4K" },
  "GeForce RTX 3090 Ti": { price: 899, tier: "4K" },
  "GeForce RTX 4060": { price: 299, tier: "1080p" },
  "GeForce RTX 4060 Ti 8 GB": { price: 399, tier: "1080p" },
  "GeForce RTX 4060 Ti 16 GB": { price: 449, tier: "1080p" },
  "GeForce RTX 4070": { price: 549, tier: "1440p" },
  "GeForce RTX 4070 SUPER": { price: 599, tier: "1440p" },
  "GeForce RTX 4070 Ti": { price: 749, tier: "1440p" },
  "GeForce RTX 4070 Ti SUPER": { price: 799, tier: "1440p" },
  "GeForce RTX 4080 SUPER": { price: 999, tier: "4K" },
  "GeForce RTX 4090": { price: 1599, tier: "4K" },
  "Radeon RX 6600": { price: 199, tier: "1080p" },
  "Radeon RX 6600 XT": { price: 259, tier: "1080p" },
  "Radeon RX 6700 XT": { price: 329, tier: "1440p" },
  "Radeon RX 6750 XT": { price: 379, tier: "1440p" },
  "Radeon RX 6800": { price: 429, tier: "1440p" },
  "Radeon RX 6800 XT": { price: 479, tier: "1440p" },
  "Radeon RX 6900 XT": { price: 549, tier: "1440p" },
  "Radeon RX 6950 XT": { price: 599, tier: "1440p" },
  "Radeon RX 7600": { price: 269, tier: "1080p" },
  "Radeon RX 7700 XT": { price: 419, tier: "1440p" },
  "Radeon RX 7800 XT": { price: 479, tier: "1440p" },
  "Radeon RX 7900 GRE": { price: 549, tier: "1440p" },
  "Radeon RX 7900 XT": { price: 699, tier: "4K" },
  "Radeon RX 7900 XTX": { price: 899, tier: "4K" },
};

async function fetchGpusFromApi() {
  const results = [];
  for (const url of GPU_SOURCES) results.push(...(await fetchJson(url)));

  const parts = [];
  let n = 1;
  for (const [name, pricing] of Object.entries(GPU_PRICE_MAP)) {
    const match = results.find((g) => g.name === name);
    if (!match || !match.tdp || !match.length) continue;
    parts.push({
      id: `gpu-api-${n++}`,
      category: "gpu",
      name,
      price: pricing.price,
      specs: { tdp: match.tdp, lengthMM: match.length, tier: pricing.tier },
    });
  }
  return parts;
}

/* ---------------------------------------------------------
   FALLBACKS
   Used only if a specific category's live fetch fails, so one
   dataset being unreachable doesn't take down the whole catalog.
--------------------------------------------------------- */
const FALLBACKS = {
  cpu: [
    { id: "cpu-fb1", category: "cpu", name: "AMD Ryzen 5 7600", price: 190, specs: { socket: "AM5", ramType: "DDR5", tdp: 65, tier: "Budget" } },
    { id: "cpu-fb2", category: "cpu", name: "Intel Core i5-14600K", price: 269, specs: { socket: "LGA1700", ramType: "DDR5", tdp: 125, tier: "Gaming" } },
    { id: "cpu-fb3", category: "cpu", name: "AMD Ryzen 7 5800X3D", price: 279, specs: { socket: "AM4", ramType: "DDR4", tdp: 105, tier: "Gaming" } },
  ],
  motherboard: [
    { id: "mobo-fb1", category: "motherboard", name: "MSI PRO B650-P WiFi", price: 149, specs: { socket: "AM5", ramType: "DDR5", formFactor: "ATX" } },
    { id: "mobo-fb2", category: "motherboard", name: "MSI PRO B760M-A WiFi", price: 139, specs: { socket: "LGA1700", ramType: "DDR5", formFactor: "mATX" } },
    { id: "mobo-fb3", category: "motherboard", name: "ASRock B550M Pro4", price: 99, specs: { socket: "AM4", ramType: "DDR4", formFactor: "mATX" } },
  ],
  ram: [
    { id: "ram-fb1", category: "ram", name: "Corsair Vengeance 32GB DDR5-6000", price: 89, specs: { type: "DDR5", capacity: "32GB" } },
    { id: "ram-fb2", category: "ram", name: "Corsair Vengeance LPX 16GB DDR4-3200", price: 42, specs: { type: "DDR4", capacity: "16GB" } },
  ],
  storage: [
    { id: "storage-fb1", category: "storage", name: "WD Black SN770 1TB NVMe SSD", price: 69, specs: { capacity: "1TB", type: "SSD" } },
    { id: "storage-fb2", category: "storage", name: "Seagate BarraCuda 2TB HDD", price: 54, specs: { capacity: "2TB", type: "HDD" } },
  ],
  psu: [
    { id: "psu-fb1", category: "psu", name: "Corsair RM650e 650W 80+ Gold", price: 89, specs: { wattage: 650, efficiency: "gold" } },
    { id: "psu-fb2", category: "psu", name: "Corsair RM1000e 1000W 80+ Gold", price: 159, specs: { wattage: 1000, efficiency: "gold" } },
  ],
  case: [
    { id: "case-fb1", category: "case", name: "NZXT H5 Flow", price: 89, specs: { formFactorSupport: ["ATX", "mATX", "ITX"] } },
    { id: "case-fb2", category: "case", name: "Cooler Master MasterBox NR200", price: 99, specs: { formFactorSupport: ["ITX"] } },
  ],
  gpu: [
    { id: "gpu-fb1", category: "gpu", name: "GeForce RTX 4060", price: 299, specs: { tdp: 115, lengthMM: 240, tier: "1080p" } },
    { id: "gpu-fb2", category: "gpu", name: "GeForce RTX 4070 SUPER", price: 599, specs: { tdp: 220, lengthMM: 267, tier: "1440p" } },
    { id: "gpu-fb3", category: "gpu", name: "Radeon RX 7800 XT", price: 479, specs: { tdp: 263, lengthMM: 267, tier: "1440p" } },
  ],
};

/* ---------------------------------------------------------
   COOLERS
   Fully hand-curated, on purpose: neither public dataset has a
   socket-compatibility field for coolers, and that check is the
   whole point of this category existing in the compatibility
   engine. Using live data here would mean silently dropping
   that check rather than gaining anything real.
--------------------------------------------------------- */
const STARTER_COOLERS = [
  { id: "co1", category: "cooler", name: "Cooler Master Hyper H410R", price: 24, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co2", category: "cooler", name: "Thermalright Peerless Assassin 120 SE", price: 35, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co3", category: "cooler", name: "Cooler Master Hyper 212 Halo", price: 45, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co4", category: "cooler", name: "Noctua NH-U12S Redux", price: 55, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co5", category: "cooler", name: "be quiet! Dark Rock 4", price: 74, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co6", category: "cooler", name: "Noctua NH-D15", price: 109, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co7", category: "cooler", name: "Corsair iCUE H100i 240mm AIO", price: 129, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co8", category: "cooler", name: "NZXT Kraken 280mm AIO", price: 169, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co9", category: "cooler", name: "Corsair iCUE H150i 360mm AIO", price: 199, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "co10", category: "cooler", name: "Lian Li Galahad II 360mm AIO", price: 159, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
];

async function fetchWithFallback(name, fetchFn) {
  try {
    const parts = await fetchFn();
    if (parts.length === 0) throw new Error("Fetch succeeded but returned zero usable parts");
    console.log(`  ${name}: ${parts.length} live from public dataset`);
    return parts;
  } catch (err) {
    console.warn(`  ${name}: live fetch failed (${err.message}), using fallback list`);
    return FALLBACKS[name];
  }
}

async function seedIfEmpty() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM parts").get();
  if (count > 0) return;

  console.log("Seeding catalog from live public datasets...");
  const [cpuParts, mobos, ram, storage, psu, cases, gpus] = await Promise.all([
    fetchWithFallback("cpu", fetchCpusFromApi),
    fetchWithFallback("motherboard", fetchMotherboardsFromApi),
    fetchWithFallback("ram", fetchRamFromApi),
    fetchWithFallback("storage", fetchStorageFromApi),
    fetchWithFallback("psu", fetchPsuFromApi),
    fetchWithFallback("case", fetchCasesFromApi),
    fetchWithFallback("gpu", fetchGpusFromApi),
  ]);

  const allParts = [...cpuParts, ...mobos, ...ram, ...storage, ...psu, ...cases, ...gpus, ...STARTER_COOLERS];
  const insert = db.prepare("INSERT INTO parts (id, category, name, price, specs) VALUES (@id, @category, @name, @price, @specs)");
  const insertMany = db.transaction((parts) => {
    for (const part of parts) insert.run({ ...part, specs: JSON.stringify(part.specs) });
  });
  insertMany(allParts);
  console.log(`Seeded ${allParts.length} parts into bench.db`);
}
await seedIfEmpty();

export function getAllPartsGrouped() {
  const rows = db.prepare("SELECT * FROM parts").all();
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push({
      id: row.id,
      name: row.name,
      price: row.price,
      ...JSON.parse(row.specs),
    });
  }
  return grouped;
}

export function addPart({ id, category, name, price, specs }) {
  db.prepare("INSERT INTO parts (id, category, name, price, specs) VALUES (?, ?, ?, ?, ?)")
    .run(id, category, name, price, JSON.stringify(specs || {}));
}

export function deletePart(id) {
  const result = db.prepare("DELETE FROM parts WHERE id = ?").run(id);
  return result.changes > 0;
}

export default db;