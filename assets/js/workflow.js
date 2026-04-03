/**
 * Workflow module — step-by-step form before agent invocation.
 * Receives its dependencies via init() to avoid circular imports.
 */

import { state } from './state.js';
import { escHtml } from './utils.js';
import { ensureConversationForGeneration, preparePendingFilesForGeneration } from './send-flow.js';

// ── Injected dependencies ─────────────────────────────────────────────────────

let _docs, _messaging, _slashMenu;
let _elMessages, _elWelcome;
let _scrollToBottom, _updateSendBtn, _updateWorkflowUI, _uploadOneFile;
let _isWorkflowSetupActive;
let _apiFetch, _fetchConversations, _setConversationActive;

export function init(deps) {
    _docs                  = deps.docs;
    _messaging             = deps.messaging;
    _slashMenu             = deps.slashMenu;
    _elMessages            = deps.elMessages;
    _elWelcome             = deps.elWelcome;
    _scrollToBottom        = deps.scrollToBottom;
    _updateSendBtn         = deps.updateSendBtn;
    _updateWorkflowUI      = deps.updateWorkflowUI;
    _uploadOneFile         = deps.uploadOneFile;
    _isWorkflowSetupActive = deps.isWorkflowSetupActive;
    _apiFetch              = deps.apiFetch;
    _fetchConversations    = deps.fetchConversations;
    _setConversationActive = deps.setConversationActive;
}

// ── Debounced workflow state persistence ──────────────────────────────────────

let _saveTimer = null;

function scheduleWorkflowSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        if (!_apiFetch || !state.currentConversationId) return;
        _apiFetch('/api/conversations/' + state.currentConversationId, {
            method: 'PATCH',
            body: JSON.stringify({ workflow_step: state.workflowStep, workflow_answers: state.workflowAnswers }),
        }).catch((e) => console.warn('[FCC] workflow save:', e));
    }, 800);
}

// ── Pure logic ────────────────────────────────────────────────────────────────

export function getActiveAgent() {
    return state.agents.find((a) => a.id === state.currentAgentId) ?? null;
}

export function resetWorkflowState() {
    state.workflowDone    = false;
    state.workflowStep    = 0;
    state.workflowAnswers = {};
}

function shouldShowStep(step) {
    if (!step.showIf) return true;
    const { question, in: values, not } = step.showIf;
    const answer = state.workflowAnswers[question];
    if (values)            return values.includes(answer);
    if (not !== undefined) return answer !== not;
    return true;
}

function getVisibleSteps(workflow) {
    return (workflow.steps ?? []).filter((s) => shouldShowStep(s));
}

function isStepValid(step) {
    for (const q of step.questions ?? []) {
        if (!q.required) continue;
        const ans = state.workflowAnswers[q.id];
        if (!ans || (Array.isArray(ans) && !ans.length) || ans === '') return false;
    }
    return true;
}

function isAllStepsValid(visibleSteps) {
    return visibleSteps.every((s) => isStepValid(s));
}

function buildTriggerMessage(workflow) {
    const visible = getVisibleSteps(workflow);
    const lines   = [];
    for (const step of visible) {
        if (step.type !== 'questions') continue;
        for (const q of step.questions ?? []) {
            const ans = state.workflowAnswers[q.id];
            if (!ans || (Array.isArray(ans) && !ans.length) || ans === '') continue;
            lines.push('- ' + q.label + ' : ' + (Array.isArray(ans) ? ans.join(', ') : ans));
        }
    }
    const context = lines.length
        ? 'Informations collectées :\n' + lines.join('\n') + '\n\n---\n\n'
        : '';
    return context + workflow.trigger.message;
}

// ── DOM rendering ─────────────────────────────────────────────────────────────

export function renderWorkflowSummaryBubble(workflow) {
    const visible = getVisibleSteps(workflow);
    const pairs   = [];
    for (const step of visible) {
        if (step.type !== 'questions') continue;
        for (const q of step.questions ?? []) {
            const ans = state.workflowAnswers[q.id];
            if (!ans || (Array.isArray(ans) && !ans.length) || ans === '') continue;
            pairs.push({ label: q.label, value: Array.isArray(ans) ? ans.join(', ') : ans });
        }
    }
    const docNames = _docs.getCurrentDocs().map((d) => d.filename);
    if (docNames.length) pairs.push({ label: 'Documents', value: docNames.join(', ') });

    const wrapper = document.createElement('div');
    wrapper.className = 'symbiose-msg symbiose-msg--workflow-summary';
    const card = document.createElement('div');
    card.className = 'symbiose-wf-summary-card';
    const titleEl = document.createElement('div');
    titleEl.className = 'symbiose-wf-summary-title';
    titleEl.textContent = workflow.trigger.label;
    card.appendChild(titleEl);
    if (pairs.length) {
        const dl = document.createElement('dl');
        dl.className = 'symbiose-wf-summary-list';
        for (const { label, value } of pairs) {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = value;
            dl.appendChild(dt);
            dl.appendChild(dd);
        }
        card.appendChild(dl);
    }
    wrapper.appendChild(card);
    _elMessages.appendChild(wrapper);
    _scrollToBottom(true);
}

