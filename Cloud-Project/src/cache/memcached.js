// src/cache/memcached.js
const Memcached = require('memcached');

const endpoint = process.env.MEMCACHED_ENDPOINT;
if (!endpoint) {
  console.warn('[memcached] MEMCACHED_ENDPOINT is not set');
}

// Litt konservative timeouts; fjern node fra pool hvis nede
const client = new Memcached(endpoint, {
  retries: 1,
  retry: 100,
  remove: true,
  timeout: 500,
});

// Promise-wrappere (enkelt å await’e)
const getAsync = (key) =>
  new Promise((resolve, reject) =>
    client.get(key, (err, data) => (err ? reject(err) : resolve(data)))
  );

const setAsync = (key, value, ttlSec) =>
  new Promise((resolve, reject) =>
    client.set(key, value, ttlSec, (err) => (err ? reject(err) : resolve(true)))
  );

const delAsync = (key) =>
  new Promise((resolve, reject) =>
    client.del(key, (err) => (err ? reject(err) : resolve(true)))
  );

module.exports = { client, getAsync, setAsync, delAsync };
