/**
 * Client for the Phaze Enterprise API (https://public-api.phaze.app/enterprise/v1).
 * Docs: https://apidocs.phaze.app/
 */

const BASE_URL = "https://public-api.phaze.app/enterprise/v1";

export class PhazeAPIError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "PhazeAPIError";
    this.status = status;
  }
}

export class PhazeEnterpriseAPI {
  constructor(apiKey = "") {
    this.apiKey = apiKey.trim();
  }

  setApiKey(apiKey = "") {
    this.apiKey = apiKey.trim();
  }

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async get(path, params = {}) {
    if (!this.apiKey) {
      throw new PhazeAPIError(401, "No Phaze Enterprise API key configured");
    }

    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (res.status === 429 && attempt < 2) {
          const retrySec = Number(res.headers.get("retry-after") || "3");
          await new Promise((r) => setTimeout(r, Math.min(retrySec, 10) * 1000));
          continue;
        }

        const bodyText = await res.text();
        if (!res.ok) {
          throw new PhazeAPIError(
            res.status,
            `Phaze API ${res.status} on ${path}: ${bodyText.slice(0, 240)}`
          );
        }
        return bodyText ? JSON.parse(bodyText) : {};
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PhazeAPIError(429, `Phaze API rate limit exceeded on ${path}`);
  }

  async paginate(path, params = {}, maxItems = 400) {
    const results = [];
    let offset = 0;
    while (results.length < maxItems) {
      const page = await this.get(path, { ...params, limit: 200, offset });
      const data = Array.isArray(page?.data) ? page.data : [];
      results.push(...data);
      offset += data.length;
      if (data.length === 0 || offset >= (page?.count ?? 0)) {
        break;
      }
    }
    return results;
  }

  async listOrgs() {
    return await this.paginate("/orgs");
  }

  async listMachines(orgId) {
    return await this.paginate(`/orgs/${encodeURIComponent(orgId)}/machines`);
  }

  async listConnections(orgId) {
    return await this.paginate(`/orgs/${encodeURIComponent(orgId)}/connections`, {}, 50);
  }

  async fetchFleetSummary() {
    const orgs = await this.listOrgs();
    const machinesById = new Map();
    const recentConnections = [];

    for (const org of orgs) {
      const [machines, connections] = await Promise.all([
        this.listMachines(org.id).catch(() => []),
        this.listConnections(org.id).catch(() => []),
      ]);
      for (const m of machines) {
        machinesById.set(m.id, {
          ...m,
          org_id: org.id,
          org_name: org.name,
          deep_link: `phaze://connect?id=${encodeURIComponent(m.id)}`,
        });
      }
      for (const conn of connections.slice(0, 15)) {
        recentConnections.push({ ...conn, org_name: org.name });
      }
    }

    return {
      orgs,
      machinesById,
      recentConnections,
    };
  }
}
