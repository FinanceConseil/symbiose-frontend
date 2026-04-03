// ── Pipeline de messages : rendu, SSE, outils ─────────────────────────────────

import { escHtml, truncate, spinnerSvg, checkSvg } from './utils.js';
import { state } from './state.js';
import { buildApiUrl, buildAuthHeaders } from './api-client.js';
import { renderMarkdown, renderContent, renderMermaidToCache, restoreMermaidFromCache } from './render.js';
import { addMessageActions } from './export.js';
import { updateDocsPanel } from './documents.js';
import { getForceTool, getForceSkill } from './slash-menu.js';
import * as agentPicker from './agent-picker.js';

// ── Dépendances injectées ─────────────────────────────────────────────────────

let _elMessages;
let _elStopBtn;
let _elSendBtn;
let _elWelcome;     // référence à l'élément welcome courant (re-appendé après clearMessages)
let _apiFetch;
let _fetchConversations;
let _scrollToBottom;
let _updateContextGauge;
let _onDone;             // callback optionnel appelé après chaque événement SSE « done »
let _onDocumentsUpdated; // callback optionnel appelé quand des documents ont été ajoutés pendant l'agent loop
let _updateConvIndicator; // callback pour mettre à jour le spinner sidebar par conversation

// ── Registre des streams actifs (par conversation) ───────────────────────────
// Permet à plusieurs conversations de streamer en parallèle.
// Chaque StreamState garde une référence vers la bulle DOM (qui peut être
// détachée quand l'utilisateur change de conversation) et accumule le texte.
const activeStreams = new Map();   // convId → StreamState

export function init(deps) {
    ({
        elMessages:          _elMessages,
        elStopBtn:           _elStopBtn,
        elSendBtn:           _elSendBtn,
        elWelcome:           _elWelcome,
        apiFetch:            _apiFetch,
        fetchConversations:  _fetchConversations,
        scrollToBottom:      _scrollToBottom,
        updateContextGauge:  _updateContextGauge,
        onDone:              _onDone,
        onDocumentsUpdated:  _onDocumentsUpdated,
        updateConvIndicator: _updateConvIndicator,
    } = deps);
}

/** Retourne le StreamState d'une conversation en streaming, ou null. */
export function getActiveStream(convId) { return activeStreams.get(convId) ?? null; }

/** Retourne l'AbortController du stream de la conversation indiquée (ou la conversation courante). */
export function getAbortController(convId) {
    return activeStreams.get(convId ?? state.currentConversationId)?.abortController ?? null;
}

/** Bascule la visibilité des boutons stop/send (utilisé par conversations.js lors du reattach). */
export function setStreamingButtons(streaming) {
    if (_elSendBtn) _elSendBtn.hidden = !!streaming;
    if (_elStopBtn) _elStopBtn.hidden = !streaming;
}

// ── Utilitaires DOM ───────────────────────────────────────────────────────────

export function clearMessages() {
    _elMessages.innerHTML = '';
    updateDocsPanel([]);
    const gaugeEl = document.getElementById('symbiose-context-gauge');
    if (gaugeEl) gaugeEl.setAttribute('hidden', '');

    // Re-append le welcome original (innerHTML = '' l'a retiré du DOM)
    if (_elWelcome) {
        _elMessages.appendChild(_elWelcome);
        _elWelcome.style.display = '';
    }

    // Recreate the workflow container after clearing the messages area.
    let workflowPanel = document.getElementById('symbiose-workflow-panel');
    if (!workflowPanel) {
        workflowPanel = document.createElement('div');
        workflowPanel.id = 'symbiose-workflow-panel';
        workflowPanel.hidden = true;
        _elMessages.appendChild(workflowPanel);
    }
}

// ── Rendu des messages ────────────────────────────────────────────────────────

