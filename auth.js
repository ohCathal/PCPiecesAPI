import crypto from "crypto";
import bcrypt from "bcryptjs";
import db from "./db.js";

/* ---------------------------------------------------------
   REAL AUTHENTICATION
   PINs are hashed with bcrypt before ever touching the database --
   the plaintext PIN is never stored anywhere. Login exchanges a
   correct username+PIN for a random session token; that token
   (not the PIN) is what the frontend keeps in localStorage and
   sends back on later requests.
--------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    pin_hash TEXT NOT NULL,
    build_json TEXT NOT NULL DEFAULT '{}',
    current_pc_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const SALT_ROUNDS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)").run(token, username, Date.now());
  return token;
}

export async function registerUser(username, pin) {
  const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
  if (existing) throw new Error("That username is already taken.");
  const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
  db.prepare(
    "INSERT INTO users (username, pin_hash, build_json, current_pc_json, created_at) VALUES (?, ?, '{}', '{}', ?)"
  ).run(username, pinHash, Date.now());
  return createSession(username);
}

export async function loginUser(username, pin) {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) throw new Error("No account with that username.");
  const valid = await bcrypt.compare(pin, user.pin_hash);
  if (!valid) throw new Error("Incorrect PIN.");
  return createSession(username);
}

export function getUsernameForToken(token) {
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  if (Date.now() - session.created_at > SESSION_TTL_MS) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return session.username;
}

export function logoutToken(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function saveUserData(username, build, currentPC) {
  db.prepare("UPDATE users SET build_json = ?, current_pc_json = ? WHERE username = ?").run(
    JSON.stringify(build || {}),
    JSON.stringify(currentPC || {}),
    username
  );
}

export function getUserData(username) {
  const user = db.prepare("SELECT build_json, current_pc_json FROM users WHERE username = ?").get(username);
  if (!user) return null;
  return { build: JSON.parse(user.build_json), currentPC: JSON.parse(user.current_pc_json) };
}