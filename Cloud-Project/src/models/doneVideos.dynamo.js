//Denne koden er "identisk" med doneVideos.js, bare at denne er for dynamoDB istedefor MariaDB, dynamoDB er noSQL

/*Denne koden brukes når:
Når du er klar til å slå på DynamoDB: opprett tabellen i AWS, gi appen AWS-tilgang, sett USE_DYNAMO=true, restart — ferdig.
*/
const {
  doc,
  TABLE,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} = require("../aws/dynamo");

const nowIso = () => new Date().toISOString();

// Henter QUT-bruker fra env eller fra argument
function requireQutUsername(qutUsername) {
  const val = qutUsername || process.env.QUT_USERNAME;
  if (!val) throw new Error("QUT_USERNAME mangler: sett env eller send inn fra controller");
  return val;
}

// CREATE
async function createJob({ id, filename, inputPath, outputPath, metadataPath, owner, qutUsername }) {
  const qut = requireQutUsername(qutUsername);
  const item = {
    "qut-username": qut,  // <- PK som QUT-policy krever
    id,                   // <- SK
    filename,
    status: "running",
    count: null,
    input_path: inputPath,
    output_path: outputPath,
    metadata_path: metadataPath,
    owner: owner ?? qut,  // behold "owner", men sett default = qut
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await doc.send(new PutCommand({
    TableName: TABLE,
    Item: item,
    // optional: ConditionExpression for å hindre overwrite
    ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
    ExpressionAttributeNames: { "#pk": "qut-username", "#sk": "id" },
  }));
  return item;
}

// DONE
async function updateJobDone({ id, count, qutUsername }) {
  const qut = requireQutUsername(qutUsername);
  const out = await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { "qut-username": qut, id },
    UpdateExpression: "SET #s=:s, #c=:c, updated_at=:u",
    ExpressionAttributeNames: { "#s": "status", "#c": "count" },
    ExpressionAttributeValues: { ":s": "done", ":c": count ?? null, ":u": nowIso() },
    ReturnValues: "ALL_NEW",
  }));
  return out.Attributes;
}

// ERROR
async function updateJobError({ id, message, qutUsername }) {
  const qut = requireQutUsername(qutUsername);
  const out = await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { "qut-username": qut, id },
    UpdateExpression: "SET #s=:s, updated_at=:u",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "error", ":u": nowIso() },
    ReturnValues: "ALL_NEW",
  }));
  return out.Attributes;
}

// GET
async function getJob(id, qutUsername) {
  const qut = requireQutUsername(qutUsername);
  const out = await doc.send(new GetCommand({
    TableName: TABLE,
    Key: { "qut-username": qut, id },
  }));
  return out.Item || null;
}

async function getOwner(id, qutUsername) {
  const item = await getJob(id, qutUsername);
  return item?.owner ?? null;
}

// LIST (per bruker)
async function listJobs({ limit = 50, qutUsername } = {}) {
  const qut = requireQutUsername(qutUsername);
  const out = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: { "#pk": "qut-username" },
    ExpressionAttributeValues: { ":pk": qut },
    Limit: Number(limit),
    ScanIndexForward: false, // hvis du senere vil sortere på id eller har timestamp som SK
  }));
  return out.Items || [];
}

//For admin filtering

// LIST with optional filters
async function listJobs({ limit = 50, qutUsername, owner, status, from, to } = {}) {
  const qut = requireQutUsername(qutUsername);

  // Build FilterExpression dynamically
  const names = { "#pk": "qut-username" };
  const values = { ":pk": qut };
  let FilterExpression = [];
  if (owner)  { names["#owner"] = "owner";   values[":owner"]  = owner;  FilterExpression.push("#owner = :owner"); }
  if (status) { names["#status"] = "status"; values[":status"] = status; FilterExpression.push("#status = :status"); }
  if (from)   { names["#created_at"] = "created_at"; values[":from"] = from; FilterExpression.push("#created_at >= :from"); }
  if (to)     { names["#created_at"] = "created_at"; values[":to"]   = to;   FilterExpression.push("#created_at <  :to");   }

  const params = {
    TableName: TABLE,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    Limit: Number(limit),
    ScanIndexForward: false,
  };
  if (FilterExpression.length) params.FilterExpression = FilterExpression.join(" AND ");

  const out = await doc.send(new QueryCommand(params));
  return out.Items || [];
}

module.exports = { createJob, updateJobDone, updateJobError, getJob, getOwner, listJobs };



/*
Opprett tabellen (CLI/Console).

Gi EC2 (eller lokal maskin) tilgang (IAM).

Sett USE_DYNAMO=true og fyll AWS_REGION/DYNAMO_TABLE.

Start appen — nå bruker den DynamoDB.
*/