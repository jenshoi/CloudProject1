
//optimized by chatGPT
const Memcached = require('memcached');

const endpoint = process.env.MEMCACHED_ENDPOINT;

let client = null;

if (!endpoint) {
  console.warn('[memcached] MEMCACHED_ENDPOINT is not set – caching disabled');
} else {
  // Litt konservative timeouts; fjern node fra pool hvis nede
  client = new Memcached(endpoint, {
    retries: 1,
    retry: 100,
    remove: true,
    timeout: 500,
  });
}

// Promise-wrappere (enkle å await’e).
// Når client mangler: gjør no-op uten å kaste feil.
const getAsync = (key) =>
  client
    ? new Promise((resolve, reject) =>
        client.get(key, (err, data) => (err ? reject(err) : resolve(data)))
      )
    : Promise.resolve(null);

const setAsync = (key, value, ttlSec) =>
  client
    ? new Promise((resolve, reject) =>
        client.set(key, value, ttlSec, (err) => (err ? reject(err) : resolve(true)))
      )
    : Promise.resolve(true);

const delAsync = (key) =>
  client
    ? new Promise((resolve, reject) =>
        client.del(key, (err) => (err ? reject(err) : resolve(true)))
      )
    : Promise.resolve(true);

module.exports = { client, getAsync, setAsync, delAsync };

