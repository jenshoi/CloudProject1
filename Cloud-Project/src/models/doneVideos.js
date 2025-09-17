//the sql querys is not directly chatGPT, but i have discussed with ChatGPT for more accurate querys
const pool = require('../../db');

async function createJob({ id, filename, inputPath, outputPath, metadataPath, owner }) {
  const ownerVal = owner || null;
  const sql = `INSERT INTO videos (id, filename, status, input_path, output_path, metadata_path, owner)
               VALUES (?, ?, 'running', ?, ?, ?, ?)`;
  await pool.query(sql, [id, filename, inputPath, outputPath, metadataPath, ownerVal]); //Denne metoden setter inn de relevante verdiene for spørsmålstegnene i selve SQL insterten, viktig at disse er i riktig rekkefølge
}

async function updateJobDone({ id, count }) { //trenger ikke å oppdatere outputpath siden denne blir opprettet før videoen er ferdig behandla i 
  const sql = `UPDATE videos SET status='done', count=? WHERE id=?`;
  await pool.query(sql, [count, id]); //oppdaterer count på den unike id-en
}

async function updateJobError({ id, message }) {
  const sql = `UPDATE videos SET status='error' WHERE id=?`;
  await pool.query(sql, [id]);
}

async function getJob(id) {
  const rows = await pool.query(`SELECT * FROM videos WHERE id=?`, [id]);
  return rows?.[0] || null;  // ← returner første rad eller null
}

async function getOwner(id) {
  const rows = await pool.query(`SELECT owner FROM videos WHERE id=?`, [id])
  if (!rows || rows.length === 0) return null;
  return rows?.[0]?.owner ?? null;
}

async function listJobs({ limit = 50, offset = 0 } = {}) {
  const rows = await pool.query(
    `SELECT id, filename, status, count, owner, created_at 
     FROM videos 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)]
  );
  return rows;
}
//method above is from chatGPT

module.exports = { createJob, updateJobDone, updateJobError, getJob, getOwner, listJobs };


