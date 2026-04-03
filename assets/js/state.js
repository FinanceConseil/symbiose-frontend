// ── État global partagé ───────────────────────────────────────────────────────
// Importé par référence : toute mutation est visible dans tous les modules.

export const state = {
    currentConversationId: 0,   // 0 = nouvelle conv non encore créée
    currentAgentId:        null,
    conversations:         [],
    agents:                [],
    isStreaming:            false,
    streamingConversations: new Set(),  // Set<number> — conversation IDs currently generating
    pendingFiles:          [],  // File[]
    workflowDone:          false,
    workflowStep:          0,   // Index du step courant (mode 'steps')
    workflowAnswers:       {},  // { [questionId]: string | string[] }
};

// ── Constantes globales ───────────────────────────────────────────────────────
const appRoot = document.getElementById('symbiose-app');
export const JWT = appRoot?.dataset.jwt || '';
export const BACKEND_URL = appRoot?.dataset.backendUrl || '';
export const GAUGE_CIRC  = 2 * Math.PI * 14; // périmètre du cercle SVG (r=14) ≈ 87.96
