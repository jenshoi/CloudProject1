
require('dotenv').config();
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

const usersRouter = require('./src/routes/users');
const videosRouter = require('./src/routes/videos');


app.get('/healthz', (req, res) => res.json({ ok: true })); //nice to have when starting up the app
app.use('/users', usersRouter);
app.use('/videos', videosRouter); //routes for video-API + login for all video-functions
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

app.use(express.static("public")); //frontend

app.use((req, res) => { // 404 for ukjente ruter
  res.status(404).json({ error: 'not found' });
});

// stops "empty reply" -error, this have caused me alot of time and problems  
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack || err);
  if (res.headersSent) return next(err);
    res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)); //No need to change this linje when launching on EC2
