/**
 * The single HTTP layer for the app. Every request carries the session cookie and
 * every failure becomes an ApiError with the server's code/message/details.
 */
const BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function toQuery(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request(method, path, { body, params } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}${toQuery(params)}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON response (e.g. proxy error page)
  }

  if (!res.ok || !payload?.success) {
    const err = payload?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Something went wrong. Please try again.', err?.details ?? []);
  }
  return payload.data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
  delete: (path) => request('DELETE', path),
};

/* ---------- Typed endpoint helpers (mirror server/src/routes/index.js) ---------- */
export const endpoints = {
  taxonomy: () => api.get('/taxonomy'),
  auth: {
    me: () => api.get('/auth/me'),
    login: (body) => api.post('/auth/login', body),
    register: (body) => api.post('/auth/register', body),
    logout: () => api.post('/auth/logout'),
  },
  creators: {
    list: (params) => api.get('/creators', params),
    get: (id) => api.get(`/creators/${id}`),
  },
  portfolio: {
    get: (id) => api.get(`/portfolio/${id}`),
  },
  campaigns: {
    list: (params) => api.get('/campaigns', params),
    categories: () => api.get('/campaigns/categories'),
    get: (id) => api.get(`/campaigns/${id}`),
    apply: (id, body) => api.post(`/campaigns/${id}/applications`, body),
  },
  creator: {
    profile: () => api.get('/creator/profile'),
    updateProfile: (body) => api.put('/creator/profile', body),
    portfolio: () => api.get('/creator/portfolio'),
    addPortfolio: (body) => api.post('/creator/portfolio', body),
    updatePortfolio: (id, body) => api.put(`/creator/portfolio/${id}`, body),
    deletePortfolio: (id) => api.delete(`/creator/portfolio/${id}`),
    applications: (params) => api.get('/creator/applications', params),
    withdraw: (id) => api.patch(`/creator/applications/${id}/withdraw`),
    invitations: (params) => api.get('/creator/invitations', params),
    respond: (id, status) => api.patch(`/creator/invitations/${id}/respond`, { status }),
    projects: (params) => api.get('/creator/projects', params),
    verifications: () => api.get('/creator/verifications'),
    createVerification: (body) => api.post('/creator/verifications', body),
    verificationChallenge: (tool) => api.post('/creator/verifications/challenge', { tool }),
    submitVerification: (id, body) => api.post(`/creator/verifications/${id}/submit`, body),
    updateVerification: (id, body) => api.put(`/creator/verifications/${id}`, body),
    deleteVerification: (id) => api.delete(`/creator/verifications/${id}`),
  },
  brand: {
    profile: () => api.get('/brand/profile'),
    updateProfile: (body) => api.put('/brand/profile', body),
    campaigns: (params) => api.get('/brand/campaigns', params),
    campaign: (id) => api.get(`/brand/campaigns/${id}`),
    createCampaign: (body) => api.post('/brand/campaigns', body),
    updateCampaign: (id, body) => api.put(`/brand/campaigns/${id}`, body),
    setCampaignStatus: (id, status) => api.patch(`/brand/campaigns/${id}/status`, { status }),
    campaignApplications: (id, params) => api.get(`/brand/campaigns/${id}/applications`, params),
    recommendations: (id) => api.get(`/brand/campaigns/${id}/recommendations`),
    applications: (params) => api.get('/brand/applications', params),
    reviewApplication: (id, status) => api.patch(`/brand/applications/${id}/status`, { status }),
    invite: (campaignId, body) => api.post(`/brand/campaigns/${campaignId}/invitations`, body),
    invitations: (params) => api.get('/brand/invitations', params),
    cancelInvitation: (id) => api.patch(`/brand/invitations/${id}/cancel`),
    projects: (params) => api.get('/brand/projects', params),
    draftBrief: (body) => api.post('/brand/briefs/draft', body),
    clients: () => api.get('/brand/clients'),
    createClient: (body) => api.post('/brand/clients', body),
    updateClient: (id, body) => api.put(`/brand/clients/${id}`, body),
    archiveClient: (id) => api.delete(`/brand/clients/${id}`),
    approvals: (params) => api.get('/brand/approvals', params),
    verification: () => api.get('/brand/verification'),
    checkDomain: (body) => api.post('/brand/verification/domain/check', body),
    domainCode: (body) => api.post('/brand/verification/domain/code', body),
    submitDomain: (body) => api.post('/brand/verification/domain/submit', body),
    submitBusiness: (body) => api.post('/brand/verification/business', body),
  },
  // Public, no login: the client's approval link (A3).
  approval: {
    get: (token) => api.get(`/approve/${token}`),
    decide: (token, body) => api.post(`/approve/${token}`, body),
  },
  uploads: {
    config: () => api.get('/uploads/config'),
    sas: (body) => api.post('/uploads/sas', body),
  },
  review: {
    list: (params) => api.get('/review/verifications', params),
    decide: (id, body) => api.patch(`/review/verifications/${id}`, body),
    brandList: (params) => api.get('/review/brand-verifications', params),
    brandDecide: (id, body) => api.patch(`/review/brand-verifications/${id}`, body),
  },
  projects: {
    get: (id) => api.get(`/projects/${id}`),
    setStatus: (id, status) => api.patch(`/projects/${id}/status`, { status }),
    createApprovalLink: (id, body) => api.post(`/projects/${id}/approval-links`, body),
    updateDeliverable: (id, deliverableId, body) => api.patch(`/projects/${id}/deliverables/${deliverableId}`, body),
    feedback: (id, body) => api.post(`/projects/${id}/feedback`, body),
    submitVersion: (id, deliverableId, body) => api.post(`/projects/${id}/deliverables/${deliverableId}/versions`, body),
    decide: (id, deliverableId, n, body) => api.post(`/projects/${id}/deliverables/${deliverableId}/versions/${n}/decision`, body),
    messages: (id, params) => api.get(`/projects/${id}/messages`, params),
    sendMessage: (id, body) => api.post(`/projects/${id}/messages`, body),
    markRead: (id) => api.post(`/projects/${id}/read`),
    rightsCard: (id) => api.get(`/projects/${id}/rights-card`),
  },
  me: {
    unread: () => api.get('/me/unread'),
  },
};

/**
 * Upload a file straight to Azure Blob Storage with a 15-minute URL from the API (the file never passes through
 * our server). XMLHttpRequest because fetch cannot report upload progress. Resolves with the saved file URL.
 */
export async function uploadFile(file, purpose, { onProgress, signal } = {}) {
  const { uploadUrl, blobUrl } = await endpoints.uploads.sas({ purpose, fileName: file.name, contentType: file.type, size: file.size });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, 'UPLOAD_FAILED', 'The upload did not finish. Try again, or paste a link instead.'));
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'The upload did not finish. Check your connection, or paste a link instead.'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  return blobUrl;
}