export async function renderMessage(role, content, { append = true } = {}) {
    if (_elWelcome) _elWelcome.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'symbiose-msg symbiose-msg--' + (role === 'user' ? 'user' : 'assistant');

    const roleLabel = document.createElement('div');
    roleLabel.className = 'symbiose-msg__role';
    roleLabel.textContent = role === 'user' ? 'Vous' : 'Assistant';

    const bubble = document.createElement('div');
    bubble.className = 'symbiose-msg__bubble';

    wrapper.appendChild(roleLabel);
    wrapper.appendChild(bubble);
    if (append) _elMessages.appendChild(wrapper); // append avant l'await pour maintenir l'ordre dans le DOM

    if (role === 'user') {
        bubble.textContent = content;
        addMessageActions(wrapper, role, content);
    } else {
        await renderContent(bubble, content);
        addMessageActions(wrapper, role, content);
    }
    return bubble;
}

export function createAssistantBubble(id, { append = true } = {}) {
    if (_elWelcome) _elWelcome.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'symbiose-msg symbiose-msg--assistant';
    wrapper.id = id;

    const roleLabel = document.createElement('div');
    roleLabel.className = 'symbiose-msg__role';
    roleLabel.textContent = 'Assistant';

    const bubble = document.createElement('div');
    bubble.className = 'symbiose-msg__bubble symbiose-streaming';

    const toolsZone = document.createElement('div');
    toolsZone.className = 'symbiose-tools-zone';

    wrapper.appendChild(roleLabel);
    wrapper.appendChild(bubble);
    wrapper.appendChild(toolsZone);
    if (append) _elMessages.appendChild(wrapper);

    return bubble;
}

export function appendErrorBubble(msg) {
    if (_elWelcome) _elWelcome.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'symbiose-msg symbiose-msg--error';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'symbiose-msg__role';
    roleLabel.textContent = 'Erreur';

    const bubble = document.createElement('div');
    bubble.className = 'symbiose-msg__bubble';
    bubble.textContent = msg;

    wrapper.appendChild(roleLabel);
    wrapper.appendChild(bubble);
    _elMessages.appendChild(wrapper);
    _scrollToBottom();
}

// ── Indicateurs d'outils ──────────────────────────────────────────────────────

// Retourne un Map<toolName, element> — un div par outil dans le batch.
export function appendToolStart(bubbleEl, data) {
    const tools = data.tools?.length ? data.tools : [{ name: data.tool || 'Outil', title: data.tool, input: data.input }];
    const toolsZone = bubbleEl.parentElement?.querySelector('.symbiose-tools-zone') || bubbleEl.parentElement;
    const map = new Map();

    for (const tool of tools) {
        const name  = tool.name  || 'Outil';
        const title = tool.title || name;
        // Extrait le premier indice textuel utile quelle que soit la clé du paramètre
        const rawHint = tool.input?.query ?? tool.input?.skillName ?? tool.input?.url
            ?? Object.values(tool.input ?? {}).find(v => typeof v === 'string') ?? null;
        const hint = typeof rawHint === 'string' ? rawHint : null;

        const toolEl = document.createElement('div');
        toolEl.className = 'symbiose-tool symbiose-tool--running';
        toolEl.dataset.toolName  = name;
        toolEl.dataset.toolTitle = title;
        if (hint) toolEl.dataset.toolHint = hint;
        toolEl.innerHTML = spinnerSvg()
            + '<span>'
            + escHtml(title)
            + (hint ? ' : <em>' + escHtml(truncate(hint, 100)) + '</em>' : '')
            + '</span>';

        toolsZone.appendChild(toolEl);
        map.set(tool.id ?? name, toolEl);
    }
    return map;
}

