import { Resend } from "resend";

/* ---------------------------------------------------------
   EMAIL SENDING
   Uses Resend's default onboarding@resend.dev sender, which
   works immediately with no domain setup -- fine for a personal
   project. If you later verify your own domain in Resend, just
   change FROM_ADDRESS to something like "Bench <hello@yourdomain.com>".
--------------------------------------------------------- */
const FROM_ADDRESS = "Bench <onboarding@resend.dev>";

// The backend's own public URL, so the verification link in the email
// points somewhere real regardless of whether this is running locally
// or on Render. Set API_BASE_URL as an env var on Render to your actual
// deployed URL (e.g. https://pcpiecesapi.onrender.com).
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";

// Constructed lazily, only when actually sending -- the Resend SDK
// throws immediately if given an undefined key, which would otherwise
// crash the entire server on startup (not just the email feature) if
// RESEND_API_KEY is ever missing.
function getClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set.");
  }
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendVerificationEmail(email, token) {
  const resend = getClient();
  const verifyUrl = `${API_BASE_URL}/api/auth/verify?token=${token}`;
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Verify your Bench account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Verify your email</h2>
        <p>Click the button below to verify your account and start saving builds.</p>
        <p>
          <a href="${verifyUrl}" style="display:inline-block; background:#e22f3a; color:#fff; padding:10px 18px; text-decoration:none; border-radius:4px;">
            Verify my email
          </a>
        </p>
        <p style="color:#888; font-size:12px;">If you didn't create a Bench account, you can safely ignore this email.</p>
      </div>
    `,
  });
  if (error) throw new Error(`Failed to send verification email: ${error.message || error}`);
}