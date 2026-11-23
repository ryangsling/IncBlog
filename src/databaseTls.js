const { readFileSync } = require('node:fs');
const { checkServerIdentity } = require('node:tls');

function databaseTls(connectionString) {
  let target;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error('Invalid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !target.hostname ||
      [...target.searchParams.keys()].some((key) => /^(ssl|host|port|uselibpqcompat|options)/i.test(key))) {
    throw new Error('Use a PostgreSQL URL with the server in its authority and configure TLS through PG_CA_FILE.');
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const ca = process.env.PG_CA_FILE ? readFileSync(process.env.PG_CA_FILE) : undefined;
  return {
    rejectUnauthorized: true,
    ...(ca && { ca }),
    checkServerIdentity: (_, certificate) => checkServerIdentity(host, certificate),
  };
}

module.exports = { databaseTls };