export function upgradeToolToResult(toolEl, data) {
    if (!toolEl) return;
    toolEl.classList.remove('symbiose-tool--running');

    const toolName  = toolEl.dataset.toolName  || 'Résultat';
    const toolTitle = toolEl.dataset.toolTitle || toolName;
    const raw = data.output ?? data.result ?? data.content ?? null;

    let resultHtml;
    if (toolName === 'search_documents') {
        resultHtml = renderRagResults(raw);
    } else if (toolName === 'browse_web') {
        resultHtml = renderBrowseWebResult(raw);
    } else if (toolName === 'get_skill_content') {
        if (raw?.error) {
            resultHtml = '<div class="symbiose-tool__result-content"><em>' + escHtml(raw.error) + '</em></div>';
        } else if (raw?.file && raw.file !== 'SKILL.md') { // fichier complémentaire
            const extract = (raw.content ?? '').replace(/\s+/g, ' ').trim();
            resultHtml = '<div class="symbiose-tool__result-content">' + escHtml(truncate(extract, 140)) + '</div>';
        } else {
            const desc = raw?.description ?? raw?.skillName ?? 'Compétence chargée';
            resultHtml = '<div class="symbiose-tool__result-content">' + escHtml(desc) + '</div>';
        }
    } else {
        const resultStr = raw == null
            ? ''
            : typeof raw === 'string' ? raw : (JSON.stringify(raw, null, 2) ?? '');
        resultHtml = '<div class="symbiose-tool__result-content">' + escHtml(truncate(resultStr, 500)) + '</div>';
    }

    const toolHint = toolEl.dataset.toolHint || null;
    let summaryLabel;
    if (toolName === 'get_skill_content' && raw?.displayName) {
        const skillName = raw.displayName.charAt(0).toUpperCase() + raw.displayName.slice(1);
        const isSubFile = raw.file && raw.file !== 'SKILL.md'; // fichier complémentaire
        if (isSubFile) {
            const subName = raw.file.replace(/\.[^.]+$/, '').replace(/-/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            summaryLabel = escHtml(toolTitle) + ' — <em>' + escHtml(skillName + ' ' + subName) + '</em>';
        } else {
            summaryLabel = escHtml(toolTitle) + ' — <em>' + escHtml(skillName) + '</em>';
        }
    } else {
        summaryLabel = escHtml(toolTitle) + ' — <em>résultat disponible</em>';
    }
    toolEl.innerHTML = checkSvg()
        + '<details>'
        + '<summary><div class="symbiose-tool__summary-content">'
        + '<span>' + summaryLabel + '</span>'
        + (toolHint ? '<span class="symbiose-tool__summary-query">' + escHtml(truncate(toolHint, 120)) + '</span>' : '')
        + '</div></summary>'
        + resultHtml
        + '</details>';
}

function renderBrowseWebResult(result) {
    if (!result || result.error) {
        return '<div class="symbiose-tool__result-content"><em>'
            + escHtml(result?.error || 'Résultat indisponible')
            + '</em></div>';
    }

    const title = (result.title || '').trim() || 'Page web';
    const markdown = typeof result.markdown === 'string' && result.markdown.trim()
        ? result.markdown
        : 'Aucun contenu récupéré.';

    return '<div class="symbiose-tool__browse-result">'
        + '<div class="symbiose-tool__browse-title">' + escHtml(title) + '</div>'
        + '<div class="symbiose-tool__browse-markdown">' + escHtml(markdown) + '</div>'
        + '</div>';
}

export function renderRagResults(result) {
    if (!result?.results?.length) {
        return '<div class="symbiose-tool__result-content"><em>'
            + escHtml(result?.message || 'Aucun résultat')
            + '</em></div>';
    }
    return '<div class="symbiose-rag-results">'
        + result.results.map((r) =>
            '<div class="symbiose-rag-result">'
            + '<div class="symbiose-rag-meta">'
            + '<span class="symbiose-rag-file">📄 ' + escHtml(r.filename) + '</span>'
            + '<span class="symbiose-rag-sim">' + Math.round(r.similarity * 100) + '%</span>'
            + '</div>'
            + '<blockquote class="symbiose-rag-excerpt">' + escHtml(truncate(r.excerpt, 300)) + '</blockquote>'
            + '</div>'
        ).join('')
        + '</div>';
}

// ── Streaming SSE ─────────────────────────────────────────────────────────────
function activateConversationItem(convId) {
    agentPicker.setDisabled(true);
    document.querySelectorAll('.symbiose-conv-item').forEach((btn) => {
        btn.classList.toggle('symbiose-conv-item--active', parseInt(btn.dataset.id) === convId);
    });
}

function createStreamState(convId, bubbleEl, abortController = new AbortController()) {
    return {
        abortController,
        convId,
        wrapperEl: bubbleEl.closest('.symbiose-msg'),
        bubbleEl,
        accumulated: '',
        mermaidCache: new Map(),
        hasError: false,
    };
}

function registerStream(streamState) {
    activeStreams.set(streamState.convId, streamState);
    if (streamState.convId) {
        state.streamingConversations.add(streamState.convId);
        _updateConvIndicator?.(streamState.convId);
    }
}

function unregisterStream(convId) {
    activeStreams.delete(convId);
    if (convId) {
        markConversationStreamInactive(convId);
    }
}

function markConversationStreamInactive(convId) {
    if (!convId) return;
    state.streamingConversations.delete(convId);
    const localConv = state.conversations.find((conversation) => conversation.id === convId);
    if (localConv) {
        localConv.streaming_status = null;
    }
    _updateConvIndicator?.(convId);
}

function isViewingStream(streamState) {
    return streamState.bubbleEl.isConnected;
}

function refreshMermaidPreview(streamState, mermaidAttempted) {
    const bubbleEl = streamState.bubbleEl;
    restoreMermaidFromCache(bubbleEl, streamState.mermaidCache);
    for (const [, src] of streamState.accumulated.matchAll(/```mermaid\n([\s\S]*?)\n```/g)) {
        const key = src.trim();
        if (!mermaidAttempted.has(key)) {
            mermaidAttempted.add(key);
            renderMermaidToCache(key, streamState.mermaidCache).then(() => {
                restoreMermaidFromCache(bubbleEl, streamState.mermaidCache);
                if (isViewingStream(streamState)) {
                    _scrollToBottom?.();
                }
            });
        }
    }
}

async function handleSseEvent(eventName, data, ctx) {
    const { streamState, mermaidAttempted, allowConversationCreated } = ctx;
    const bubbleEl = streamState.bubbleEl;
    const viewing = isViewingStream(streamState);

    switch (eventName) {
        case 'chunk':
            streamState.accumulated += data.text || '';
            bubbleEl.innerHTML = renderMarkdown(streamState.accumulated);
            bubbleEl.classList.add('symbiose-streaming');
            refreshMermaidPreview(streamState, mermaidAttempted);
            if (viewing) _scrollToBottom?.();
            break;

        case 'clear_text':
            streamState.accumulated = '';
            bubbleEl.innerHTML = '';
            break;

        case 'tool_start':
            ctx.lastToolEls = appendToolStart(bubbleEl, data);
            if (viewing) _scrollToBottom?.();
            break;

        case 'tool_result':
            upgradeToolToResult(ctx.lastToolEls?.get(data.id ?? data.name), data);
            if (viewing) _scrollToBottom?.();
            break;

        case 'conversation_created':
            if (!allowConversationCreated || !data.conversationId) break;

            unregisterStream(ctx.registrationConvId);
            streamState.convId = data.conversationId;
            ctx.registrationConvId = data.conversationId;
            registerStream(streamState);

            if (viewing) {
                state.currentConversationId = data.conversationId;
            }
            await _fetchConversations?.();
            if (viewing) {
                activateConversationItem(data.conversationId);
            }
            break;

        case 'documents_updated':
            _onDocumentsUpdated?.(data);
            if (viewing) _scrollToBottom?.();
            break;

        case 'done': {
            const finishedConvId = data.conversationId || streamState.convId;
            bubbleEl.classList.remove('symbiose-streaming');
            if (viewing) {
                _updateContextGauge?.(data.contextUsage);
                if (allowConversationCreated && data.conversationId && data.conversationId !== 0) {
                    state.currentConversationId = data.conversationId;
                    activateConversationItem(data.conversationId);
                }
            }
            markConversationStreamInactive(finishedConvId);
            _onDone?.(finishedConvId);
            break;
        }

        case 'error': {
            bubbleEl.classList.remove('symbiose-streaming');
            if (data.code === 'ABORTED') break;

            const errMsg = data.code === 'QUOTA_EXCEEDED'
                ? 'Quota dépassé — veuillez réessayer ultérieurement.'
                : data.code === 'MAX_ITERATIONS_EXCEEDED'
                    ? "L'agent a atteint le nombre maximum d'étapes."
                    : (data.message || data.error || 'Erreur inconnue');
            bubbleEl.innerHTML = '<span style="color:var(--symbiose-error-text)">Erreur : '
                + escHtml(errMsg) + '</span>';
            streamState.hasError = true;
            break;
        }
    }
}

async function consumeSseResponse(response, streamState, ctx) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
            }
            if (!line.startsWith('data: ')) {
                continue;
            }

            let data = {};
            try { data = JSON.parse(line.slice(6)); } catch { /* ignore malformed event payload */ }

            if (currentEvent && currentEvent !== 'chunk') {
                console.log('[FCC] SSE ←', currentEvent, data);
            }
            await handleSseEvent(currentEvent, data, ctx);
            currentEvent = '';
        }
    }
}

