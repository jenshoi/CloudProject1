require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { getAsync, setAsync, delAsync } = require('../cache/memcached'); // ADD

const { uploadFile, getSignedUrlForS3Url, parseS3Url, s3, getPresignedPutUrl } = require('../aws/s3');

const { GetObjectCommand } = require('@aws-sdk/client-s3');

const qutUsername = process.env.QUT_USERNAME;
if (!qutUsername) {
  console.warn('QUT_USERNAME mangler i .env – DynamoDB-kall vil feile uten denne.');
}

const useDynamo = process.env.USE_DYNAMO === 'true';
const model = useDynamo
  ? require('../models/doneVideos.dynamo')
  : require('../models/doneVideos'); // MariaDB fallback
const { createJob, updateJobDone, updateJobError, getJob, getOwner, listJobs } = model;


exports.analyzeVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video found' });
    }

    const id = Date.now().toString();

    // Last opp originalvideo til S3
    const videoKey = `videos/${id}/${req.file.originalname || 'upload.mp4'}`;
    await uploadFile(videoKey, req.file.buffer, req.file.mimetype || 'video/mp4');

    // Midlertidige paths til Python
    const tmpJobDir = path.join(os.tmpdir(), `job-${id}`);
    const tmpInputPath = path.join(tmpJobDir, 'input.mp4');
    const tmpFramesDir = path.join(tmpJobDir, 'frames');
    const tmpMetadataPath = path.join(tmpJobDir, 'metadata.json');

    await fsp.mkdir(tmpFramesDir, { recursive: true });
    await fsp.writeFile(tmpInputPath, req.file.buffer);

    // Registrer jobben
    await createJob({
      id,
      filename: req.file.originalname,
      inputPath: `s3://${process.env.S3_BUCKET}/${videoKey}`,
      outputPath: `s3://${process.env.S3_BUCKET}/${videoKey}`,
      metadataPath: `s3://${process.env.S3_BUCKET}/metadata/${id}.json`,
      owner: req.user.username,
    });

    // Kjør Python-script
    const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const scriptPath = path.join(process.cwd(), 'scripts', 'carCounting.py');

    const pythonFile = spawn(
      PYTHON,
      [scriptPath, '--input', tmpInputPath, '--meta', tmpMetadataPath, '--frames-dir', tmpFramesDir],
      { cwd: process.cwd() }
    );

    // Logg utdata fra Python
    [{ from: pythonFile.stdout, to: process.stdout }, { from: pythonFile.stderr, to: process.stderr }]
      .forEach(({ from, to }) => {
        from.on('data', (data) => to.write(data));
      });

    // Ferdig-signal fra Python
    pythonFile.on('close', async (code) => {
      try {
        if (code !== 0) {
          await updateJobError({ id, message: `analysis failed errorcode: ${code}`, qutUsername });
          return;
        }

        // Les metadata
        let meta = {};
        try {
          const buf = await fsp.readFile(tmpMetadataPath, 'utf8');
          meta = JSON.parse(buf);
        } catch {
          meta = {};
        }

        // Last opp snapshots
        let s3ImageKeys = [];
        try {
          const files = await fsp.readdir(tmpFramesDir);
          for (const fname of files) {
            const abs = path.join(tmpFramesDir, fname);
            const body = await fsp.readFile(abs);
            const key = `frames/${id}/${fname}`;
            await uploadFile(key, body, 'image/jpeg');
            s3ImageKeys.push(key);
          }
        } catch {
          s3ImageKeys = [];
        }

        // Oppdater metadata med S3-paths
        const safeCount = Number.isFinite(meta.count)
          ? meta.count
          : (meta.by_class ? Object.values(meta.by_class).reduce((a, b) => a + (b | 0), 0) : null);

        const s3Meta = {
          ...meta,
          jobId: id,
          video: `s3://${process.env.S3_BUCKET}/${videoKey}`,
          images: s3ImageKeys.map(k => `s3://${process.env.S3_BUCKET}/${k}`),
        };

        const metaKey = `metadata/${id}.json`;
        await uploadFile(metaKey, Buffer.from(JSON.stringify(s3Meta, null, 2), 'utf8'), 'application/json');

        await updateJobDone({ id, count: safeCount ?? null, qutUsername });
        try {
          await delAsync(`job:${id}`);    
          await delAsync(`images:${id}`);  
  
        } catch (e) {
          console.warn('cache invalidation failed', e?.message || e);
        }

        // Rydd opp temp
        try { await fsp.rm(tmpJobDir, { recursive: true, force: true }); } catch {}
      } catch (e) {
        console.error('Post-processing failed:', e);
        await updateJobError({ id, message: 'post-processing failed', qutUsername });
      }
    });

    return res.status(202).json({ jobId: id, status: 'running' });

  } catch (err) {
    console.error('analyzeVideo error:', err);
    return res.status(500).json({ error: 'internal error in analyzeVideo' });
  }
};

