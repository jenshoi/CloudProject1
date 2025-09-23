
// app.js — bootstrapper som laster SSM-verdier før resten starter

require('dotenv').config();

// 1) Hent ufarlige konfiger fra SSM og legg i process.env
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

async function loadParamsFromSSM() {
  // Bruk env hvis satt, ellers default — vi trenger en region for å kalle SSM
  const baseRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-north-1';
  const ssm = new SSMClient({ region: baseRegion });

  const get = async (name) => {
    const resp = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return resp?.Parameter?.Value;
  };

  // Map SSM-parameter -> env-key
  const mapping = {
    S3_BUCKET:     '/carcounter/S3_BUCKET',
    DYNAMO_TABLE:  '/carcounter/DYNAMO_TABLE',
    AWS_REGION:    '/carcounter/AWS_REGION',
    APP_BASE_URL:  '/carcounter/APP_BASE_URL',
  };

  for (const [envKey, paramName] of Object.entries(mapping)) {
    if (!process.env[envKey]) {
      try {
        const val = await get(paramName);
        if (val) process.env[envKey] = val;
      } catch (e) {
        // Ikke krasj hvis du kjører lokalt uten SSM – bare logg
        console.warn(`SSM: kunne ikke hente ${paramName} (${envKey}):`, e.name || e.message);
      }
    }
  }
}

// 2) Start hele appen etter at SSM er lastet
(async () => {
  await loadParamsFromSSM();

  const express = require('express');
  const fs = require('fs');
  const path = require('path');

  const app = express();

  app.use(express.json());

  // Opprett lokale mapper (midlertidig/artefakter)
  ['uploads', 'outputs'].forEach(dir => {
    fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
  });

  // Routere (disse importerer kode som leser process.env -> må komme ETTER loadParamsFromSSM)
  const usersRouter  = require('./src/routes/users');
  const videosRouter = require('./src/routes/videos');

  // Helse
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // API
  app.use('/users', usersRouter);
  app.use('/videos', videosRouter);

  // Statisk
  app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));
  app.use(express.static('public'));

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', (err && err.stack) || err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'internal server error' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`Server running on http://0.0.0.0:${PORT} (region=${process.env.AWS_REGION})`)
  );
})();


