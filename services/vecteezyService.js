const https = require('https');
const VECTEEZY_API_HOST = 'api.vecteezy.com';
const DEFAULT_CONTENT_TYPE = process.env.VECTEEZY_DEFAULT_CONTENT_TYPE || 'vector';
const DEFAULT_PER_PAGE = parseInt(process.env.VECTEEZY_DEFAULT_PER_PAGE || '24', 10);
const MAX_PER_PAGE = parseInt(process.env.VECTEEZY_MAX_PER_PAGE || '48', 10);
const VALID_CONTENT_TYPES = new Set(['photo', 'png', 'psd', 'svg', 'vector', 'video']);
const VALID_SORTS = new Set(['relevance', 'newest']);
const VALID_LICENSE_TYPES = new Set(['commercial', 'editorial']);
const VALID_ORIENTATIONS = new Set(['horizontal', 'vertical', 'square', 'panoramic']);

function getApiKey() {
  const key = process.env.VECTEEZY_API_KEY;
  if (!key) {
    const error = new Error('Vecteezy API key is not configured');
    error.status = 500;
    throw error;
  }
  return key;
}

function getAccountId() {
  const accountId = process.env.VECTEEZY_ACCOUNT_ID;
  if (!accountId) {
    const error = new Error('Vecteezy account ID is not configured');
    error.status = 500;
    throw error;
  }
  return String(accountId).trim().toLowerCase();
}

