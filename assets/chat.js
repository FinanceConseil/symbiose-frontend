/* ============================================================
   Symbiose — chat.js (point d'entrée / orchestrateur)
   Les domaines métier sont dans assets/js/ :
     workflow.js      — formulaire pas-à-pas avant envoi
     conversations.js — liste, sélection, CRUD conversations
     documents.js     — panneau docs + upload de fichiers en attente
     messaging.js     — flux SSE, rendu des messages
     agent-picker.js  — sélecteur d'agent
     slash-menu.js    — menu "/" pour tools/skills
     mic.js           — Speech-to-Text
     render.js        — Markdown / Mermaid
     export.js        — export PDF/DOCX
   ============================================================ */

import { state, JWT, BACKEND_URL, GAUGE_CIRC } from './js/state.js';
import { escHtml }                              from './js/utils.js';
import { apiFetch }                             from './js/api-client.js';
import { ensureConversationForGeneration, preparePendingFilesForGeneration } from './js/send-flow.js';
import * as docs         from './js/documents.js';
import * as slashMenu    from './js/slash-menu.js';
import * as messaging    from './js/messaging.js';
import * as mic          from './js/mic.js';
import * as agentPicker  from './js/agent-picker.js';
import * as workflow     from './js/workflow.js';
import * as conversations from './js/conversations.js';

// ── Références DOM ───────────────────────────────────────────────────────────
let elMessages, elInput, elSendBtn, elStopBtn, elAgentMeta,
    elConvList, elNewConvBtn, elFileInput,
    elUploadPreview, elFooter, elInputRow,
    elSidebar, elHamburger, elSidebarToggle, elSidebarBackdrop, elApp, elWelcome;

const WORKFLOW_LOCKED_PLACEHOLDER = 'Complétez le workflow ci-dessus pour démarrer la conversation.';

// ── Scroll tracking ───────────────────────────────────────────────────────────
let userScrolledUp       = false;
let lastScrollTop        = 0;
let isProgrammaticScroll = false;

function initScrollTracking() {
    elMessages.addEventListener('scroll', () => {
        if (isProgrammaticScroll) return;
        const st         = elMessages.scrollTop;
        const nearBottom = elMessages.scrollHeight - st - elMessages.clientHeight < 80;
        if (st < lastScrollTop)    userScrolledUp = true;
        else if (nearBottom)       userScrolledUp = false;
        lastScrollTop = st;
    });
}

function scrollToBottom(force = false) {
    if (force || !userScrolledUp) {
        isProgrammaticScroll = true;
        elMessages.scrollTop = elMessages.scrollHeight;
        lastScrollTop        = elMessages.scrollTop;
        isProgrammaticScroll = false;
        if (force) userScrolledUp = false;
    }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function updateSendBtn() {
    const hasText  = elInput.value.trim().length > 0;
    const hasAgent = !!state.currentAgentId;
    elSendBtn.disabled = isWorkflowSetupActive() || !(hasText && hasAgent) || state.isStreaming || docs.isOverBudget();
    const elMicBtn = document.getElementById('symbiose-mic-btn');
    if (elMicBtn) elMicBtn.disabled = state.isStreaming;
}

function autoResizeTextarea() {
    elInput.style.height = 'auto';
    elInput.style.height = Math.min(elInput.scrollHeight, 160) + 'px';
}

function showGlobalError(msg) {
    if (elMessages) {
        elMessages.innerHTML = '<p style="color:var(--symbiose-error-text);padding:20px">' + escHtml(msg) + '</p>';
    }
}

function isWorkflowSetupActive() {
    return !!workflow.getActiveAgent()?.workflow && !state.workflowDone;
}

function updatePromptBarState() {
    if (!elFooter || !elInputRow || !elInput) return;
    const locked = isWorkflowSetupActive();
    if (!elInput.dataset.defaultPlaceholder) {
        elInput.dataset.defaultPlaceholder = elInput.getAttribute('placeholder') || '';
    }
    elFooter.classList.toggle('symbiose-footer--workflow-locked', locked);
    elInputRow.classList.toggle('symbiose-input-row--workflow-locked', locked);
    elInput.disabled = locked;
    elInput.setAttribute('aria-disabled', locked ? 'true' : 'false');
    elInput.placeholder = locked ? WORKFLOW_LOCKED_PLACEHOLDER : elInput.dataset.defaultPlaceholder;
    if (locked) {
        elInput.blur();
        slashMenu.closeSlashMenu();
    }
    updateSendBtn();
}

function isMobileSidebarMode() {
    return window.innerWidth <= 640;
}

function syncSidebarDrawerState() {
    if (!elApp || !elSidebar) return;
    if (!isMobileSidebarMode()) {
        elSidebar.classList.remove('symbiose-sidebar--closed');
        elApp.classList.remove('symbiose-app--sidebar-open');
        return;
    }
    const open = isMobileSidebarMode() && !elSidebar.classList.contains('symbiose-sidebar--closed');
    elApp.classList.toggle('symbiose-app--sidebar-open', open);
}

function setSidebarOpen(open) {
    if (!elSidebar) return;
    elSidebar.classList.toggle('symbiose-sidebar--closed', !open);
    syncSidebarDrawerState();
}

function closeSidebarIfMobile() {
    if (!isMobileSidebarMode()) return;
    setSidebarOpen(false);
}

// ── URL — persistance de la conversation ──────────────────────────────────────

function getConvIdFromUrl() {
    const val = new URLSearchParams(window.location.search).get('conv');
    return val ? parseInt(val, 10) : null;
}

function setConvInUrl(id) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('conv', String(id));
    else     url.searchParams.delete('conv');
    history.pushState({ convId: id ?? null }, '', url);
}

