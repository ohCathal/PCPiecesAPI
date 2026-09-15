import express from "express";
import cors from "cors";
import "dotenv/config";
import { getAllPartsGrouped, addPart, deletePart } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANTHROPIC_API_KEY;

/* ---------------------------------------------------------
   PARTS API
   The catalog lives in bench.db (SQLite), not in frontend code.
--------------------------------------------------------- */
app.get("/api/parts", (req, res) => {
  try {
    res.json(getAllPartsGrouped());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load parts." });
  }
});

app.post("/api/parts", (req, res) => {
  const { id, category, name, price, specs } = req.body || {};
  if (!id || !category || !name || price == null) {
    return res.status(400).json({ error: "id, category, name, and price are required." });
  }
  try {
    addPart({ id, category, name, price, specs });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add part. (Is the id already used?)" });
  }
});

app.delete("/api/parts/:id", (req, res) => {
  const removed = deletePart(req.params.id);
  if (!removed) return res.status(404).json({ error: "Part not found." });
  res.json({ ok: true });
});

app.post("/api/recommend", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set. Add it to a .env file." });
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "Upstream API error." });
    }

    const data = await response.json();
    const text = (data.content || [])
      .map((block) => block.text || "")
      .join("\n")
      .trim();

    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));