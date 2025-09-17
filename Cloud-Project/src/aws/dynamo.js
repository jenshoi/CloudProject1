// src/aws/dynamo.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "eu-north-1";
const TABLE = process.env.DYNAMO_TABLE || "VideoJobs";

// Du kan lage tabellen senere. Koden kan eksistere uten at tabellen finnes ennå.
const ddb = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(ddb);

module.exports = {
  ddb,
  doc,
  TABLE,
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
};

/*
Hva er dette?
En felles oppsett- og eksportfil for DynamoDB-klientene. Den lager:

en lavnivå DynamoDBClient

en høynivå DynamoDBDocumentClient (serialiserer JS-objekter automatisk)

eksporterer kommandoene du trenger (PutCommand, GetCommand, …)

eksporterer tabellnavn og region fra env

Hvorfor?
Slik slipper “modell”-fila di å opprette klienter hver gang, og du har én kilde til region/tabellnavn.

Hvordan brukes den?
Andre filer importerer den for å sende queries:

const { doc, TABLE, PutCommand, GetCommand } = require("../aws/dynamo");
await doc.send(new PutCommand({ TableName: TABLE, Item: {...} }));
*/