async function finalizeStream(streamState) {
    const finalConvId = streamState.convId;
    const viewing = isViewingStream(streamState);

    streamState.bubbleEl.classList.remove('symbiose-streaming');
    if (streamState.accumulated && !streamState.hasError) {
        await renderContent(streamState.bubbleEl, streamState.accumulated, streamState.mermaidCache);
    }

    const msgWrapper = streamState.bubbleEl.closest('.symbiose-msg');
    if (msgWrapper && streamState.accumulated && !streamState.hasError) {
        addMessageActions(msgWrapper, 'assistant', streamState.accumulated);
    }

    if (viewing) {
        if (_elStopBtn) _elStopBtn.hidden = true;
        if (_elSendBtn) _elSendBtn.hidden = false;
    }

    unregisterStream(finalConvId);
}

async function runStreamLifecycle(response, streamState, { allowConversationCreated = false, originalConvId = streamState.convId } = {}) {
    const ctx = {
        streamState,
        allowConversationCreated,
        originalConvId,
        registrationConvId: streamState.convId,
        lastToolEls: null,
        mermaidAttempted: new Set(),
    };

    try {
        await consumeSseResponse(response, streamState, ctx);
    } finally {
        await finalizeStream(streamState);
    }
}

// ── Reconnexion à un stream en cours après rechargement de page ───────────────

