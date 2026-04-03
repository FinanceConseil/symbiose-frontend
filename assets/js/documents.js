// ── Panneau documents liés à la conversation ──────────────────────────────────
// Also handles pending file uploads (file selection, preview, one-file upload).

import { escHtml, spinnerSvg } from './utils.js';
import { state } from './state.js';
import { apiFetch, buildApiUrl, buildAuthHeaders } from './api-client.js';

let _apiFetch;
let _onDocsChange;
let _elUploadPreview;
let _elFileInput;
let _isWorkflowSetupActive;
let _renderWorkflowPanel;
let _updateSendBtn;
let _appendErrorBubble;
let currentDocs = [];

// ── État pending generation ───────────────────────────────────────────────────
let _pendingGeneration = null;  // { launchFn } | null
let _isOverBudget = false;      // état courant jauge (pour bloquer Send)

// Accepted MIME types (mirrors backend ALLOWED_MIMETYPES in src/config/mime-types.js)
const ALLOWED_TYPES = [
    // Documents
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'application/epub+zip',
    'application/xml',
    'text/xml',
    'application/rtf',
    'text/rtf',
    'application/vnd.oasis.opendocument.text',
    // Images
    'image/jpeg',
    'image/png',
    'image/avif',
    'image/tiff',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/webp',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function init({ apiFetch, onDocsChange, elUploadPreview, elFileInput, isWorkflowSetupActive, renderWorkflowPanel, updateSendBtn, appendErrorBubble }) {
    _apiFetch              = apiFetch;
    _onDocsChange          = onDocsChange ?? null;
    _elUploadPreview       = elUploadPreview ?? null;
    _elFileInput           = elFileInput ?? null;
    _isWorkflowSetupActive = isWorkflowSetupActive ?? null;
    _renderWorkflowPanel   = renderWorkflowPanel ?? null;
    _updateSendBtn         = updateSendBtn ?? null;
    _appendErrorBubble     = appendErrorBubble ?? null;
}