function renderQuestion(q) {
    const wrap = document.createElement('div');
    wrap.className = 'symbiose-wf-question';
    const lbl = document.createElement('label');
    lbl.className = 'symbiose-wf-question__label';
    lbl.textContent = q.label + (q.required ? ' *' : '');
    wrap.appendChild(lbl);
    const current = state.workflowAnswers[q.id];

    if (q.type === 'radio') {
        const group = document.createElement('div');
        group.className = 'symbiose-wf-radio-group';
        for (const opt of q.options ?? []) {
            const optLbl = document.createElement('label');
            optLbl.className = 'symbiose-wf-radio-option' + (current === opt ? ' symbiose-wf-option--selected' : '');
            const inp = document.createElement('input');
            inp.type = 'radio';
            inp.name = 'wf-q-' + q.id;
            inp.value = opt;
            inp.checked = current === opt;
            inp.addEventListener('change', () => {
                state.workflowAnswers[q.id] = opt;
                const agnt = getActiveAgent();
                if (agnt?.workflow) {
                    const vis = getVisibleSteps(agnt.workflow);
                    const si  = Math.min(state.workflowStep, vis.length - 1);
                    const stp = vis[si];
                    if ((stp.questions?.length ?? 0) === 1 && isStepValid(stp) && si < vis.length - 1) {
                        state.workflowStep++;
                    }
                }
                scheduleWorkflowSave();
                renderWorkflowPanel();
            });
            optLbl.appendChild(inp);
            optLbl.appendChild(document.createTextNode(opt));
            group.appendChild(optLbl);
        }
        wrap.appendChild(group);

    } else if (q.type === 'checkbox') {
        const group = document.createElement('div');
        group.className = 'symbiose-wf-checkbox-group';
        const currentArr = Array.isArray(current) ? current : [];
        for (const opt of q.options ?? []) {
            const optLbl = document.createElement('label');
            const checked = currentArr.includes(opt);
            optLbl.className = 'symbiose-wf-checkbox-option' + (checked ? ' symbiose-wf-option--selected' : '');
            const inp = document.createElement('input');
            inp.type = 'checkbox';
            inp.value = opt;
            inp.checked = checked;
            inp.addEventListener('change', () => {
                const arr = Array.isArray(state.workflowAnswers[q.id]) ? [...state.workflowAnswers[q.id]] : [];
                if (inp.checked) arr.push(opt);
                else { const i = arr.indexOf(opt); if (i !== -1) arr.splice(i, 1); }
                state.workflowAnswers[q.id] = arr;
                scheduleWorkflowSave();
                renderWorkflowPanel();
            });
            optLbl.appendChild(inp);
            optLbl.appendChild(document.createTextNode(opt));
            group.appendChild(optLbl);
        }
        wrap.appendChild(group);

    } else if (q.type === 'textarea') {
        const inp = document.createElement('textarea');
        inp.className = 'symbiose-wf-text-input symbiose-wf-textarea';
        inp.placeholder = q.placeholder ?? '';
        inp.rows = q.rows ?? 4;
        inp.value = current ?? '';
        inp.addEventListener('input', () => {
            state.workflowAnswers[q.id] = inp.value;
            scheduleWorkflowSave();
            const agnt = getActiveAgent();
            if (!agnt?.workflow) return;
            const vis = getVisibleSteps(agnt.workflow);
            const si  = Math.min(state.workflowStep, vis.length - 1);
            const nextBtn = document.querySelector('#symbiose-workflow-panel .symbiose-wf-nav-btn--primary');
            const trigBtn = document.querySelector('#symbiose-workflow-panel .symbiose-wf-trigger-btn');
            if (nextBtn) nextBtn.disabled = !isStepValid(vis[si]);
            if (trigBtn) trigBtn.disabled = !isAllStepsValid(vis);
        });
        wrap.appendChild(inp);

    } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        const isNumeric = q.type === 'number';
        if (isNumeric) {
            inp.inputMode = 'numeric';
            inp.pattern = '[0-9\\s]*';
        }
        inp.className = 'symbiose-wf-text-input';
        inp.placeholder = q.placeholder ?? '';
        const formatThousands = (raw) => raw ? new Intl.NumberFormat('fr-FR').format(Number(raw)) : '';
        inp.value = isNumeric ? formatThousands(String(current ?? '').replace(/\D/g, '')) : (current ?? '');
        inp.addEventListener('input', () => {
            if (isNumeric) {
                const raw = inp.value.replace(/\D/g, '');
                state.workflowAnswers[q.id] = raw;
                inp.value = formatThousands(raw);
            } else {
                state.workflowAnswers[q.id] = inp.value;
            }
            scheduleWorkflowSave();
            const agnt = getActiveAgent();
            if (!agnt?.workflow) return;
            const vis = getVisibleSteps(agnt.workflow);
            const si  = Math.min(state.workflowStep, vis.length - 1);
            const nextBtn = document.querySelector('#symbiose-workflow-panel .symbiose-wf-nav-btn--primary');
            const trigBtn = document.querySelector('#symbiose-workflow-panel .symbiose-wf-trigger-btn');
            if (nextBtn) nextBtn.disabled = !isStepValid(vis[si]);
            if (trigBtn) trigBtn.disabled = !isAllStepsValid(vis);
        });
        inp.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const agnt = getActiveAgent();
            if (!agnt?.workflow) return;
            const vis = getVisibleSteps(agnt.workflow);
            const si  = Math.min(state.workflowStep, vis.length - 1);
            const stp = vis[si];
            if ((stp.questions?.length ?? 0) === 1 && isStepValid(stp) && si < vis.length - 1) {
                state.workflowStep++;
                scheduleWorkflowSave();
                renderWorkflowPanel();
            }
        });
        wrap.appendChild(inp);
    }
    return wrap;
}

