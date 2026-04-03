/**
 * Conversation management module — list, select, rename, delete, favorites.
 * Receives its dependencies via init() to avoid circular imports.
 */

import { state } from './state.js';
import { escHtml, spinnerSvg } from './utils.js';
import { loadConversationTimeline } from './conversation-loader.js';

// ── Injected dependencies ─────────────────────────────────────────────────────

let _apiFetch, _docs, _messaging, _agentPicker;
let _elConvList, _elWelcome;
let _setConvInUrl, _updateAgentMeta, _updateWorkflowUI, _resetWorkflowState;
let _scrollToBottom, _closeSidebarIfMobile;
let _updateSendBtn;

export function init(deps) {
    _apiFetch              = deps.apiFetch;
    _docs                  = deps.docs;
    _messaging             = deps.messaging;
    _agentPicker           = deps.agentPicker;
    _elConvList            = deps.elConvList;
    _elWelcome             = deps.elWelcome;
    _setConvInUrl          = deps.setConvInUrl;
    _updateAgentMeta       = deps.updateAgentMeta;
    _updateWorkflowUI      = deps.updateWorkflowUI;
    _resetWorkflowState    = deps.resetWorkflowState;
    _scrollToBottom        = deps.scrollToBottom;
    _closeSidebarIfMobile  = deps.closeSidebarIfMobile;
    _updateSendBtn         = deps.updateSendBtn;
}

// ── Fetch & render ────────────────────────────────────────────────────────────

export async function fetchConversations() {
    try {
        const res = await _apiFetch('/api/conversations');
        state.conversations = await res.json();
        renderSidebar();
    } catch (err) {
        console.error('[FCC] fetchConversations:', err);
        if (_elConvList) _elConvList.innerHTML = '<p class="symbiose-list-placeholder">Erreur de chargement</p>';
    }
}

function renderSidebar() {
    _elConvList.innerHTML = '';
    closeConvMenu();

    if (!state.conversations.length) {
        _elConvList.innerHTML = '<p class="symbiose-list-placeholder">Aucune conversation</p>';
        return;
    }

    const favorites = state.conversations.filter((c) => c.is_favorite);
    const recents   = state.conversations.filter((c) => !c.is_favorite);

    function makeConvItem(conv) {
        const item = document.createElement('div');
        const isStreaming = state.streamingConversations.has(conv.id) || conv.streaming_status;
        item.className = 'symbiose-conv-item'
            + (conv.id === state.currentConversationId ? ' symbiose-conv-item--active' : '')
            + (isStreaming ? ' symbiose-conv-item--streaming' : '');
        item.dataset.id = conv.id;
        item.innerHTML =
            '<span class="symbiose-conv-title">' + escHtml(conv.title || ('Conversation ' + conv.id)) + '</span>'
            + (isStreaming ? '<span class="symbiose-conv-item__loader">' + spinnerSvg(14) + '</span>' : '')
            + '<button class="symbiose-conv-menu-btn" title="Actions">···</button>';
        item.querySelector('.symbiose-conv-title').addEventListener('click', () => selectConversation(conv.id));
        item.querySelector('.symbiose-conv-menu-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openConvMenu(conv, item.querySelector('.symbiose-conv-menu-btn'));
        });
        return item;
    }

    if (favorites.length) {
        const heading = document.createElement('h3');
        heading.className = 'symbiose-sidebar-heading';
        heading.textContent = 'Favoris';
        _elConvList.appendChild(heading);
        favorites.forEach((conv) => _elConvList.appendChild(makeConvItem(conv)));
    }

    const recentHeading = document.createElement('h3');
    recentHeading.className = 'symbiose-sidebar-heading';
    recentHeading.textContent = 'Récents';
    _elConvList.appendChild(recentHeading);

    if (recents.length) {
        recents.forEach((conv) => _elConvList.appendChild(makeConvItem(conv)));
    } else {
        const placeholder = document.createElement('p');
        placeholder.className = 'symbiose-list-placeholder';
        placeholder.textContent = 'Aucune conversation récente';
        _elConvList.appendChild(placeholder);
    }
}

// ── Per-conversation streaming indicator (surgical update, no full re-render) ─

export function updateConvIndicator(convId) {
    if (!_elConvList) return;
    const item = _elConvList.querySelector(`.symbiose-conv-item[data-id="${convId}"]`);
    if (!item) return;
    const conv = state.conversations.find((c) => c.id === convId);
    const isStreaming = state.streamingConversations.has(convId) || !!conv?.streaming_status;
    const existingLoader = item.querySelector('.symbiose-conv-item__loader');
    if (isStreaming && !existingLoader) {
        item.classList.add('symbiose-conv-item--streaming');
        const loader = document.createElement('span');
        loader.className = 'symbiose-conv-item__loader';
        loader.innerHTML = spinnerSvg(14);
        const menuBtn = item.querySelector('.symbiose-conv-menu-btn');
        item.insertBefore(loader, menuBtn);
    } else if (!isStreaming && existingLoader) {
        item.classList.remove('symbiose-conv-item--streaming');
        existingLoader.remove();
    }
}