// ── Quota sidebar ─────────────────────────────────────────────────────────────

function getDisplayNameFromJwt() {
    try {
        const payload = JSON.parse(atob(JWT.split('.')[1]));
        return payload.display_name || payload.email || '';
    } catch { return ''; }
}

async function fetchQuota() {
    try {
        const res  = await apiFetch('/api/me/quota');
        const data = await res.json();
        renderSidebarFooter(data);
    } catch (err) {
        console.error('[FCC] fetchQuota:', err);
    }
}

function renderSidebarFooter(quotaData) {
    const nameEl = document.getElementById('symbiose-user-name');
    const wrapEl = document.getElementById('symbiose-quota-bar-wrap');

    if (nameEl && !nameEl.textContent) {
        nameEl.textContent = getDisplayNameFromJwt();
    }

    if (!quotaData || !wrapEl) return;

    wrapEl.removeAttribute('hidden');

    const cost     = quotaData.cost     ?? null;
    const messages = quotaData.messages ?? null;

    // ── Barre budget journalier (principale) ────────────────────────────────
    const textEl = document.getElementById('symbiose-quota-text');
    const fillEl = document.getElementById('symbiose-quota-fill');

    if (cost && fillEl && textEl) {
        const today = cost.today ?? 0;
        const limitDay = cost.limit_day;
        if (limitDay != null && limitDay > 0) {
            const pct = Math.min(100, Math.round((today / limitDay) * 100));
            textEl.textContent = today.toFixed(2) + '$ / ' + limitDay.toFixed(2) + '$';
            fillEl.style.width = pct + '%';
            fillEl.className = 'symbiose-quota-fill'
                + (pct >= 90 ? ' symbiose-quota-fill--danger' : pct >= 70 ? ' symbiose-quota-fill--warn' : '');
        } else {
            textEl.textContent = today.toFixed(2) + '$';
            fillEl.style.width = '0%';
            fillEl.className = 'symbiose-quota-fill';
        }

        const tooltipEl  = document.getElementById('symbiose-quota-cost-tooltip');
        const tipWeekEl  = document.getElementById('symbiose-quota-tip-week');
        const tipMonthEl = document.getElementById('symbiose-quota-tip-month');
        if (tooltipEl && tipWeekEl && tipMonthEl) {
            const hasWeek  = cost.limit_week  != null;
            const hasMonth = cost.limit_month != null;
            if (hasWeek || hasMonth) {
                if (hasWeek) {
                    const weekPct = Math.round((cost.week / cost.limit_week) * 100);
                    tipWeekEl.textContent = cost.week.toFixed(2) + '$ / ' + cost.limit_week.toFixed(2) + '$ (' + weekPct + '%)';
                } else {
                    tipWeekEl.textContent = cost.week.toFixed(2) + '$';
                }
                if (hasMonth) {
                    const monthPct = Math.round((cost.month / cost.limit_month) * 100);
                    tipMonthEl.textContent = cost.month.toFixed(2) + '$ / ' + cost.limit_month.toFixed(2) + '$ (' + monthPct + '%)';
                } else {
                    tipMonthEl.textContent = cost.month.toFixed(2) + '$';
                }
                tooltipEl.removeAttribute('hidden');
            } else {
                tooltipEl.setAttribute('hidden', '');
            }
        }
    }

    // ── Barre messages (secondaire) ──────────────────────────────────────────
    const msgLabelEl = document.getElementById('symbiose-quota-messages-label');
    const msgTrackEl = document.getElementById('symbiose-quota-messages-track');
    const msgTextEl  = document.getElementById('symbiose-quota-messages-text');
    const msgFillEl  = document.getElementById('symbiose-quota-messages-fill');

    if (messages && messages.max > 0 && msgLabelEl && msgTrackEl && msgTextEl && msgFillEl) {
        const mpct = Math.min(100, Math.round((messages.used / messages.max) * 100));
        msgLabelEl.removeAttribute('hidden');
        msgTrackEl.removeAttribute('hidden');
        msgTextEl.textContent = messages.used + ' / ' + messages.max;
        msgFillEl.style.width = mpct + '%';
        msgFillEl.className = 'symbiose-quota-fill'
            + (mpct >= 90 ? ' symbiose-quota-fill--danger' : mpct >= 70 ? ' symbiose-quota-fill--warn' : '');
    } else if (msgLabelEl && msgTrackEl) {
        msgLabelEl.setAttribute('hidden', '');
        msgTrackEl.setAttribute('hidden', '');
    }
}