export function setUploadEnabled(enabled) {
    const label = document.getElementById('symbiose-upload-label');
    if (!label) return;
    label.classList.toggle('symbiose-upload-label--disabled', !enabled);
    label.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

export function getCurrentDocs() {
    return currentDocs;
}

// ── Chargement ────────────────────────────────────────────────────────────────

export async function fetchDocumentsRaw(convId) {
    if (!convId || convId === 0) return [];
    try {
        const res  = await _apiFetch('/api/conversations/' + convId + '/documents');
        const data = await res.json();
        return data.documents || data || [];
    } catch (err) {
        console.error('[FCC] fetchDocumentsRaw:', err);
        return [];
    }
}

// ── Composants DOM ────────────────────────────────────────────────────────────

export function createDocLoader(filename) {
    const el = document.createElement('div');
    el.className = 'symbiose-doc-card symbiose-doc-card--loading';
    el.innerHTML = '<div class="symbiose-doc-card__header">'
        + spinnerSvg()
        + '<span>' + escHtml(filename) + '</span>'
        + '</div>';
    return el;
}

export function createDocCard(doc, { simple = false } = {}) {
    const card = document.createElement('div');
    card.className = 'symbiose-doc-card';
    card.dataset.docId = doc.id;

    const pages   = doc.page_count ? doc.page_count + ' page' + (doc.page_count > 1 ? 's' : '') : '';
    const ocrText = doc.ocr_text || '';

    card.innerHTML = '<div class="symbiose-doc-card__header">'
        + '<span>📄 ' + escHtml(doc.name || doc.filename || 'Document') + '</span>'
        + '<div class="symbiose-doc-card__actions">'
        + (pages ? '<span class="symbiose-doc-card__meta">' + escHtml(pages) + '</span>' : '')
        + '</div>'
        + '</div>'
        + (ocrText
            ? '<details class="symbiose-doc-card__details">'
              + '<summary>Voir le texte extrait</summary>'
              + '<div class="symbiose-doc-card__ocr">' + escHtml(ocrText) + '</div>'
              + '</details>'
            : '');

    if (simple) return card;

    // Toggle inject_full
    const injectWrap = document.createElement('label');
    injectWrap.className = 'symbiose-doc-inject-toggle';
    const injectTipText = doc.inject_full
        ? 'Contexte complet activé — désactiver pour utiliser la recherche sémantique (moins de tokens)'
        : 'Injecter le document entier dans le contexte — réponses plus précises, mais consomme plus de tokens';
    injectWrap.innerHTML =
        '<input type="checkbox" class="symbiose-doc-inject-toggle__input"'
        + (doc.inject_full ? ' checked' : '')
        + '>'
        + '<span class="symbiose-doc-inject-toggle__track"><span class="symbiose-doc-inject-toggle__thumb"></span></span>'
        + '<span class="symbiose-doc-inject-toggle__label">Contexte complet</span>'
        + '<span class="symbiose-doc-inject-tip">' + injectTipText + '</span>';

    injectWrap.querySelector('input').addEventListener('change', async (e) => {
        const newVal = e.target.checked;
        try {
            await _apiFetch('/api/conversations/' + state.currentConversationId + '/documents/' + doc.id, {
                method: 'PATCH',
                body: JSON.stringify({ inject_full: newVal })
            });
            doc.inject_full = newVal;
            currentDocs = currentDocs.map((currentDoc) => (
                currentDoc.id === doc.id
                    ? { ...currentDoc, inject_full: newVal }
                    : currentDoc
            ));
            // Synchroniser tous les toggles de ce document (flux + panel)
            const tipText = newVal
                ? 'Contexte complet activé — désactiver pour utiliser la recherche sémantique (moins de tokens)'
                : 'Injecter le document entier dans le contexte — réponses plus précises, mais consomme plus de tokens';
            document.querySelectorAll('.symbiose-doc-card[data-doc-id="' + doc.id + '"] .symbiose-doc-inject-toggle').forEach((lbl) => {
                const tip = lbl.querySelector('.symbiose-doc-inject-tip');
                if (tip) tip.textContent = tipText;
                const cb = lbl.querySelector('input');
                if (cb) cb.checked = newVal;
            });
            // Mettre à jour les jauges (panel + tous les conteneurs dans le flux)
            const panelBody = document.getElementById('symbiose-docs-panel-body');
            if (panelBody?._updatePanelGauge) panelBody._updatePanelGauge();
            document.querySelectorAll('.symbiose-doc-container').forEach((c) => {
                if (c._updateGauge) c._updateGauge();
            });
        } catch (err) {
            console.error('[FCC] inject_full toggle:', err);
            e.target.checked = !newVal; // rollback visuel
        }
    });
    card.querySelector('.symbiose-doc-card__actions').appendChild(injectWrap);

    return card;
}

// ── Mise à jour du panneau ────────────────────────────────────────────────────

export function updateDocsPanel(docs) {
    currentDocs = docs || [];
    const btn   = document.getElementById('symbiose-docs-btn');
    const count = document.getElementById('symbiose-docs-count');
    const panel = document.getElementById('symbiose-docs-panel');
    if (!btn) return;

    const hasDoc = currentDocs.length > 0;
    if (hasDoc) {
        btn.removeAttribute('hidden');
    } else {
        btn.setAttribute('hidden', '');
        // Fermer le panel si plus aucun document
        panel.classList.remove('symbiose-docs-panel--open');
        btn.classList.remove('symbiose-docs-btn--active');
    }
    count.textContent = hasDoc ? String(currentDocs.length) : '';

    // Synchroniser les toggles inject_full dans le flux (ex: après reset par le runner)
    for (const doc of currentDocs) {
        document.querySelectorAll('.symbiose-doc-card[data-doc-id="' + doc.id + '"] .symbiose-doc-inject-toggle__input').forEach((cb) => {
            if (cb.checked !== !!doc.inject_full) {
                cb.checked = !!doc.inject_full;
                const tip = cb.closest('.symbiose-doc-inject-toggle')?.querySelector('.symbiose-doc-inject-tip');
                if (tip) {
                    tip.textContent = doc.inject_full
                        ? 'Contexte complet activé — désactiver pour utiliser la recherche sémantique (moins de tokens)'
                        : 'Injecter le document entier dans le contexte — réponses plus précises, mais consomme plus de tokens';
                }
            }
        });
    }
    document.querySelectorAll('.symbiose-doc-container').forEach((c) => {
        if (c._updateGauge) c._updateGauge();
    });

    // Re-rendre si le panel est ouvert
    if (panel.classList.contains('symbiose-docs-panel--open')) {
        renderDocsPanel();
    }

    _onDocsChange?.();
}

export async function renderDocsPanel() {
    const body = document.getElementById('symbiose-docs-panel-body');
    if (!body) return;
    body.innerHTML = '';
    body._updatePanelGauge = null;

    const intro = document.createElement('div');
    intro.className = 'symbiose-docs-panel__intro';
    intro.innerHTML =
        '<p>Cochez les documents à prendre en compte intégralement pour la prochaine réponse. Si un document n’est pas coché, l’assistant n’en charge pas tout le contenu: il ira seulement y chercher les passages utiles au moment de répondre. Le contexte complet est plus précis, mais aussi plus coûteux en tokens.</p>';
    body.appendChild(intro);

    if (!currentDocs.length) {
        const empty = document.createElement('p');
        empty.style.color = 'var(--symbiose-text-muted)';
        empty.style.fontSize = '13px';
        empty.style.textAlign = 'center';
        empty.style.marginTop = '16px';
        empty.textContent = 'Aucun document';
        body.appendChild(empty);
        return;
    }

    // ── Jauge de contexte ───────────────────────────────────────────────────
    let budgetData = null;
    if (state.currentConversationId && state.currentAgentId) {
        try {
            const res = await _apiFetch(
                '/api/conversations/' + state.currentConversationId
                + '/context-budget?agentId=' + encodeURIComponent(state.currentAgentId)
            );
            budgetData = await res.json();
        } catch { /* silently ignore — gauge just won't render */ }
    }

    if (budgetData) {
        const gaugeWrap = document.createElement('div');
        gaugeWrap.className = 'symbiose-docs-panel__gauge-wrap';
        const gaugeBar = document.createElement('div');
        gaugeBar.className = 'symbiose-ctx-overflow__gauge-bar';
        const gaugeFill = document.createElement('div');
        gaugeFill.className = 'symbiose-ctx-overflow__gauge-fill';
        gaugeBar.appendChild(gaugeFill);
        const gaugeLabel = document.createElement('span');
        gaugeLabel.className = 'symbiose-ctx-overflow__gauge-label';
        gaugeWrap.appendChild(gaugeBar);
        gaugeWrap.appendChild(gaugeLabel);
        body.appendChild(gaugeWrap);

        // Build a token map from budget endpoint data
        const tokenMap = new Map();
        for (const d of budgetData.docs) tokenMap.set(d.id, d.estimated_tokens);

        const updatePanelGauge = () => {
            let used = 0;
            for (const doc of currentDocs) {
                if (doc.inject_full) used += (tokenMap.get(doc.id) ?? 0);
            }
            const budget = budgetData.availableBudget;
            const pct = Math.min(100, Math.round(used / budget * 100));
            gaugeFill.style.width = pct + '%';
            gaugeFill.classList.toggle('symbiose-ctx-overflow__gauge-fill--over', used > budget);
            const usedK = Math.round(used / 100) / 10;
            const budK  = Math.round(budget / 100) / 10;
            gaugeLabel.textContent = `${usedK}k / ${budK}k tokens en contexte complet`;
            _isOverBudget = used > budget;
            _renderPanelFooter();
            _updateSendBtn?.();
        };
        updatePanelGauge();

        // Store updater so toggle handler can call it
        body._updatePanelGauge = updatePanelGauge;
    }

    currentDocs.forEach((doc) => body.appendChild(createDocCard(doc)));
}

// ── Pending files (pre-send queue) ────────────────────────────────────────────

export function handleFileSelect(e) {
    const incoming = Array.from(e.target.files);
    if (_elFileInput) _elFileInput.value = '';
    if (!incoming.length) return;

    const valid = [];
    for (const file of incoming) {
        if (!ALLOWED_TYPES.includes(file.type)) {
            alert(escHtml(file.name) + ' : format non supporté.');
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            alert(escHtml(file.name) + ' dépasse 10 Mo.');
            continue;
        }
        valid.push(file);
    }
    const existingNames = state.pendingFiles.map((f) => f.name);
    state.pendingFiles = [...state.pendingFiles, ...valid.filter((f) => !existingNames.includes(f.name))];
    renderPendingFiles();
    if (_updateSendBtn) _updateSendBtn();
}

export function renderPendingFiles() {
    if (!_elUploadPreview) return;
    // In workflow mode, files are shown in the workflow panel, not the footer
    if (_isWorkflowSetupActive?.()) {
        _elUploadPreview.hidden = true;
        _elUploadPreview.innerHTML = '';
        _renderWorkflowPanel?.();
        return;
    }
    if (!state.pendingFiles.length) {
        _elUploadPreview.hidden = true;
        _elUploadPreview.innerHTML = '';
        return;
    }
    _elUploadPreview.hidden = false;
    _elUploadPreview.innerHTML = state.pendingFiles.map((f, i) =>
        '<span class="symbiose-pending-file">'
        + '<span class="symbiose-pending-file__name">' + escHtml(f.name) + '</span>'
        + '<button class="symbiose-pending-remove" data-idx="' + i + '" aria-label="Retirer">×</button>'
        + '</span>'
    ).join('');
    _elUploadPreview.querySelectorAll('.symbiose-pending-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.pendingFiles.splice(parseInt(btn.dataset.idx, 10), 1);
            renderPendingFiles();
            if (_updateSendBtn) _updateSendBtn();
        });
    });
}

