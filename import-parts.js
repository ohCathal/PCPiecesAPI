const API_URL = "http://localhost:3001/api/parts";

const PARTS = [
  // ---- CPUs ----
  { id: "manual-cpu-1", category: "cpu", name: "AMD Ryzen 5 9600X", price: 229, specs: { socket: "AM5", ramType: "DDR5", tdp: 65, tier: "Gaming" } },
  { id: "manual-cpu-2", category: "cpu", name: "AMD Ryzen 7 9700X", price: 329, specs: { socket: "AM5", ramType: "DDR5", tdp: 65, tier: "High-end" } },
  { id: "manual-cpu-3", category: "cpu", name: "Intel Core i5-14400F", price: 179, specs: { socket: "LGA1700", ramType: "DDR5", tdp: 65, tier: "Budget" } },

  // ---- Motherboards ----
  { id: "manual-mobo-1", category: "motherboard", name: "MSI PRO B650M-A WiFi", price: 129, specs: { socket: "AM5", ramType: "DDR5", formFactor: "mATX" } },
  { id: "manual-mobo-2", category: "motherboard", name: "Gigabyte B760 DS3H", price: 119, specs: { socket: "LGA1700", ramType: "DDR5", formFactor: "ATX" } },
  { id: "manual-mobo-3", category: "motherboard", name: "ASRock B450M Steel Legend", price: 79, specs: { socket: "AM4", ramType: "DDR4", formFactor: "mATX" } },

  // ---- RAM ----
  { id: "manual-ram-1", category: "ram", name: "Corsair Vengeance 16GB DDR5-5600", price: 54, specs: { type: "DDR5", capacity: "16GB" } },
  { id: "manual-ram-2", category: "ram", name: "TeamGroup T-Force 32GB DDR4-3200", price: 64, specs: { type: "DDR4", capacity: "32GB" } },

  // ---- GPUs ----
  { id: "manual-gpu-1", category: "gpu", name: "PNY GeForce RTX 4060 Verto", price: 289, specs: { tdp: 115, lengthMM: 220, tier: "1080p" } },
  { id: "manual-gpu-2", category: "gpu", name: "XFX Speedster RX 7600", price: 259, specs: { tdp: 165, lengthMM: 220, tier: "1080p" } },

  // ---- Storage ----
  { id: "manual-storage-1", category: "storage", name: "Crucial P5 Plus 2TB NVMe SSD", price: 119, specs: { capacity: "2TB", type: "SSD" } },
  { id: "manual-storage-2", category: "storage", name: "Toshiba X300 4TB HDD", price: 89, specs: { capacity: "4TB", type: "HDD" } },

  // ---- PSUs ----
  { id: "manual-psu-1", category: "psu", name: "Thermaltake Smart 600W 80+ White", price: 44, specs: { wattage: 600, efficiency: "bronze" } },
  { id: "manual-psu-2", category: "psu", name: "be quiet! Pure Power 12 M 750W", price: 109, specs: { wattage: 750, efficiency: "gold" } },

  // ---- Cases ----
  { id: "manual-case-1", category: "case", name: "Montech Air 100", price: 55, specs: { formFactorSupport: ["mATX", "ITX"] } },
  { id: "manual-case-2", category: "case", name: "Phanteks Eclipse G360A", price: 99, specs: { formFactorSupport: ["ATX", "mATX", "ITX"], maxGpuLengthMM: 400 } },

  // ---- Coolers ----
  { id: "manual-cooler-1", category: "cooler", name: "ID-COOLING SE-224-XT", price: 29, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
  { id: "manual-cooler-2", category: "cooler", name: "Arctic Liquid Freezer III 240", price: 99, specs: { supportedSockets: ["AM5", "AM4", "LGA1700"] } },
];

async function importParts() {
  console.log(`Importing ${PARTS.length} parts...`);
  let succeeded = 0;
  let failed = 0;

  for (const part of PARTS) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(part),
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`  OK   ${part.name}`);
        succeeded++;
      } else {
        console.log(`  FAIL ${part.name} -> ${data.error}`);
        failed++;
      }
    } catch (err) {
      console.log(`  FAIL ${part.name} -> ${err.message} (is the server running?)`);
      failed++;
    }
  }

  console.log(`\nDone: ${succeeded} added, ${failed} failed.`);
}

importParts();