// ── Jauge de contexte ─────────────────────────────────────────────────────────

function updateContextGauge(contextUsage) {
    const el = document.getElementById('symbiose-context-gauge');
    if (!el || !contextUsage) return;
    el.removeAttribute('hidden');

    const { contextWindow, systemTokens = 0, docTokens = 0, historyTokens = 0 } = contextUsage;
    const total    = contextWindow || 1;
    const sysFrac  = Math.min(systemTokens  / total, 1);
    const docFrac  = Math.min(docTokens     / total, 1 - sysFrac);
    const histFrac = Math.min(historyTokens / total, 1 - sysFrac - docFrac);
    const free     = Math.max(1 - sysFrac - docFrac - histFrac, 0);

    const sysLen  = sysFrac  * GAUGE_CIRC;
    const docLen  = docFrac  * GAUGE_CIRC;
    const histLen = histFrac * GAUGE_CIRC;

    const sysCircle  = el.querySelector('.symbiose-gauge-sys');
    const docCircle  = el.querySelector('.symbiose-gauge-docs');
    const histCircle = el.querySelector('.symbiose-gauge-hist');

    sysCircle.style.strokeDasharray  = `${sysLen} ${GAUGE_CIRC - sysLen}`;
    sysCircle.style.strokeDashoffset = String(GAUGE_CIRC / 4);
    docCircle.style.strokeDasharray  = `${docLen} ${GAUGE_CIRC - docLen}`;
    docCircle.style.strokeDashoffset = String(GAUGE_CIRC / 4 - sysLen);
    histCircle.style.strokeDasharray  = `${histLen} ${GAUGE_CIRC - histLen}`;
    histCircle.style.strokeDashoffset = String(GAUGE_CIRC / 4 - sysLen - docLen);

    const pct = (v) => Math.round(v * 100) + '%';
    const tipEl = document.getElementById('symbiose-gauge-tooltip');
    if (tipEl) {
        tipEl.removeAttribute('hidden');
        document.getElementById('symbiose-gauge-tip-sys').textContent  = pct(sysFrac);
        document.getElementById('symbiose-gauge-tip-docs').textContent = pct(docFrac);
        document.getElementById('symbiose-gauge-tip-hist').textContent = pct(histFrac);
        document.getElementById('symbiose-gauge-tip-free').textContent = pct(free);
    }
}