function renderUploadZone(step) {
    const zone = document.createElement('div');
    zone.className = 'symbiose-wf-upload-zone';
    const files = state.pendingFiles;
    if (files.length) {
        const list = document.createElement('div');
        list.className = 'symbiose-wf-upload-filelist';
        list.innerHTML = files.map((f) => '<span class="symbiose-wf-upload-chip">📄 ' + escHtml(f.name) + '</span>').join('');
        zone.appendChild(list);
    }
    const hint = document.createElement('p');
    hint.className = 'symbiose-wf-upload-hint';
    hint.textContent = step.hint ?? 'Déposez vos documents ici ou cliquez pour sélectionner';
    zone.appendChild(hint);
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'symbiose-wf-upload-btn';
    selectBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Choisir des fichiers';
    selectBtn.addEventListener('click', () => { document.getElementById('symbiose-file-input')?.click(); });
    zone.appendChild(selectBtn);
    zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('symbiose-wf-upload-zone--dragover'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('symbiose-wf-upload-zone--dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('symbiose-wf-upload-zone--dragover');
        const incoming = Array.from(e.dataTransfer.files);
        const valid = incoming.filter((f) => {
            if (f.size > 10 * 1024 * 1024) { alert(escHtml(f.name) + ' dépasse 10 Mo.'); return false; }
            return true;
        });
        const existing = state.pendingFiles.map((f) => f.name);
        state.pendingFiles = [...state.pendingFiles, ...valid.filter((f) => !existing.includes(f.name))];
        renderWorkflowPanel();
    });
    return zone;
}

function renderStepContent(step) {
    const div = document.createElement('div');
    div.className = 'symbiose-wf-step__content';
    if (step.type === 'upload') {
        div.appendChild(renderUploadZone(step));
    } else {
        for (const q of step.questions ?? []) div.appendChild(renderQuestion(q));
    }
    return div;
}

