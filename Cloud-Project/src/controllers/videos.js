const fs = require('fs');
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { spawn } = require('child_process');

const { uploadFile, getSignedUrlForS3Url, parseS3Url, s3 } = require('../aws/s3');
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

// ------------------------------------------------------------
// ANALYZE VIDEO
// ------------------------------------------------------------
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
      owner: req.user?.username ?? qutUsername,
      qutUsername,
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

// ------------------------------------------------------------
// GET RESULT
// ------------------------------------------------------------
exports.getResult = async (req, res) => {
  try {
    const job = await getJob(req.params.id, qutUsername);
    const owner = await getOwner(req.params.id, qutUsername);

    if (!job) return res.status(404).json({ error: "could not find the jobID" });
    if (!owner) return res.status(404).json({ error: "could not find the jobID" });

    if (req.user.role !== 'admin' && owner !== req.user.username) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (job.status !== 'done') {
      return res.json({ jobID: req.params.id, status: job.status, count: job.count ?? null, video: null, images: [], owner });
    }

    let images = [];
    let videoUrl = null;

    if (job.output_path?.startsWith('s3://')) {
      videoUrl = await getSignedUrlForS3Url(job.output_path, 3600);
    }

    if (job.metadata_path?.startsWith('s3://')) {
      const { bucket, key } = parseS3Url(job.metadata_path);
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const resp = await s3.send(cmd);
      const metaText = await streamToString(resp.Body);
      const meta = JSON.parse(metaText || '{}');
      const imgKeys = Array.isArray(meta.images) ? meta.images : [];

      images = await Promise.all(imgKeys.map(async (s3url) => getSignedUrlForS3Url(s3url, 3600)));
    }

    return res.json({ jobID: req.params.id, status: job.status, count: job.count ?? null, video: videoUrl, images, owner });

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
    const job = await getJob(id, qutUsername);
    if (!job) return res.status(404).json({ error: "cant find job" });

    const owner = await getOwner(id, qutUsername);
    if (req.user.role !== 'admin' && owner !== req.user.username) {
      return res.status(403).json({ error: "forbidden" });
    }

    let images = [];
    if (job.metadata_path?.startsWith('s3://')) {
      const { bucket, key } = parseS3Url(job.metadata_path);
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const resp = await s3.send(cmd);
      const metaText = await streamToString(resp.Body);
      const meta = JSON.parse(metaText || '{}');
      const imgKeys = Array.isArray(meta.images) ? meta.images : [];

      images = await Promise.all(imgKeys.map(async (s3url) => getSignedUrlForS3Url(s3url, 3600)));
    }

    return res.json({ images });

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

// ------------------------------------------------------------
// LIST ALL
// ------------------------------------------------------------
exports.listAll = async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const offset = Number(req.query.offset || 0);
  const rows = await listJobs({ limit, offset, qutUsername });
  return res.json({ items: rows, limit, offset });
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