export function clearPendingFiles() {
    state.pendingFiles = [];
    if (_elFileInput) _elFileInput.value = '';
    renderPendingFiles();
}

// ── Conteneur unifie de documents (flux de messages) ────────────────────────

/**
 * Creates a container wrapping doc cards (display mode only — inject_full toggles + gauge).
 *
 * @param {Object} opts
 * @param {Array}  opts.docs              - Document objects to display
 * @param {number} [opts.availableBudget] - Token budget (null = no gauge)
 * @param {Array}  [opts.budgetDocs]      - Docs with estimated_tokens from budget API
 * @param {string}  [opts.title]          - Optional header
 * @param {string}  [opts.description]    - Optional description
 * @returns {HTMLElement}
 */
export function createDocContainer({ docs: containerDocs, title, description }) {
    const container = document.createElement('div');
    container.className = 'symbiose-doc-container';

    if (title) {
        const h = document.createElement('div');
        h.className = 'symbiose-doc-container__header';
        h.textContent = title;
        container.appendChild(h);
    }
    if (description) {
        const p = document.createElement('p');
        p.className = 'symbiose-doc-container__desc';
        p.textContent = description;
        container.appendChild(p);
    }

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'symbiose-doc-container__cards';
    for (const doc of containerDocs) {
        cardsWrap.appendChild(createDocCard(doc, { simple: true }));
    }
    container.appendChild(cardsWrap);

    return container;
}

