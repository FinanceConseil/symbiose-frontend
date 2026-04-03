import { JWT, BACKEND_URL } from './state.js';

function isFormDataBody(body) {
    return typeof FormData !== 'undefined' && body instanceof FormData;
}

export function buildApiUrl(path) {
    return BACKEND_URL + path;
}

export function buildAuthHeaders({ body = null, headers = {} } = {}) {
    const finalHeaders = Object.assign({ 'Authorization': 'Bearer ' + JWT }, headers);
    if (body && !isFormDataBody(body) && !finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/json';
    }
    return finalHeaders;
}

export async function apiFetch(path, options = {}) {
    const headers = buildAuthHeaders({
        body: options.body ?? null,
        headers: options.headers || {},
    });
    const response = await fetch(buildApiUrl(path), Object.assign({}, options, { headers }));
    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error('HTTP ' + response.status + ' : ' + text);
    }
    return response;
}

export async function createConversation({ agentId, title = '' }) {
    const response = await apiFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
            agent_id: agentId,
            title: title.slice(0, 100) || undefined,
        }),
    });
    return response.json();
}