// ── Agents ────────────────────────────────────────────────────────────────────

async function fetchAgents() {
    try {
        const [agentsRes, favsRes] = await Promise.all([
            apiFetch('/api/agents'),
            apiFetch('/api/agents/favorites'),
        ]);
        state.agents = await agentsRes.json();
        const favoriteIds = await favsRes.json();
        agentPicker.render(state.agents, favoriteIds);

        if (state.agents.length === 1 && !state.currentAgentId) {
            state.currentAgentId = state.agents[0].id;
            agentPicker.setValue(state.currentAgentId);
            updateSendBtn();
        }
        updateAgentMeta();
        updateWorkflowUI();
    } catch (err) {
        console.error('[FCC] fetchAgents:', err);
    }
}

function updateAgentMeta() {
    if (!elAgentMeta) return;
    const agent = state.agents.find((a) => a.id === state.currentAgentId);
    if (agent?.provider) {
        elAgentMeta.innerHTML = escHtml(agent.provider)
            + (agent.model ? '<span class="symbiose-agent-tooltip symbiose-tooltip symbiose-tooltip--below symbiose-tooltip--left symbiose-tooltip--hover">' + escHtml(agent.model) + '</span>' : '');
        elAgentMeta.hidden = false;
    } else {
        elAgentMeta.hidden = true;
    }
}

// ── Workflow UI coordination ──────────────────────────────────────────────────

function updateWorkflowUI() {
    const agent            = workflow.getActiveAgent();
    const hasWorkflowSetup = isWorkflowSetupActive();

    if (elWelcome) {
        const p = elWelcome.querySelector('p') ?? elWelcome;
        p.textContent = (hasWorkflowSetup && agent?.workflow?.welcome)
            ? agent.workflow.welcome
            : 'Sélectionnez un agent et posez votre question.';
        // Ne ré-afficher le welcome que s'il n'y a pas de conversation active
        if (!state.currentConversationId) {
            elWelcome.style.display = '';
        }
    }

    docs.setUploadEnabled(!hasWorkflowSetup);
    workflow.renderWorkflowPanel();
    updatePromptBarState();
}

// ── Envoi de message ──────────────────────────────────────────────────────────

function activateConversation(convId) {
    state.currentConversationId = convId;
    agentPicker.setDisabled(true);
    document.querySelectorAll('.symbiose-conv-item').forEach((btn) => {
        btn.classList.toggle('symbiose-conv-item--active', parseInt(btn.dataset.id) === convId);
    });
}

async function handleSend() {
    if (state.isStreaming || isWorkflowSetupActive()) return;
    mic.stop();
    const text = elInput.value.trim();
    if (!text) return;
    if (!state.currentAgentId) {
        alert('Veuillez sélectionner un agent.');
        return;
    }

    elInput.value = '';
    autoResizeTextarea();
    state.isStreaming = true;
    updateSendBtn();

    if (state.pendingFiles.length) {
        const prepareResult = await preparePendingFilesForGeneration({
            elMessages,
            docs,
            scrollToBottom,
            isViewingConversation: (convId) => state.currentConversationId === convId,
            onEnsureConversation: () => ensureConversationForGeneration({
                firstMessage: text,
                fetchConversations: conversations.fetchConversations,
                onConversationActivated: activateConversation,
            }),
        });
        if (prepareResult.status === 'failed') {
            state.isStreaming = false;
            updateSendBtn();
            return;
        }

        const convId = prepareResult.conversationId;
        const isViewingSendConv = () => state.currentConversationId === convId;
        if (elWelcome) elWelcome.style.display = 'none';

        if (prepareResult.status === 'deferred' && isViewingSendConv()) {
            messaging.renderMessage('user', text);
            scrollToBottom(true);
            docs.setPendingGeneration(() => launchStream(text, convId));
            return;
        }

        if (!isViewingSendConv()) {
            await launchStream(text, convId);
            return;
        }
    }

    messaging.renderMessage('user', text);
    scrollToBottom(true);
    await launchStream(text);
}

