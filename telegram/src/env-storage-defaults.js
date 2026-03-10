function resolveBotEnvironment(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'production' || value === 'prod' || value === 'live') return 'production';
  return 'staging';
}

function envStorageNamespace(envName) {
  return resolveBotEnvironment(envName) === 'production' ? 'envs/production' : 'envs/staging';
}

function buildEnvScopedStorageDefaults(envName) {
  const ns = envStorageNamespace(envName);
  return {
    namespace: ns,
    imagePrefix: `${ns}/images`,
    imageStatusKey: `${ns}/status/image-storage-status.json`,
    crashLogPrefix: `${ns}/crash-logs`,
    crashLogStatusKey: `${ns}/crash-logs/status.json`,
    requestLogPrefix: `${ns}/logs/requests`,
    requestLogStatusKey: `${ns}/logs/requests/status.json`,
    runtimeLogPrefix: `${ns}/logs/runtime`,
    stateKey: `${ns}/state/runtime-config.json`,
    blacklistKey: `${ns}/state/blacklist.json`,
    knownUsersKey: `${ns}/state/known-users.json`
  };
}

function storageDefaultsFromEnv(env = process.env) {
  const envName = resolveBotEnvironment(env.BOT_ENV || env.RENDER_BOT_ENV || env.NODE_ENV);
  return buildEnvScopedStorageDefaults(envName);
}

module.exports = {
  resolveBotEnvironment,
  envStorageNamespace,
  buildEnvScopedStorageDefaults,
  storageDefaultsFromEnv
};
