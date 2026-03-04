const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadConfig, deepMerge } = require('../../engine/src/config');
const { SECRET_KEYS } = require('./options');

function getByPath(obj, pathKey) {
  const keys = String(pathKey || '').split('.').filter(Boolean);
  let cur = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setByPath(obj, pathKey, value) {
  const keys = String(pathKey || '').split('.').filter(Boolean);
  if (!keys.length) throw new Error('Invalid path key');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!cur[key] || typeof cur[key] !== 'object' || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

class RuntimeConfigStore {
  constructor(baseConfigPath, persistence) {
    this.baseConfigPath = path.resolve(baseConfigPath);
    this.persistence = persistence;
    this.baseConfig = loadConfig(this.baseConfigPath).config;
    this.state = {
      overrides: {},
      secrets: {}
    };
  }

  async load() {
    let raw = null;
    try {
      raw = this.persistence ? await this.persistence.load() : null;
    } catch (_) {
      raw = null;
    }
    try {
      this.state.overrides = raw && typeof raw.overrides === 'object' ? raw.overrides : {};
      this.state.secrets = raw && typeof raw.secrets === 'object' ? raw.secrets : {};
    } catch (_) {
      this.state = { overrides: {}, secrets: {} };
    }
  }

  async save() {
    if (!this.persistence) return;
    await this.persistence.save(this.state);
  }

  getEffectiveConfig() {
    return deepMerge(this.baseConfig, this.state.overrides || {});
  }

  getCurrent(pathKey) {
    return getByPath(this.getEffectiveConfig(), pathKey);
  }

  async setConfigValue(pathKey, value) {
    setByPath(this.state.overrides, pathKey, value);
    await this.save();
    return this.getCurrent(pathKey);
  }

  async clearOverrides() {
    this.state.overrides = {};
    await this.save();
  }

  getSecretsStatus() {
    const out = {};
    SECRET_KEYS.forEach((key) => {
      const stateVal = String(this.state.secrets[key] || '').trim();
      const envVal = String(process.env[key] || '').trim();
      out[key] = {
        hasValue: Boolean(stateVal || envVal),
        source: stateVal ? 'runtime' : (envVal ? 'env' : 'missing')
      };
    });
    return out;
  }

  async setSecret(key, value) {
    const k = String(key || '').trim();
    if (!SECRET_KEYS.includes(k)) throw new Error(`Unsupported key: ${k}`);
    this.state.secrets[k] = String(value || '').trim();
    await this.save();
  }

  async unsetSecret(key) {
    const k = String(key || '').trim();
    delete this.state.secrets[k];
    await this.save();
  }

  applySecretsToEnv() {
    const applied = [];
    Object.entries(this.state.secrets || {}).forEach(([k, v]) => {
      if (!v) return;
      process.env[k] = String(v);
      applied.push(k);
    });
    return applied;
  }

  writeEffectiveConfigFile(outPath) {
    const resolved = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, yaml.dump(this.getEffectiveConfig(), { lineWidth: 140 }), 'utf8');
    return resolved;
  }

  formatConfigSummary() {
    const cfg = this.getEffectiveConfig();
    const lines = [
      'Current config snapshot:',
      `- generation.panel_count: ${cfg.generation.panel_count}`,
      `- generation.objective: ${cfg.generation.objective}`,
      `- generation.output_language: ${cfg.generation.output_language}`,
      `- generation.detail_level: ${cfg.generation.detail_level}`,
      `- providers.text.provider: ${cfg.providers.text.provider}`,
      `- providers.text.model: ${cfg.providers.text.model}`,
      `- providers.image.provider: ${cfg.providers.image.provider}`,
      `- providers.image.model: ${cfg.providers.image.model}`,
      `- runtime.image_concurrency: ${cfg.runtime.image_concurrency}`,
      `- runtime.retries: ${cfg.runtime.retries}`,
      `- output.width: ${cfg.output.width}`,
      `- output.panel_height: ${cfg.output.panel_height}`,
      '',
      'Commands:',
      '/options <path>  - list choices for a setting',
      '/choose <path> <number> - choose option by index',
      '/set <path> <value> - set any value directly',
      '/keys - show provider key status',
      '/setkey <KEY> <VALUE> - set provider key in runtime state',
      '/unsetkey <KEY> - remove runtime key override',
      '/reset_config - clear runtime overrides'
    ];
    return lines.join('\n');
  }
}

module.exports = {
  RuntimeConfigStore,
  getByPath,
  setByPath
};
