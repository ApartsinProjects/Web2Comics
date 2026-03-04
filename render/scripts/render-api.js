class RenderApiClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Missing Render API key');
    this.apiKey = String(apiKey).trim();
    this.baseUrl = 'https://api.render.com/v1';
  }

  async request(path, method = 'GET', body) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json'
    };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      throw new Error(`Render API ${method} ${path} failed (${res.status}): ${text.slice(0, 800)}`);
    }
    return json;
  }

  async listOwners() {
    const rows = await this.request('/owners', 'GET');
    return Array.isArray(rows) ? rows : [];
  }

  async listServicesByName(name, ownerId) {
    const q = new URLSearchParams();
    if (name) q.set('name', name);
    if (ownerId) q.set('ownerId', ownerId);
    q.set('limit', '20');
    const rows = await this.request(`/services?${q.toString()}`, 'GET');
    return Array.isArray(rows) ? rows : [];
  }

  async createWebService(payload) {
    return this.request('/services', 'POST', payload);
  }

  async listPostgresByName(name, ownerId) {
    const q = new URLSearchParams();
    if (name) q.set('name', name);
    if (ownerId) q.set('ownerId', ownerId);
    q.set('limit', '20');
    const rows = await this.request(`/postgres?${q.toString()}`, 'GET');
    return Array.isArray(rows) ? rows : [];
  }

  async createPostgres(payload) {
    return this.request('/postgres', 'POST', payload);
  }

  async getPostgres(postgresId) {
    return this.request(`/postgres/${postgresId}`, 'GET');
  }

  async getPostgresConnectionInfo(postgresId) {
    return this.request(`/postgres/${postgresId}/connection-info`, 'GET');
  }

  async getService(serviceId) {
    return this.request(`/services/${serviceId}`, 'GET');
  }

  async setServiceEnvVars(serviceId, keyValues) {
    const envVars = Object.entries(keyValues || {})
      .filter(([, value]) => String(value || '').trim())
      .map(([key, value]) => ({ key, value: String(value) }));
    if (!envVars.length) return null;
    return this.request(`/services/${serviceId}/env-vars`, 'PUT', envVars);
  }

  async triggerDeploy(serviceId) {
    return this.request(`/services/${serviceId}/deploys`, 'POST', { clearCache: 'do_not_clear' });
  }

  async listDeploys(serviceId, limit = 10) {
    const q = new URLSearchParams();
    q.set('limit', String(Math.max(1, Number(limit) || 10)));
    const rows = await this.request(`/services/${serviceId}/deploys?${q.toString()}`, 'GET');
    return Array.isArray(rows) ? rows : [];
  }

  async getDeploy(serviceId, deployId) {
    return this.request(`/services/${serviceId}/deploys/${deployId}`, 'GET');
  }

  async listLogs({ ownerId, resourceId, direction = 'backward', startTime, endTime }) {
    const q = new URLSearchParams();
    q.set('ownerId', String(ownerId || '').trim());
    q.append('resource', String(resourceId || '').trim());
    q.set('direction', direction);
    if (startTime) q.set('startTime', String(startTime));
    if (endTime) q.set('endTime', String(endTime));
    return this.request(`/logs?${q.toString()}`, 'GET');
  }
}

module.exports = {
  RenderApiClient
};