// ── Pending generation (panel latéral) ───────────────────────────────────────

export function setPendingGeneration(launchFn) {
    _pendingGeneration = { launchFn };
    _renderPanelFooter();
}

export function clearPendingGeneration() {
    _pendingGeneration = null;
    _renderPanelFooter();
}

export function isOverBudget() { return _isOverBudget; }

export function openPanel() {
    const panel = document.getElementById('symbiose-docs-panel');
    const btn   = document.getElementById('symbiose-docs-btn');
    if (!panel || !btn) return;
    panel.classList.add('symbiose-docs-panel--open');
    panel.inert = false;
    btn.classList.add('symbiose-docs-btn--active');
    renderDocsPanel();
}

function _renderPanelFooter() {
    const footer = document.getElementById('symbiose-docs-panel-footer');
    if (!footer) return;
    footer.innerHTML = '';
    if (!_pendingGeneration) return;
    const btn = document.createElement('button');
    btn.className = 'symbiose-wf-nav-btn symbiose-wf-nav-btn--primary symbiose-docs-panel__generate-btn';
    btn.textContent = 'Générer →';
    btn.disabled = _isOverBudget;
    if (_isOverBudget) btn.title = 'Réduisez le contexte complet pour pouvoir générer';
    btn.addEventListener('click', () => {
        if (_isOverBudget) return;
        const panel = document.getElementById('symbiose-docs-panel');
        const docsBtn = document.getElementById('symbiose-docs-btn');
        if (panel) { panel.classList.remove('symbiose-docs-panel--open'); panel.inert = true; }
        if (docsBtn) docsBtn.classList.remove('symbiose-docs-btn--active');
        _pendingGeneration.launchFn();
    });
    footer.appendChild(btn);
}

/**
 * Upload a single file to the current conversation.
 * Returns the first created document object, or null on error.
 */
export async function uploadOneFile(file, conversationId = state.currentConversationId, { shouldReportError = () => true } = {}) {
    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch(
            buildApiUrl('/api/conversations/' + conversationId + '/documents/upload'),
            {
                method:  'POST',
                headers: buildAuthHeaders({ body: fd }),
                body:    fd,
            }
        );
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error?.message || 'Upload HTTP ' + res.status);
        }
        const data = await res.json();
        return (data.documents || [])[0] ?? null;
    } catch (err) {
        console.error('[FCC] uploadOneFile:', err);
        if (_appendErrorBubble && shouldReportError()) {
            _appendErrorBubble('Erreur upload ' + escHtml(file.name) + ' : ' + err.message);
        }
        return null;
    }
}
