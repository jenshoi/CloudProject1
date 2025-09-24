const express = require("express");
const {
  signUpHandler, confirmHandler, loginHandler,
  respondMfaHandler, mfaAssociateHandler, mfaVerifyTotpHandler, mfaSetPreferenceHandler,
  verifyCognito
} = require("../auth/cognito");

const router = express.Router();
router.post("/signup", signUpHandler);
router.post("/confirm", confirmHandler);
router.post("/login", loginHandler);

// MFA
router.post("/login/mfa", respondMfaHandler);            // body: { username, session, code, challenge }
router.post("/mfa/associate", verifyCognito, mfaAssociateHandler); // returns TOTP secret
router.post("/mfa/verify", verifyCognito, mfaVerifyTotpHandler);   // body: { code }
router.post("/mfa/prefer", verifyCognito, mfaSetPreferenceHandler);


// ---------- Google (Cognito Hosted UI) ----------

router.get("/google/login", (req, res) => {
  // Accept either with or without scheme; normalize to host.
  const domain = (process.env.COGNITO_DOMAIN || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!domain) return res.status(500).send("COGNITO_DOMAIN missing");

  const base = `https://${domain}`;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const redirectUri = process.env.OAUTH_REDIRECT_URI; // must exactly match your app client's callback

  const url = new URL(`${base}/oauth2/authorize`);
  
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("identity_provider", "Google");
  // Optional CSRF: url.searchParams.set("state", crypto.randomUUID());
  console.log("AUTH URL =>", url.toString());
  return res.redirect(url.toString());
});

router.get("/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    const domain = (process.env.COGNITO_DOMAIN || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    if (!domain) return res.status(500).json({ error: "missing_cognito_domain" });

    const base = `https://${domain}`;
    const clientId = process.env.COGNITO_CLIENT_ID;
    const clientSecret = process.env.COGNITO_CLIENT_SECRET || "";
    const redirectUri = process.env.OAUTH_REDIRECT_URI;

    const tokenEndpoint = `${base}/oauth2/token`;

    // Build form body
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId, // removed below if using Basic auth
    });

    // Headers
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };

    // If your app client has a secret, use HTTP Basic and drop client_id from body
    if (clientSecret) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
      body.delete("client_id");
    }

    const r = await fetch(tokenEndpoint, { method: "POST", headers, body });
    const data = await r.json();

    if (!r.ok) {
      console.error("OAuth exchange failed:", data);
      return res.status(400).json({ error: "oauth_exchange_failed", detail: data });
    }

    // Send tokens back to SPA via hash
    const hash = new URLSearchParams({
      id_token: data.id_token || "",
      access_token: data.access_token || "",
      refresh_token: data.refresh_token || "",
      token_type: data.token_type || "",
      expires_in: String(data.expires_in ?? ""),
      source: "google",
    }).toString();

    return res.redirect(`/#${hash}`);
  } catch (e) {
    console.error("oauth/callback error:", e);
    return res.status(500).json({ error: "oauth_callback_error" });
  }
});


router.get("/me", verifyCognito, (req, res) => {
  const u = req.user || {};
  res.json({
    username: u.username,
    email: u.email || null,
    groups: u.groups || [],
    isAdmin: Array.isArray(u.groups) && u.groups.includes("admin"),
  });
});

module.exports = router;

