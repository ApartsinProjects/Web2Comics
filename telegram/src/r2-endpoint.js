function normalizeCloudflareR2Endpoint(rawEndpoint, accountId = '') {
  const endpoint = String(rawEndpoint || '').trim();
  const acc = String(accountId || '').trim();
  if (!endpoint && acc) return `https://${acc}.r2.cloudflarestorage.com`;
  if (!endpoint) return '';
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (_) {
    return endpoint;
  }
  const host = String(parsed.host || '').trim().toLowerCase();
  const regionalMatch = host.match(/^([a-f0-9]{32})\.[a-z0-9-]+\.r2\.cloudflarestorage\.com$/i);
  if (regionalMatch && regionalMatch[1]) {
    parsed.host = `${regionalMatch[1]}.r2.cloudflarestorage.com`;
    return parsed.toString().replace(/\/$/, '');
  }
  return endpoint;
}

module.exports = {
  normalizeCloudflareR2Endpoint
};