exports.presignUpload = async (req, res) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!filename || !contentType) {
      return res.status(400).json({ error: "filename and contentType required" });
    }

    const safeName = path.basename(filename).replace(/[^\w.\-]+/g, '_');
    const idPart = Date.now().toString() + '-' + crypto.randomBytes(3).toString('hex');
    const key = `uploads/${req.user?.username || 'anon'}/${idPart}/${safeName}`;

    const uploadUrl = await getPresignedPutUrl(key, contentType, 600); // 10 min
    return res.json({ key, uploadUrl, expiresIn: 600, bucket: process.env.S3_BUCKET });
  } catch (err) {
    console.error('presignUpload error:', err);
    return res.status(500).json({ error: "internal error in presignUpload" });
  }
};

// --------------- ANALYZE FROM S3 ----------------
exports.analyzeFromS3 = async (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: "key is required" });

    const bucket = process.env.S3_BUCKET;
    const id = Date.now().toString();

    // controllers/videos.js (i analyzeFromS3)
    const owner = req.user?.username || 'anon';
    const allowedPrefix = `uploads/${owner}/`;
    if (!key.startsWith(allowedPrefix)) {
      return res.status(403).json({ error: "forbidden: invalid key prefix" });
    }

    // midlertidige paths
    const tmpJobDir = path.join(os.tmpdir(), `job-${id}`);
    const tmpInputPath = path.join(tmpJobDir, 'input.mp4');
    const tmpFramesDir = path.join(tmpJobDir, 'frames');
    const tmpMetadataPath = path.join(tmpJobDir, 'metadata.json');
    await fsp.mkdir(tmpFramesDir, { recursive: true });

    // last ned S3-objekt til fil
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const resp = await s3.send(cmd);
    await streamToFile(resp.Body, tmpInputPath);

    // registrer jobben (samme felt som analyzeVideo)
    await createJob({
      id,
      filename: path.basename(key),
      inputPath: `s3://${bucket}/${key}`,
      outputPath: `s3://${bucket}/${key}`,
      metadataPath: `s3://${bucket}/metadata/${id}.json`,
      owner: req.user?.username ?? qutUsername,
      qutUsername,
    });

    // kjør Python
    const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const scriptPath = path.join(process.cwd(), 'scripts', 'carCounting.py');

    const pythonFile = spawn(
      PYTHON,
      [scriptPath, '--input', tmpInputPath, '--meta', tmpMetadataPath, '--frames-dir', tmpFramesDir],
      { cwd: process.cwd() }
    );

    [{ from: pythonFile.stdout, to: process.stdout }, { from: pythonFile.stderr, to: process.stderr }]
      .forEach(({ from, to }) => from.on('data', (data) => to.write(data)));

    pythonFile.on('close', async (code) => {
      try {
        if (code !== 0) {
          await updateJobError({ id, message: `analysis failed errorcode: ${code}`, qutUsername });
          return;
        }

        // metadata fra Python
        let meta = {};
        try { meta = JSON.parse(await fsp.readFile(tmpMetadataPath, 'utf8')); } catch {}

        // last opp snapshots
        let s3ImageKeys = [];
        try {
          const files = await fsp.readdir(tmpFramesDir);
          for (const fname of files) {
            const abs = path.join(tmpFramesDir, fname);
            const body = await fsp.readFile(abs);
            const frameKey = `frames/${id}/${fname}`;
            await uploadFile(frameKey, body, 'image/jpeg');
            s3ImageKeys.push(frameKey);
          }
        } catch {}

        // lagre metadata til S3
        const s3Meta = {
          ...meta,
          jobId: id,
          video: `s3://${bucket}/${key}`,
          images: s3ImageKeys.map(k => `s3://${bucket}/${k}`),
        };
        await uploadFile(`metadata/${id}.json`, Buffer.from(JSON.stringify(s3Meta, null, 2), 'utf8'), 'application/json');

        const safeCount = Number.isFinite(meta.count)
          ? meta.count
          : (meta.by_class ? Object.values(meta.by_class).reduce((a,b)=> a + (b|0), 0) : null);

        await updateJobDone({ id, count: safeCount ?? null, qutUsername });
        try {
          await delAsync(`job:${id}`);     
          await delAsync(`images:${id}`);   
          } catch (e) {
            console.warn('cache invalidation failed', e?.message || e);
          }

        try { await fsp.rm(tmpJobDir, { recursive: true, force: true }); } catch {}
      } catch (e) {
        console.error('post-processing failed:', e);
        await updateJobError({ id, message: 'post-processing failed', qutUsername });
      }
    });

    return res.status(202).json({ jobId: id, status: 'running' });
  } catch (err) {
    console.error('analyzeFromS3 error:', err);
    return res.status(500).json({ error: "internal error in analyzeFromS3" });
  }
};


