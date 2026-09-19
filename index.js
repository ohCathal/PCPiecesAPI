import express from "express";
import cors from "cors";
import { getAllPartsGrouped, addPart, deletePart } from "./db.js";
import {
  registerAccount,
  loginAccount,
  getEmailForToken,
  logoutToken,
  saveAccountData,
  getAccountData,
  verifyEmailToken,
  resendVerification,
  changePassword,
  requestEmailChange,
  confirmEmailChange,
  deleteAccount,
} from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANTHROPIC_API_KEY;

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
   AUTH (email + password + real verification email)
--------------------------------------------------------- */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in." });
  const email = getEmailForToken(token);
  if (!email) return res.status(401).json({ error: "Session expired, please sign in again." });
  req.email = email;
  req.token = token;
  next();
}

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  try {
    await registerAccount(email.trim().toLowerCase(), password);
    res.status(201).json({ message: "Check your email for a link to verify your account." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required." });
  try {
    await resendVerification(email.trim().toLowerCase());
    res.json({ message: "Verification email sent again." });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// This is the link the person actually clicks in their inbox -- a plain
// GET request, no frontend involved, since it just needs to mark the
// account verified and show a simple confirmation.
app.get("/api/auth/verify", (req, res) => {
  const { token } = req.query;
  const email = token ? verifyEmailToken(token) : null;
  res.set("Content-Type", "text/html");
  if (email) {
    res.send(`<html><body style="font-family:sans-serif; text-align:center; padding:60px;">
      <h2>Email verified 🎉</h2>
      <p>${email} is now verified. You can close this tab and sign in.</p>
    </body></html>`);
  } else {
    res.status(400).send(`<html><body style="font-family:sans-serif; text-align:center; padding:60px;">
      <h2>Link expired or invalid</h2>
      <p>Request a new verification email and try again.</p>
    </body></html>`);
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  try {
    const token = await loginAccount(email.trim().toLowerCase(), password);
    res.json({ token, email: email.trim().toLowerCase() });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ email: req.email });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  logoutToken(req.token);
  res.json({ ok: true });
});

app.get("/api/profile", requireAuth, (req, res) => {
  res.json(getAccountData(req.email) || { build: {}, currentPC: {} });
});

app.post("/api/profile", requireAuth, (req, res) => {
  const { build, currentPC } = req.body || {};
  saveAccountData(req.email, build, currentPC);
  res.json({ ok: true });
});

/* ---------------------------------------------------------
   ACCOUNT MANAGEMENT
--------------------------------------------------------- */
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required." });
  try {
    await changePassword(req.email, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/auth/request-email-change", requireAuth, async (req, res) => {
  const { newEmail, password } = req.body || {};
  if (!newEmail || !password) return res.status(400).json({ error: "New email and password are required." });
  try {
    await requestEmailChange(req.email, newEmail.trim().toLowerCase(), password);
    res.json({ message: "Check your new email inbox to confirm the change." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/auth/confirm-email-change", (req, res) => {
  const { token } = req.query;
  const newEmail = token ? confirmEmailChange(token) : null;
  res.set("Content-Type", "text/html");
  if (newEmail) {
    res.send(`<html><body style="font-family:sans-serif; text-align:center; padding:60px;">
      <h2>Email updated 🎉</h2>
      <p>Your account email is now ${newEmail}. Please sign in again with your new email.</p>
    </body></html>`);
  } else {
    res.status(400).send(`<html><body style="font-family:sans-serif; text-align:center; padding:60px;">
      <h2>Link expired or invalid</h2>
      <p>Request the email change again and try the new link.</p>
    </body></html>`);
  }
});

app.post("/api/auth/delete-account", requireAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password is required to delete your account." });
  try {
    await deleteAccount(req.email, password);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
   AI RECOMMENDATIONS
--------------------------------------------------------- */
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