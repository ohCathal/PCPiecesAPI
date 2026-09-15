import cpuParts from "./parts-data/cpu.js";
import motherboardParts from "./parts-data/motherboard.js";
import ramParts from "./parts-data/ram.js";
import gpuParts from "./parts-data/gpu.js";
import storageParts from "./parts-data/storage.js";
import psuParts from "./parts-data/psu.js";
import caseParts from "./parts-data/case.js";
import coolerParts from "./parts-data/cooler.js";

const API_URL = "https://pcpiecesapi.onrender.com/api/parts"; // live

const PARTS = [
  ...cpuParts,
  ...motherboardParts,
  ...ramParts,
  ...gpuParts,
  ...storageParts,
  ...psuParts,
  ...caseParts,
  ...coolerParts,
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