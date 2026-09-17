import crypto from "crypto";
import bcrypt from "bcryptjs";
import db from "./db.js";
import { sendVerificationEmail } from "./mail.js";

/* ---------------------------------------------------------
   REAL AUTHENTICATION (email + password + verification)
   Passwords are hashed with bcrypt before ever touching the
   database. Registering does NOT log you in -- it sends a real
   verification email via Resend, and login is blocked until that
   link is clicked. This mirrors how real production auth systems
   work, not just a toy version of the idea.

   Table names are new (not "users"/"sessions") on purpose: an
   earlier username+PIN version of this file already created
   tables by those names on the live database. Reusing the names
   with a different schema would silently keep the OLD schema
   (SQLite's CREATE TABLE IF NOT EXISTS does not migrate existing
   tables), so this uses fresh names for a clean schema instead.
--------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    build_json TEXT NOT NULL DEFAULT '{}',
    current_pc_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const SALT_ROUNDS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO auth_sessions (token, email, created_at) VALUES (?, ?, ?)").run(token, email, Date.now());
  return token;
}

async function issueVerificationToken(email) {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO email_verification_tokens (token, email, created_at) VALUES (?, ?, ?)").run(
    token,
    email,
    Date.now()
  );
  await sendVerificationEmail(email, token);
}

export async function registerAccount(email, password) {
  if (!EMAIL_RE.test(email)) {
    const err = new Error("Enter a valid email address.");
    err.status = 400;
    throw err;
  }
  if (!password || password.length < 8) {
    const err = new Error("Password needs at least 8 characters.");
    err.status = 400;
    throw err;
  }

  const existing = db.prepare("SELECT email FROM accounts WHERE email = ?").get(email);
  if (existing) {
    const err = new Error("An account with that email already exists.");
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  db.prepare(
    "INSERT INTO accounts (email, password_hash, verified, build_json, current_pc_json, created_at) VALUES (?, ?, 0, '{}', '{}', ?)"
  ).run(email, passwordHash, Date.now());

  try {
    await issueVerificationToken(email);
  } catch (err) {
    // Roll back so a failed email doesn't leave behind an account that
    // can never be verified -- they can just register again cleanly.
    db.prepare("DELETE FROM accounts WHERE email = ?").run(email);
    const wrapped = new Error("Could not send the verification email. Please try again.");
    wrapped.status = 500;
    throw wrapped;
  }
}

export async function resendVerification(email) {
  const account = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
  if (!account) {
    const err = new Error("No account with that email.");
    err.status = 404;
    throw err;
  }
  if (account.verified) {
    const err = new Error("This account is already verified.");
    err.status = 400;
    throw err;
  }
  await issueVerificationToken(email);
}

export function verifyEmailToken(token) {
  const row = db.prepare("SELECT * FROM email_verification_tokens WHERE token = ?").get(token);
  if (!row) return null;
  db.prepare("DELETE FROM email_verification_tokens WHERE token = ?").run(token);
  if (Date.now() - row.created_at > VERIFY_TOKEN_TTL_MS) return null;
  db.prepare("UPDATE accounts SET verified = 1 WHERE email = ?").run(row.email);
  return row.email;
}

export async function loginAccount(email, password) {
  const account = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
  if (!account) {
    const err = new Error("No account with that email.");
    err.status = 401;
    throw err;
  }
  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    const err = new Error("Incorrect password.");
    err.status = 401;
    throw err;
  }
  if (!account.verified) {
    const err = new Error("Please verify your email before signing in — check your inbox for the link.");
    err.status = 403;
    throw err;
  }
  return createSession(email);
}

export function getEmailForToken(token) {
  const session = db.prepare("SELECT * FROM auth_sessions WHERE token = ?").get(token);
  if (!session) return null;
  if (Date.now() - session.created_at > SESSION_TTL_MS) {
    db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    return null;
  }
  return session.email;
}

export function logoutToken(token) {
  db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
}

export function saveAccountData(email, build, currentPC) {
  db.prepare("UPDATE accounts SET build_json = ?, current_pc_json = ? WHERE email = ?").run(
    JSON.stringify(build || {}),
    JSON.stringify(currentPC || {}),
    email
  );
}

export function getAccountData(email) {
  const account = db.prepare("SELECT build_json, current_pc_json FROM accounts WHERE email = ?").get(email);
  if (!account) return null;
  return { build: JSON.parse(account.build_json), currentPC: JSON.parse(account.current_pc_json) };
}