function parseJsonResponse(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function vecteezyRequest(path, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.append(key, String(value));
      }
    });

    const requestPath = query.toString() ? `${path}?${query.toString()}` : path;
    const request = https.request({
      hostname: VECTEEZY_API_HOST,
      path: requestPath,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: 'application/json',
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        const data = parseJsonResponse(responseBody);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = data?.errors?.[0]?.message || data?.message || 'Vecteezy request failed';
          const error = new Error(message);
          error.status = response.statusCode >= 500 ? 502 : response.statusCode;
          error.vecteezyError = data;
          reject(error);
          return;
        }

        resolve({
          data,
          quota: {
            type: response.headers['x-quota-type'] || null,
            limit: response.headers['x-quota-limit'] || null,
            remaining: response.headers['x-quota-remaining'] || null,
            overageCutoff: response.headers['x-quota-overage-cutoff'] || null,
            overageRemaining: response.headers['x-quota-overage-remaining'] || null,
          },
        });
      });
    });

    request.on('error', (error) => {
      const wrapped = new Error(`Vecteezy network request failed: ${error.message}`);
      wrapped.status = 502;
      reject(wrapped);
    });

    request.end();
  });
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function parsePositiveInt(value, fallback, max = null) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function validateContentType(contentType) {
  const normalized = normalizeString(contentType, DEFAULT_CONTENT_TYPE).toLowerCase();
  if (!VALID_CONTENT_TYPES.has(normalized)) {
    const error = new Error('contentType must be one of: photo, png, psd, svg, vector, video');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function normalizeResource(resource = {}) {
  const previewUrl = pickFirst(resource, [
    'preview_url',
    'previewUrl',
    'preview',
    'image_url',
    'imageUrl',
    'url',
  ]);
  const thumbnailUrl = pickFirst(resource, [
    'thumbnail_url',
    'thumbnailUrl',
    'thumbnail',
    'thumb_url',
    'thumbUrl',
    'small_preview_url',
  ]) || previewUrl;

  return {
    id: pickFirst(resource, ['id', 'resource_id', 'resourceId']),
    title: pickFirst(resource, ['title', 'name', 'description']) || 'Untitled Vecteezy resource',
    contentType: pickFirst(resource, ['content_type', 'contentType', 'resource_type', 'resourceType']),
    licenseType: pickFirst(resource, ['license_type', 'licenseType', 'license']),
    thumbnailUrl,
    previewUrl,
    width: pickFirst(resource, ['width', 'image_width']),
    height: pickFirst(resource, ['height', 'image_height']),
    url: pickFirst(resource, ['html_url', 'htmlUrl', 'page_url', 'pageUrl']),
    source: 'vecteezy',
  };
}

function normalizeResourceList(data = {}) {
  const resources = Array.isArray(data.resources)
    ? data.resources
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.data)
        ? data.data
        : [];

  return {
    page: data.page || data.current_page || 1,
    perPage: data.per_page || data.perPage || resources.length,
    lastPage: data.last_page || data.total_pages || null,
    totalResources: data.total_resources || data.total_result_count || null,
    items: resources.map(normalizeResource),
  };
}

function buildSearchParams(query = {}) {
  const term = normalizeString(query.q || query.term);
  if (!term) {
    const error = new Error('Search term is required');
    error.status = 400;
    throw error;
  }

  const contentType = validateContentType(query.contentType || query.content_type);
  const params = {
    term,
    content_type: contentType,
    page: parsePositiveInt(query.page, 1),
    per_page: parsePositiveInt(query.perPage || query.per_page, DEFAULT_PER_PAGE, MAX_PER_PAGE),
    family_friendly: parseBoolean(query.familyFriendly || query.family_friendly) ?? true,
    ai_generated: parseBoolean(query.aiGenerated || query.ai_generated),
    print_friendly: parseBoolean(query.printFriendly || query.print_friendly),
    print_friendly_basic: parseBoolean(query.printFriendlyBasic || query.print_friendly_basic),
  };

  const sortBy = normalizeString(query.sortBy || query.sort_by);
  if (sortBy) {
    if (!VALID_SORTS.has(sortBy)) {
      const error = new Error('sortBy must be relevance or newest');
      error.status = 400;
      throw error;
    }
    params.sort_by = sortBy;
  }

  const licenseType = normalizeString(query.licenseType || query.license_type);
  if (licenseType) {
    if (!VALID_LICENSE_TYPES.has(licenseType)) {
      const error = new Error('licenseType must be commercial or editorial');
      error.status = 400;
      throw error;
    }
    params.license_type = licenseType;
  }

  const orientation = normalizeString(query.orientation);
  if (orientation) {
    if (!VALID_ORIENTATIONS.has(orientation)) {
      const error = new Error('orientation must be horizontal, vertical, square, or panoramic');
      error.status = 400;
      throw error;
    }
    params.orientation = orientation;
  }

  const color = normalizeString(query.color);
  if (color) params.color = color;

  return params;
}

async function searchResources(query) {
  const params = buildSearchParams(query);
  const accountId = getAccountId();
  const { data, quota } = await vecteezyRequest(`/v2/${encodeURIComponent(accountId)}/resources`, params);

  return {
    ...normalizeResourceList(data),
    query: {
      term: params.term,
      contentType: params.content_type,
      page: params.page,
      perPage: params.per_page,
    },
    quota,
  };
}

async function getResource(resourceId) {
  const id = parsePositiveInt(resourceId, null);
  if (!id) {
    const error = new Error('A valid numeric Vecteezy resource id is required');
    error.status = 400;
    throw error;
  }

  const accountId = getAccountId();
  const { data, quota } = await vecteezyRequest(`/v2/${encodeURIComponent(accountId)}/resources/${id}`);
  return {
    item: normalizeResource(data.resource || data),
    quota,
  };
}

async function getSimilarResources(resourceId, query = {}) {
  const id = parsePositiveInt(resourceId, null);
  if (!id) {
    const error = new Error('A valid numeric Vecteezy resource id is required');
    error.status = 400;
    throw error;
  }

  const accountId = getAccountId();
  const { data, quota } = await vecteezyRequest(`/v2/${encodeURIComponent(accountId)}/resources/${id}/similar_images`, {
    page: parsePositiveInt(query.page, 1),
    per_page: parsePositiveInt(query.perPage || query.per_page, DEFAULT_PER_PAGE, MAX_PER_PAGE),
  });

  return {
    ...normalizeResourceList(data),
    quota,
  };
}

async function getAccountInfo(months = 1) {
  const accountId = getAccountId();
  const { data } = await vecteezyRequest(`/v2/${encodeURIComponent(accountId)}/account/info`, {
    months: parsePositiveInt(months, 1, 6),
  });
  return data;
}

module.exports = {
  getAccountInfo,
  getResource,
  getSimilarResources,
  searchResources,
};
