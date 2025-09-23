// src/aws/s3.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const s3 = new S3Client({ region: REGION });

function parseS3Url(s3url) {
  // "s3://bucket/key/with/spaces.mp4"
  if (!s3url?.startsWith('s3://')) throw new Error('not an s3 url');
  const [, , rest] = s3url.split('/');
  const bucket = rest.split('/')[0];
  const key = s3url.replace(`s3://${bucket}/`, '');
  return { bucket, key };
}

async function uploadFile(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `s3://${BUCKET}/${key}`;
}

async function getSignedFileUrlByKey(key, expiresIn = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// input: s3://bucket/key
async function getSignedUrlForS3Url(s3url, expiresIn = 3600) {
  const { bucket, key } = parseS3Url(s3url);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}
async function getPresignedPutUrl(key, contentType = "application/octet-stream", expiresIn = 600) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

module.exports = { s3, uploadFile, getSignedFileUrlByKey, getSignedUrlForS3Url, parseS3Url, getPresignedPutUrl };

/* (fra chat)
En S3-helper som kapsler inn S3-klienten og gir deg enkle funksjoner:

Typiske funksjoner vi definerte:

uploadFile(key, body, contentType)
Laster opp en buffer/stream til en gitt Key i bucketen. Returnerer f.eks. s3://bucket/key.

getSignedFileUrlByKey(key, expiresIn)
Lager en pre-signed GET URL (HTTPS) for et objekt (så klienten kan laste ned direkte fra S3).

getSignedUrlForS3Url("s3://bucket/key")
Praktisk når du har lagret full S3-URL i DB – funksjonen parser bucketen/key og signerer.

Hvorfor?

Controlleren kan si “last opp denne filen hit” uten å bekymre seg om AWS-kommandoer og credentials.

Når du skal vise video/bilder i frontend, trenger du pre-signed URLer. Denne fila gjør det trivielt.

Hvordan brukes den i flyten?

I analyzeVideo:

const videoKey = `videos/${id}/${req.file.originalname}`;
await uploadFile(videoKey, req.file.buffer, req.file.mimetype || 'video/mp4');


Når du bygger getResult:

const url = await getSignedUrlForS3Url(job.output_path, 3600);
// returner url til frontend, som setter videoEl.src = url


Hvor “oversetter” den?

Den oversetter JS Buffer → S3 PutObject for opplasting.

Den oversetter S3 key/URL → pre-signed HTTPS for trygg, tidsbegrenset nedlasting i nettleseren.
*/