export async function rejoinStream(convId) {
    let response;
    try {
        response = await fetch(buildApiUrl('/api/conversations/' + convId + '/rejoin-stream'), {
            method: 'GET',
            headers: buildAuthHeaders({ headers: { 'Accept': 'text/event-stream' } }),
        });
    } catch {
        return false;
    }

    if (!response.ok) return false;

    const bubbleEl = createAssistantBubble('symbiose-bubble-rejoin-' + convId);
    const streamState = createStreamState(convId, bubbleEl);
    registerStream(streamState);

    if (_elSendBtn) _elSendBtn.hidden = true;
    if (_elStopBtn) _elStopBtn.hidden = false;
    if (isViewingStream(streamState)) _scrollToBottom?.(true);

    runStreamLifecycle(response, streamState, { allowConversationCreated: false, originalConvId: convId })
        .catch(console.error);

    return true;
}

export async function streamMessage(text, bubbleEl, { workflowMode = false, forcedDocIds = null, conversationId = state.currentConversationId } = {}) {
    const forceTool = getForceTool();
    const forceSkill = getForceSkill();
    const streamState = createStreamState(conversationId, bubbleEl, new AbortController());
    registerStream(streamState);

    if (isViewingStream(streamState)) {
        _elSendBtn.hidden = true;
        _elStopBtn.hidden = false;
    }

    try {
        const response = await fetch(
            buildApiUrl('/api/conversations/' + conversationId + '/agents/' + state.currentAgentId + '/run'),
            {
                method: 'POST',
                headers: buildAuthHeaders({
                    body: '{}',
                    headers: { 'Accept': 'text/event-stream' },
                }),
                body: JSON.stringify({
                    message: text,
                    ...(forceTool ? { forceTool: forceTool.id } : {}),
                    ...(forceSkill ? { forceSkill: forceSkill.id } : {}),
                    ...(workflowMode ? { workflowMode: true } : {}),
                    ...(forcedDocIds ? { forcedDocIds } : {}),
                }),
                signal: streamState.abortController.signal,
            }
        );

        if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            throw new Error('HTTP ' + response.status + ' : ' + errText);
        }

        await runStreamLifecycle(response, streamState, {
            allowConversationCreated: true,
            originalConvId: conversationId,
        });
    } catch (err) {
        if (!streamState.abortController.signal.aborted) {
            throw err;
        }
    }
}