export function renderWorkflowPanel() {
    const panel = document.getElementById('symbiose-workflow-panel');
    if (!panel) return;
    if (!_isWorkflowSetupActive()) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }
    const agent   = getActiveAgent();
    const { workflow } = agent;
    const visible      = getVisibleSteps(workflow);
    panel.innerHTML    = '';

    if (workflow.mode === 'form') {
        const form = document.createElement('div');
        form.className = 'symbiose-wf-form';
        for (const step of visible) {
            const section = document.createElement('div');
            section.className = 'symbiose-wf-form-section';
            const title = document.createElement('div');
            title.className = 'symbiose-wf-section-title';
            title.textContent = step.title;
            section.appendChild(title);
            section.appendChild(renderStepContent(step));
            form.appendChild(section);
        }
        const trigBtn = document.createElement('button');
        trigBtn.className = 'symbiose-wf-trigger-btn';
        trigBtn.textContent = workflow.trigger.label;
        trigBtn.disabled = !isAllStepsValid(visible);
        trigBtn.addEventListener('click', triggerWorkflow);
        form.appendChild(trigBtn);
        panel.appendChild(form);
    } else {
        const stepIdx = Math.min(state.workflowStep, visible.length - 1);
        const step    = visible[stepIdx];
        if (!step) { panel.hidden = true; return; }
        const isLast  = stepIdx === visible.length - 1;

        const card = document.createElement('div');
        card.className = 'symbiose-wf-step';
        const header = document.createElement('div');
        header.className = 'symbiose-wf-step__header';
        header.innerHTML = '<span class="symbiose-wf-step__title">' + escHtml(step.title) + '</span>'
            + '<span class="symbiose-wf-step__indicator">Étape&nbsp;' + (stepIdx + 1) + '&nbsp;/&nbsp;' + visible.length + '</span>';
        card.appendChild(header);
        card.appendChild(renderStepContent(step));

        const nav = document.createElement('div');
        nav.className = 'symbiose-wf-step__nav';
        if (stepIdx > 0) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'symbiose-wf-nav-btn';
            prevBtn.textContent = '← Précédent';
            prevBtn.addEventListener('click', () => { state.workflowStep--; scheduleWorkflowSave(); renderWorkflowPanel(); });
            nav.appendChild(prevBtn);
        } else {
            nav.appendChild(document.createElement('span'));
        }
        if (isLast) {
            const trigBtn = document.createElement('button');
            trigBtn.className = 'symbiose-wf-trigger-btn';
            trigBtn.textContent = workflow.trigger.label;
            trigBtn.disabled = !isAllStepsValid(visible);
            trigBtn.addEventListener('click', triggerWorkflow);
            nav.appendChild(trigBtn);
        } else {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'symbiose-wf-nav-btn symbiose-wf-nav-btn--primary';
            nextBtn.textContent = 'Suivant →';
            nextBtn.disabled = !isStepValid(step);
            nextBtn.addEventListener('click', () => { state.workflowStep++; scheduleWorkflowSave(); renderWorkflowPanel(); });
            nav.appendChild(nextBtn);
        }
        card.appendChild(nav);
        panel.appendChild(card);
    }
    panel.hidden = false;
}

export async function triggerWorkflow() {
    const agent = getActiveAgent();
    if (!agent?.workflow || state.isStreaming) return;
    const { workflow } = agent;
    const triggerMsg   = buildTriggerMessage(workflow);

    state.workflowDone = true;
    // Clear persisted workflow state (fire & forget)
    if (_saveTimer) clearTimeout(_saveTimer);
    if (_apiFetch && state.currentConversationId) {
        _apiFetch('/api/conversations/' + state.currentConversationId, {
            method: 'PATCH',
            body: JSON.stringify({ workflow_step: null, workflow_answers: null }),
        }).catch(() => {});
    }
    _updateWorkflowUI();
    state.isStreaming = true;
    _updateSendBtn();

    const prepareResult = await preparePendingFilesForGeneration({
        elMessages: _elMessages,
        docs: _docs,
        scrollToBottom: _scrollToBottom,
        isViewingConversation: (convId) => state.currentConversationId === convId,
        onEnsureConversation: () => ensureConversationForGeneration({
            firstMessage: workflow.trigger.label,
            fetchConversations: _fetchConversations,
            onConversationActivated: _setConversationActive,
        }),
    });
    const convId = prepareResult.conversationId;
    if (prepareResult.status === 'failed' || convId === null) {
        state.workflowDone = false;
        state.isStreaming   = false;
        _updateSendBtn();
        renderWorkflowPanel();
        return;
    }
    const isViewingWorkflowConv = () => state.currentConversationId === convId;
    if (_elWelcome) _elWelcome.style.display = 'none';

    if (prepareResult.status === 'deferred' && isViewingWorkflowConv()) {
        _docs.setPendingGeneration(() => _launchWorkflowStream(triggerMsg, convId));
        return;
    }

    await _launchWorkflowStream(triggerMsg, convId);

    async function _launchWorkflowStream(msg, cid) {
        if (isViewingWorkflowConv()) renderWorkflowSummaryBubble(workflow);

        const isViewingStreamConv = state.currentConversationId === cid;
        const bubbleEl = _messaging.createAssistantBubble('symbiose-bubble-' + Date.now(), { append: isViewingStreamConv });
        if (isViewingStreamConv) _scrollToBottom(true);

        try {
            await _messaging.streamMessage(msg, bubbleEl, { workflowMode: true, conversationId: cid });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[FCC] workflow trigger:', err);
                const netMsg = (err instanceof TypeError && !navigator.onLine)
                    ? 'Connexion perdue — vérifiez votre réseau.'
                    : escHtml(err.message);
                bubbleEl.classList.remove('symbiose-streaming');
                bubbleEl.innerHTML = '<span style="color:var(--symbiose-error-text)">Erreur : ' + netMsg + '</span>';
            }
        } finally {
            _docs.clearPendingGeneration();
            if (state.currentConversationId === cid) {
                state.isStreaming = false;
                _updateSendBtn();
            }
        }
    }
}