exports.getResult = async (req, res) => {
  try {
    const id = req.params.id;

    // Cache: HIT/MISS
    const ck = `job:${id}`;
    const cached = await getAsync(ck);
    if (cached) {
      console.log('[cache] HIT', ck);
      return res.json(JSON.parse(cached));
    }
    console.log('[cache] MISS', ck);

    const job = await getJob(id, qutUsername);
    const owner = await getOwner(id, qutUsername);
    if (!job) return res.status(404).json({ error: "could not find the jobID" });
    if (!owner) return res.status(404).json({ error: "could not find the jobID" });

   // if (req.user.role !== 'admin' && owner !== req.user.username) {
      //return res.status(403).json({ error: "forbidden" });
    //}
    //cognito Admin
    const isAdmin = Array.isArray(req.user?.groups) && req.user.groups.includes('admin');
    if (!isAdmin && owner !== req.user.username) {
      return res.status(403).json({ error: "forbidden" });
}

    if (job.status !== 'done') {
      const payload = { jobID: id, status: job.status, count: job.count ?? null, video: null, images: [], owner };
      await setAsync(`job:${id}`, JSON.stringify(payload), 3);
      return res.json(payload);
}

    let videoUrl = null, images = [];
    if (job.output_path?.startsWith('s3://')) {
      videoUrl = await getSignedUrlForS3Url(job.output_path, 3600);
    }
    if (job.metadata_path?.startsWith('s3://')) {
      try{
        const { bucket, key } = parseS3Url(job.metadata_path);
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const resp = await s3.send(cmd);
        const meta = JSON.parse(await streamToString(resp.Body) || '{}');
        const imgKeys = Array.isArray(meta.images) ? meta.images : [];
        images = await Promise.all(imgKeys.map(u => getSignedUrlForS3Url(u, 3600)));
      } catch (e){
        images = [];
      }
      
    }

    const payload = { jobID: id, status: job.status, count: job.count ?? null, video: videoUrl, images, owner };

    const ttlSec = job.status === 'running' ? 3 : 120;
    await setAsync(ck, JSON.stringify(payload), ttlSec);

    return res.json(payload); // ← JA, her returnerer du payload
  } catch (err) {
    console.error("getResult error:", err);
    return res.status(500).json({ error: "internal error in getResult" });
  }
};


