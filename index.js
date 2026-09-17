import express from "express";
import cors from "cors";
import { getAllPartsGrouped, addPart, deletePart } from "./db.js";
import { registerUser, loginUser, getUsernameForToken, logoutToken, saveUserData, getUserData } from "./auth.js";
const API_KEY = process.env.ANTHROPIC_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/parts", (req, res) => {
  try { res.json(getAllPartsGrouped()); }
  catch (err) { console.error(err); res.status(500).json({ error: "Could not load parts." }); }
});

app.post("/api/parts", (req, res) => {
  const { id, category, name, price, specs } = req.body || {};
  if (!id || !category || !name || price == null) return res.status(400).json({ error: "id, category, name, and price are required." });
  try { addPart({ id, category, name, price, specs }); res.status(201).json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "Could not add part." }); }
});

app.delete("/api/parts/:id", (req, res) => {
  const removed = deletePart(req.params.id);
  if (!removed) return res.status(404).json({ error: "Part not found." });
  res.json({ ok: true });
});

/* ---------------------------------------------------------
   AUTH
   Every profile-related route below either issues a session
   token (register/login) or requires one (everything else),
   read from the standard "Authorization: Bearer <token>" header.
--------------------------------------------------------- */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in." });
  const username = getUsernameForToken(token);
  if (!username) return res.status(401).json({ error: "Session expired, please sign in again." });
  req.username = username;
  req.token = token;
  next();
}

app.post("/api/auth/register", async (req, res) => {
  const { username, pin } = req.body || {};
  if (!username || !username.trim() || !pin || pin.length < 4) {
    return res.status(400).json({ error: "Username and a PIN of at least 4 digits are required." });
  }
  try {
    const token = await registerUser(username.trim(), pin);
    res.status(201).json({ token, username: username.trim() });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, pin } = req.body || {};
  if (!username || !pin) return res.status(400).json({ error: "Username and PIN are required." });
  try {
    const token = await loginUser(username.trim(), pin);
    res.json({ token, username: username.trim() });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ username: req.username });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  logoutToken(req.token);
  res.json({ ok: true });
});

app.get("/api/profile", requireAuth, (req, res) => {
  res.json(getUserData(req.username) || { build: {}, currentPC: {} });
});

app.post("/api/profile", requireAuth, (req, res) => {
  const { build, currentPC } = req.body || {};
  saveUserData(req.username, build, currentPC);
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