async function launchStream(text, conversationId = state.currentConversationId) {
    const streamConvId = conversationId;
    const assistantBubbleId = 'symbiose-bubble-' + Date.now();
    const isViewingStreamConv = state.currentConversationId === streamConvId;
    const bubbleEl = messaging.createAssistantBubble(assistantBubbleId, { append: isViewingStreamConv });
    if (isViewingStreamConv) scrollToBottom(true);

    if (isViewingStreamConv) {
        state.isStreaming = true;
        updateSendBtn();
    }

    try {
        await messaging.streamMessage(text, bubbleEl, { conversationId: streamConvId });
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('[FCC] streamMessage:', err);
            const netMsg = (err instanceof TypeError && !navigator.onLine)
                ? 'Connexion perdue — vérifiez votre réseau.'
                : escHtml(err.message);
            bubbleEl.classList.remove('symbiose-streaming');
            bubbleEl.innerHTML = '<span style="color:var(--symbiose-error-text)">Erreur : ' + netMsg + '</span>';
        }
    } finally {
        // streamConvId = 0 : nouvelle conversation dont l'ID a été assigné par le serveur.
        // Réinitialiser sauf si la conversation actuellement vue a un stream actif (rejoin).
        const hasActiveStream = !!messaging.getActiveStream(state.currentConversationId);
        if (state.currentConversationId === streamConvId || (streamConvId === 0 && !hasActiveStream)) {
            state.isStreaming = false;
            docs.clearPendingGeneration();
            updateSendBtn();
        }
        slashMenu.clearForceTool();
        slashMenu.clearForceSkill();
    }
}

// ── Événements ────────────────────────────────────────────────────────────────

