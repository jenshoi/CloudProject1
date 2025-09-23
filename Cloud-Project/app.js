
require('dotenv').config();
//debugging
console.log('ENV check', {
  QUT_USERNAME: process.env.QUT_USERNAME,
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID
});

//module imports
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express(); //making the app

app.use(express.json()); 
// ChatGPT
['uploads', 'outputs'].forEach(dir => {
    fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
  });

//const usersRouter = require('./src/routes/users'); Using cognito now
const videosRouter = require('./src/routes/videos');
//Cognito
const authRouter = require("./src/routes/auth");
const { verifyCognito } = require("./src/auth/cognito");

app.use("/auth", authRouter);
app.use("/videos", verifyCognito, videosRouter); // protected


app.get('/healthz', (req, res) => res.json({ ok: true })); //nice to have when starting up the app
//app.use('/users', usersRouter); using cognito now
//app.use('/videos', videosRouter); //routes for video-API + login for all video-functions
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

app.use(express.static("public")); //frontend

app.use((req, res) => { // 404 for ukjente ruter
  res.status(404).json({ error: 'not found' });
});

// New errorhandler for debugging
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err); // keep full object
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
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)); //No need to change this linje when launching on EC2