// ------------------------------------------------------------
// LIST IMAGES
// ------------------------------------------------------------
exports.listImages = async (req, res) => {
  try {
    const id = req.params.id;

    // Cache: HIT/MISS
    const ck = `images:${id}`;
    const cached = await getAsync(ck);
    if (cached) {
      console.log('[cache] HIT', ck);
      return res.json(JSON.parse(cached));
    }
    console.log('[cache] MISS', ck);

    const job = await getJob(id, qutUsername);
    if (!job) return res.status(404).json({ error: "cant find job" });

    const owner = await getOwner(id, qutUsername);
    const isAdmin = Array.isArray(req.user?.groups) && req.user.groups.includes('admin');
    if (!isAdmin && owner !== req.user.username) {
      return res.status(403).json({ error: "forbidden" });
    }

    let images = [];
    if (job.metadata_path?.startsWith('s3://')) {
    try{
        const { bucket, key } = parseS3Url(job.metadata_path);
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const resp = await s3.send(cmd);
        const meta = JSON.parse(await streamToString(resp.Body) || '{}');
        const imgKeys = Array.isArray(meta.images) ? meta.images : [];
        images = await Promise.all(imgKeys.map(u => getSignedUrlForS3Url(u, 3600)));
      } catch (e){
        images = [];
      }
    }

    const result = { images };
    await setAsync(ck, JSON.stringify(result), 60);

    return res.json(result); // ← her returnerer du result, ikke payload
  } catch (err) {
    console.error("listImages error:", err);
    return res.status(500).json({ error: "internal error in listImages" });
  }
};


// ------------------------------------------------------------
// STREAM OUTPUT (kan evt fjernes, getResult returnerer video-URL)
// ------------------------------------------------------------
exports.streamOutput = async (req, res) => {
  try {
    const job = await getJob(req.params.id, qutUsername);
    if (!job) return res.status(404).json({ error: "cant find video with this ID" });
    if (job.status !== 'done') return res.status(409).json({ error: "cant find done video with this ID" });

    if (!job.output_path?.startsWith('s3://')) {
      return res.status(410).json({ error: "no longer available locally" });
    }

    const signed = await getSignedUrlForS3Url(job.output_path, 3600);
    res.status(302).setHeader('Location', signed);
    return res.end();

  } catch (err) {
    console.error("streamOutput error:", err);
    return res.status(500).json({ error: "internal error in streamOutput" });
  }
};

exports.listAll = async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0); // not used by Dynamo Query directly
    const status = req.query.status || undefined;
    const from   = req.query.from   || undefined;
    const to     = req.query.to     || undefined;

    const rows = await listJobs({
      limit,
      qutUsername,
      owner: req.user.username,  // ← only mine
      status, from, to
    });

    return res.json({ items: rows, limit, offset });
  } catch (e) {
    console.error('listAll failed:', e);
    return res.status(500).json({ error: 'listAll failed', message: e.message });
  }
};

// Helper
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}
//Helper
function streamToFile(stream, filePath) {
  return new Promise((resolve, reject) => {
    fs.mkdir(path.dirname(filePath), { recursive: true }, (mkErr) => {
      if (mkErr) return reject(mkErr);
      const out = fs.createWriteStream(filePath);
      stream.pipe(out);
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
    });
  });
}



// ------------------------------------------------------------
// LIST ALL ADMIN
// ------------------------------------------------------------
exports.listAllAdmin = async (req, res) => {
  const isAdmin = req.user?.groups?.includes('admin');
  if (!isAdmin) return res.status(403).json({ error: 'admin only' });

  const limit  = Math.min(Number(req.query.limit || 50), 200);
  const offset = Number(req.query.offset || 0);
  const owner  = req.query.owner  || undefined;
  const status = req.query.status || undefined;
  const from   = req.query.from   || undefined; // ISO date
  const to     = req.query.to     || undefined;

  const rows = await listJobs({ limit, qutUsername, owner, status, from, to });
  const summary = rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});

  return res.json({ items: rows, limit, offset, summary });
};