function bindEvents() {
    initScrollTracking();
    elSendBtn.addEventListener('click', handleSend);

    elInput.addEventListener('keydown', (e) => {
        if (isWorkflowSetupActive()) return;
        const menu     = document.getElementById('symbiose-slash-menu');
        const menuOpen = menu && !menu.hidden;
        if (menuOpen) {
            const items = menu.querySelectorAll('.symbiose-slash-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                slashMenu.setSlashMenuIndex((slashMenu.getSlashMenuIndex() + 1) % items.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                slashMenu.setSlashMenuIndex((slashMenu.getSlashMenuIndex() - 1 + items.length) % items.length);
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const active = items[slashMenu.getSlashMenuIndex()] ?? items[0];
                if (active) {
                    if (active.dataset.type === 'skill') slashMenu.selectForceSkill(active.dataset.skill);
                    else slashMenu.selectForceTool(active.dataset.tool);
                }
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    elInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendBtn();
        const val = elInput.value;
        if (val.startsWith('/')) slashMenu.updateSlashMenu(val.slice(1));
        else slashMenu.closeSlashMenu();
    });

    elNewConvBtn.addEventListener('click', () => conversations.startNewConversation());

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('symbiose-active-conv-menu');
        if (menu && !menu.contains(e.target)) conversations.closeConvMenu();
        const slashMenuEl = document.getElementById('symbiose-slash-menu');
        if (slashMenuEl && !slashMenuEl.hidden
            && !slashMenuEl.contains(e.target) && e.target !== elInput) {
            slashMenu.closeSlashMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') slashMenu.closeSlashMenu();
        if (e.key === 'Escape' && isMobileSidebarMode() && !elSidebar.classList.contains('symbiose-sidebar--closed')) {
            setSidebarOpen(false);
        }
    });

    window.addEventListener('popstate', (e) => {
        const id = e.state?.convId ?? getConvIdFromUrl();
        if (id) conversations.selectConversation(id);
        else    conversations.startNewConversation();
    });

    window.addEventListener('resize', syncSidebarDrawerState);

    elStopBtn.addEventListener('click', () => {
        const convId = state.currentConversationId;
        // Demander au serveur d'arrêter la génération (y compris si stream rejoint après refresh)
        if (convId) {
            apiFetch('/api/conversations/' + convId + '/stop', { method: 'POST' }).catch(() => {});
        }
        // Fermer aussi la connexion client pour feedback immédiat
        const ctrl = messaging.getAbortController();
        if (ctrl) ctrl.abort();
    });

    mic.initMic({
        elInput,
        autoResizeTextarea,
        updateSendBtn,
        isStreaming: () => state.isStreaming,
    });

    elFileInput.addEventListener('change', docs.handleFileSelect);

    elHamburger.addEventListener('click', () => setSidebarOpen(true));
    elSidebarToggle.addEventListener('click', () => setSidebarOpen(false));
    elSidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));

    const docsBtn        = document.getElementById('symbiose-docs-btn');
    const docsPanel      = document.getElementById('symbiose-docs-panel');
    const docsPanelClose = document.getElementById('symbiose-docs-panel-close');

    docsPanel.inert = true;

    docsBtn.addEventListener('click', () => {
        const opening = !docsPanel.classList.contains('symbiose-docs-panel--open');
        docsPanel.classList.toggle('symbiose-docs-panel--open', opening);
        docsPanel.inert = !opening;
        docsBtn.classList.toggle('symbiose-docs-btn--active', opening);
        if (opening) docs.renderDocsPanel();
    });

    docsPanelClose.addEventListener('click', () => {
        docsPanel.classList.remove('symbiose-docs-panel--open');
        docsPanel.inert = true;
        docsBtn.classList.remove('symbiose-docs-btn--active');
    });

    // ── Plein écran ───────────────────────────────────────────────────────────
    const fullscreenBtn = document.getElementById('symbiose-fullscreen-btn');
    const iconExpand    = document.getElementById('symbiose-icon-expand');
    const iconCompress  = document.getElementById('symbiose-icon-compress');
    const app           = document.getElementById('symbiose-app');

    function setFullscreen(on) {
        app.classList.toggle('symbiose-app--fullscreen', on);
        document.body.style.overflowY = on ? 'hidden' : '';
        iconExpand.style.display   = on ? 'none' : '';
        iconCompress.style.display = on ? '' : 'none';
        const label = on ? 'Quitter le plein écran' : 'Plein écran';
        fullscreenBtn.setAttribute('aria-label', label);
        fullscreenBtn.setAttribute('title', label);
        localStorage.setItem('symbiose-fullscreen', on ? '1' : '0');
    }

    fullscreenBtn.addEventListener('click', () => {
        setFullscreen(!app.classList.contains('symbiose-app--fullscreen'));
    });

    if (localStorage.getItem('symbiose-fullscreen') === '1') setFullscreen(true);
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
    elMessages        = document.getElementById('symbiose-messages');
    elInput           = document.getElementById('symbiose-message-input');
    elSendBtn         = document.getElementById('symbiose-send-btn');
    elStopBtn         = document.getElementById('symbiose-stop-btn');
    elAgentMeta       = document.getElementById('symbiose-agent-meta');
    elConvList        = document.getElementById('symbiose-conversation-list');
    elNewConvBtn      = document.getElementById('symbiose-new-conversation');
    elFileInput       = document.getElementById('symbiose-file-input');
    elUploadPreview   = document.getElementById('symbiose-upload-preview');
    elFooter          = document.getElementById('symbiose-footer');
    elInputRow        = document.getElementById('symbiose-input-row');
    elApp             = document.getElementById('symbiose-app');
    elSidebar         = document.getElementById('symbiose-sidebar');
    elHamburger       = document.getElementById('symbiose-hamburger');
    elSidebarToggle   = document.getElementById('symbiose-sidebar-toggle');
    elSidebarBackdrop = document.getElementById('symbiose-sidebar-backdrop');
    elWelcome         = document.getElementById('symbiose-welcome');

    if (!elMessages) return; // shortcode absent de la page

    if (!JWT || !BACKEND_URL) {
        showGlobalError('Configuration manquante (JWT ou URL backend).');
        return;
    }

    if (window.marked) {
        window.marked.setOptions({ breaks: true, gfm: true });
    }
    if (window.mermaid) {
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
    }

    // Créer les conteneurs dynamiques
    const slashMenuEl = document.createElement('div');
    slashMenuEl.id = 'symbiose-slash-menu';
    slashMenuEl.hidden = true;
    document.getElementById('symbiose-footer').appendChild(slashMenuEl);

    const forceToolWrap = document.createElement('div');
    forceToolWrap.id = 'symbiose-force-tool-wrap';
    forceToolWrap.hidden = true;
    document.getElementById('symbiose-footer').insertBefore(forceToolWrap, elUploadPreview);

    const forceSkillWrap = document.createElement('div');
    forceSkillWrap.id = 'symbiose-force-skill-wrap';
    forceSkillWrap.hidden = true;
    document.getElementById('symbiose-footer').insertBefore(forceSkillWrap, elUploadPreview);

    const workflowPanel = document.createElement('div');
    workflowPanel.id = 'symbiose-workflow-panel';
    workflowPanel.hidden = true;
    elMessages.appendChild(workflowPanel);

    // Initialiser les modules avec leurs dépendances
    docs.init({
        apiFetch,
        onDocsChange:          updateWorkflowUI,
        elUploadPreview,
        elFileInput,
        isWorkflowSetupActive,
        renderWorkflowPanel:   workflow.renderWorkflowPanel,
        updateSendBtn,
        appendErrorBubble:     messaging.appendErrorBubble,
    });

    slashMenu.init({ elInput, autoResizeTextarea, updateSendBtn });

    workflow.init({
        docs,
        messaging,
        slashMenu,
        elMessages,
        elWelcome,
        scrollToBottom,
        updateSendBtn,
        updateWorkflowUI,
        uploadOneFile:         docs.uploadOneFile,
        isWorkflowSetupActive,
        apiFetch,
        fetchConversations:    conversations.fetchConversations,
        setConversationActive: activateConversation,
    });

    conversations.init({
        apiFetch,
        docs,
        messaging,
        agentPicker,
        elConvList,
        elWelcome,
        setConvInUrl,
        updateAgentMeta,
        updateWorkflowUI,
        resetWorkflowState:   workflow.resetWorkflowState,
        scrollToBottom,
        closeSidebarIfMobile,
        updateSendBtn,
    });

    agentPicker.init({
        container: document.getElementById('symbiose-agent-picker'),
        onSelect: (agentId) => {
            state.currentAgentId = agentId;
            updateSendBtn();
            updateAgentMeta();
            slashMenu.clearForceTool();
            slashMenu.clearForceSkill();
            workflow.resetWorkflowState();
            updateWorkflowUI();
        },
    });

    messaging.init({
        elMessages,
        elStopBtn,
        elSendBtn,
        elWelcome,
        apiFetch,
        fetchConversations:    conversations.fetchConversations,
        scrollToBottom,
        updateContextGauge,
        onDone: async (finishedConvId) => {
            fetchQuota();
            // Backend a reset inject_full — rafraîchir les docs dans le panel
            // (uniquement si l'utilisateur regarde encore la conversation qui vient de finir)
            if (finishedConvId && finishedConvId === state.currentConversationId) {
                const docList = await docs.fetchDocumentsRaw(finishedConvId);
                docs.updateDocsPanel(docList);
            }
        },
        onDocumentsUpdated: async ({ conversationId }) => {
            if (conversationId === state.currentConversationId) {
                const docList = await docs.fetchDocumentsRaw(conversationId);
                docs.updateDocsPanel(docList);
            }
        },
        updateConvIndicator: conversations.updateConvIndicator,
    });

    bindEvents();
    syncSidebarDrawerState();
    await fetchAgents();
    await conversations.fetchConversations();
    const initialConvId = getConvIdFromUrl();
    if (initialConvId && state.conversations.find((c) => c.id === initialConvId)) {
        history.replaceState({ convId: initialConvId }, '', window.location.href);
        await conversations.selectConversation(initialConvId);
    }
    fetchQuota();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
