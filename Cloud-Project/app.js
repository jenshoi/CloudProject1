// app.js — bootstrapper som henter SSM + Secrets før resten starter

require('dotenv').config();

// Debug (ufarlig; logger ikke hemmeligheter)
console.log('ENV check (pre-load)', {
  QUT_USERNAME: process.env.QUT_USERNAME,
  AWS_REGION: process.env.AWS_REGION,
});

// -------------------- Imports --------------------
const express = require('express');
const fs = require('fs');
const path = require('path');

// AWS SDK-klienter
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// -------------------- SSM: Ikke-hemmelig konfig --------------------
async function loadParamsFromSSM() {
  // Region å kalle SSM i (bruk eksisterende hvis satt, ellers en default)
  const baseRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-2';
  const ssm = new SSMClient({ region: baseRegion });

  const get = async (name) => {
    const resp = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return resp?.Parameter?.Value;
  };

  // Map SSM-parameter -> ENV key (disse er ikke hemmelige)
  const mapping = {
    S3_BUCKET:    '/carcounter/S3_BUCKET',
    DYNAMO_TABLE: '/carcounter/DYNAMO_TABLE',
    AWS_REGION:   '/carcounter/AWS_REGION',
    APP_BASE_URL: '/carcounter/APP_BASE_URL',
  };

  for (const [envKey, paramName] of Object.entries(mapping)) {
    if (!process.env[envKey]) {
      try {
        const val = await get(paramName);
        if (val) process.env[envKey] = val;
      } catch (e) {
        console.warn(`SSM: kunne ikke hente ${paramName} (${envKey}):`, e.name || e.message);
      }
    }
  }
}

// -------------------- Secrets Manager: Hemmeligheter --------------------
// Forventer et Secret som inneholder nøyaktig disse nøklene (som i skjermbildet ditt):
//   COGNITO_USER_POOL_ID
//   COGNITO_REGION
//   COGNITO_CLIENT_ID
//   COGNITO_CLIENT_SECRET
async function loadSecretsFromSM() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-2';
  const secretName = process.env.CARCOUNTER_SECRET_NAME || '/carcounter/secrets';

  const sm = new SecretsManagerClient({ region });

  try {
    const resp = await sm.send(new GetSecretValueCommand({ SecretId: secretName }));
    const str = resp?.SecretString;
    if (!str) {
      console.warn(`[secrets] ${secretName}: tom SecretString`);
      return;
    }

    const secrets = JSON.parse(str);
    const KEYS = [
      'COGNITO_USER_POOL_ID',
      'COGNITO_REGION',
      'COGNITO_CLIENT_ID',
      'COGNITO_CLIENT_SECRET',
    ];

    // Sett env fra secret (overstyrer bare med ikke-tomme strenger)
    for (const k of KEYS) {
      const v = secrets[k];
      if (typeof v === 'string' && v.length > 0) {
        process.env[k] = v;
      }
    }

    console.log(
      `[secrets] loaded: ${KEYS.filter(k => k !== 'COGNITO_CLIENT_SECRET').join(', ')} from ${secretName}`
    );
  } catch (e) {
    console.warn(`[secrets] kunne ikke hente ${secretName}:`, e.name || e.message);
  }
}

// -------------------- Bootstrap & start app --------------------
(async () => {
  // 1) Last SSM (ikke-hemmelig)
  await loadParamsFromSSM();

  // 2) Last Secrets (hemmelig)
  await loadSecretsFromSM();

  // 3) Start Express
  const app = express();
  app.use(express.json());

  // Opprett lokale mapper (midlertidig/artefakter)
  ['uploads', 'outputs'].forEach(dir => {
    try {
      fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
    } catch {}
  });

  // Ruter
  const videosRouter = require('./src/routes/videos');
  const authRouter = require('./src/routes/auth');
  const { verifyCognito } = require('./src/auth/cognito');

  // Auth & protected API
  app.use('/auth', authRouter);
  app.use('/videos', verifyCognito, videosRouter); // beskyttet av Cognito

  // Helse
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Statisk innhold
  app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));
  app.use(express.static('public'));

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Global error handler (praktisk for Cognito-feil)
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    const status =
      (err.$metadata && err.$metadata.httpStatusCode) ||
      (err.name === 'NotAuthorizedException' ? 401 :
       err.name === 'UserNotConfirmedException' ? 403 :
       err.name === 'UsernameExistsException' ? 409 :
       400);
    res.status(status).json({ error: err.name || 'error', message: err.message });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`Server running on http://0.0.0.0:${PORT} (region=${process.env.AWS_REGION})`)
  );
})();