export function setConversationActive(convId) {
    state.currentConversationId = convId;
    _agentPicker.setDisabled(true);
    document.querySelectorAll('.symbiose-conv-item').forEach((btn) => {
        btn.classList.toggle('symbiose-conv-item--active', parseInt(btn.dataset.id) === convId);
    });
}

// ── Context menu ──────────────────────────────────────────────────────────────

function openConvMenu(conv, anchorEl) {
    closeConvMenu();
    const menu = document.createElement('div');
    menu.id = 'symbiose-active-conv-menu';
    const favLabel = conv.is_favorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
    menu.innerHTML =
        '<button class="symbiose-conv-menu__item" data-action="favorite">' + escHtml(favLabel) + '</button>'
        + '<button class="symbiose-conv-menu__item" data-action="rename">Renommer</button>'
        + '<button class="symbiose-conv-menu__item symbiose-conv-menu__item--danger" data-action="delete">Supprimer</button>';
    menu.querySelector('[data-action="favorite"]').addEventListener('click', () => { closeConvMenu(); toggleFavorite(conv); });
    menu.querySelector('[data-action="rename"]').addEventListener('click',   () => { closeConvMenu(); startRename(conv); });
    menu.querySelector('[data-action="delete"]').addEventListener('click',   () => { closeConvMenu(); deleteConversation(conv.id); });

    document.getElementById('symbiose-app').appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const appRect = document.getElementById('symbiose-app').getBoundingClientRect();
    menu.style.top  = (rect.bottom - appRect.top  + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left   - appRect.left + window.scrollX)      + 'px';
}

export function closeConvMenu() {
    document.getElementById('symbiose-active-conv-menu')?.remove();
}

// ── CRUD actions ──────────────────────────────────────────────────────────────

async function toggleFavorite(conv) {
    try {
        await _apiFetch('/api/conversations/' + conv.id, {
            method: 'PATCH',
            body: JSON.stringify({ is_favorite: !conv.is_favorite })
        });
        await fetchConversations();
    } catch (err) {
        console.error('[FCC] toggleFavorite:', err);
    }
}

function startRename(conv) {
    const titleEl = _elConvList.querySelector(`.symbiose-conv-item[data-id="${conv.id}"] .symbiose-conv-title`);
    if (!titleEl) return;
    const input = document.createElement('input');
    input.className = 'symbiose-conv-rename-input';
    input.value = conv.title || '';
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = async () => {
        if (committed) return;
        committed = true;
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== conv.title) {
            try {
                await _apiFetch('/api/conversations/' + conv.id, {
                    method: 'PATCH',
                    body: JSON.stringify({ title: newTitle })
                });
            } catch (err) {
                console.error('[FCC] startRename commit:', err);
            }
        }
        await fetchConversations();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { input.blur(); }
        if (e.key === 'Escape') { committed = true; fetchConversations(); }
    });
}

export async function deleteConversation(id) {
    try {
        await _apiFetch('/api/conversations/' + id, { method: 'DELETE' });
        if (state.currentConversationId === id) {
            state.currentConversationId = null;
            _messaging.clearMessages();
            if (_elWelcome) _elWelcome.style.display = '';
            _agentPicker.setDisabled(false);
        }
        await fetchConversations();
    } catch (err) {
        console.error('[FCC] deleteConversation:', err);
    }
}

export async function selectConversation(id) {
    // Ne pas avorter un stream en cours — il continue en arrière-plan
    setConversationActive(id);
    state.isStreaming = false;
    _messaging.setStreamingButtons(false);
    _setConvInUrl(id);

    const conv = state.conversations.find((c) => c.id === id);
    if (conv?.agent_id) {
        state.currentAgentId = conv.agent_id;
        _agentPicker.setValue(conv.agent_id);
    } else {
        state.currentAgentId = _agentPicker.getValue() || null;
    }
    _updateAgentMeta();

    _closeSidebarIfMobile();
    _messaging.clearMessages();

    try {
        await loadConversationTimeline({
            conversationId: id,
            conversation: conv,
            apiFetch: _apiFetch,
            docs: _docs,
            messaging: _messaging,
            elMessages: document.getElementById('symbiose-messages'),
            elWelcome: _elWelcome,
            updateWorkflowUI: _updateWorkflowUI,
            updateSendBtn: _updateSendBtn,
            scrollToBottom: _scrollToBottom,
        });
    } catch (err) {
        console.error('[FCC] selectConversation:', err);
        _messaging.appendErrorBubble('Impossible de charger les messages.');
    }
}

export function startNewConversation({ elWelcome, agentPicker, slashMenu, resetWorkflowState, updateWorkflowUI, closeSidebarIfMobile, setConvInUrl } = {}) {
    // Ne pas avorter un stream en cours — il continue en arrière-plan
    state.currentConversationId = 0;
    state.isStreaming = false;
    _messaging.setStreamingButtons(false);
    _setConvInUrl(null);
    _agentPicker.setDisabled(false);
    _messaging.clearMessages();
    if (_elWelcome) _elWelcome.style.display = '';
    document.querySelectorAll('.symbiose-conv-item').forEach((btn) => {
        btn.classList.remove('symbiose-conv-item--active');
    });
    _resetWorkflowState();
    _updateWorkflowUI();
    _closeSidebarIfMobile();
}
