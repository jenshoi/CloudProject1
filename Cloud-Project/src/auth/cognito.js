require('dotenv').config();

const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  AuthFlowType,
} = require("@aws-sdk/client-cognito-identity-provider");
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const crypto = require("crypto");

const REGION = process.env.COGNITO_REGION;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET || "";

const cognito = new CognitoIdentityProviderClient({ region: REGION });

function secretHash(username) {
  if (!CLIENT_SECRET) return undefined; 
  const hmac = crypto.createHmac("sha256", CLIENT_SECRET);
  hmac.update(username + CLIENT_ID);
  return hmac.digest("base64");
}

// Verifiers (JWKs cached under the hood)
const idVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "id",
  clientId: CLIENT_ID,
});
const accessVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "access",
  clientId: CLIENT_ID,
});

// --- Express route handlers ---
async function signUpHandler(req, res, next) {
  try {
    const { username, password, email } = req.body;
    const out = await cognito.send(new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: username,
      Password: password,
      SecretHash: secretHash(username),
      UserAttributes: [{ Name: "email", Value: email }],
    }));
    res.json(out);
  } catch (err) {
      console.error('[Cognito signUp] failed:', err);
    next(err);
  }
}

async function confirmHandler(req, res, next) {
  try {
    const { username, code } = req.body;
    const out = await cognito.send(new ConfirmSignUpCommand({
      ClientId: CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
      SecretHash: secretHash(username),
    }));
    res.json(out);
  } catch (err) {
      console.error('[Cognito confirm] failed:', err);
    next(err);
  }
}

async function loginHandler(req, res, next) {
  try {
    const { username, password } = req.body;
    const params = {
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    };
    const sh = secretHash(username);
    if (sh) params.AuthParameters.SECRET_HASH = sh;

    const out = await cognito.send(new InitiateAuthCommand(params));
    const r = out.AuthenticationResult || {};
    // Return tokens to client; client sends ID/Access token back on future API calls
    res.json({
      id_token: r.IdToken,
      access_token: r.AccessToken,
      refresh_token: r.RefreshToken,
      expires_in: r.ExpiresIn,
      token_type: r.TokenType,
    });
  } catch (err) {
      console.error('[Cognito login] failed:', err);
    next(err);
  }
}

// --- Middleware: verify Bearer token (ID or Access) ---
async function verifyCognito(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    let claims;
    try {
      // Prefer verifying ID token (richer identity claims for app logic)
      claims = await idVerifier.verify(token);
    } catch {
      // Fallback to Access token (if client sends that)
      claims = await accessVerifier.verify(token);
    }

    // Normalize identity on req.user
    req.user = {
      sub: claims.sub,
      username: claims["cognito:username"] || claims.username,
      email: claims.email, // only present on ID tokens
      groups: claims["cognito:groups"] || [],
      raw: claims,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireGroup(group) {
  return (req, res, next) => {
    const groups = req.user?.groups || [];
    if (groups.includes(group)) return next();
    return res.status(403).json({ error: `requires group: ${group}` });
  };
}

module.exports = {
  signUpHandler,
  confirmHandler,
  loginHandler,
  verifyCognito,
  requireGroup,
};
