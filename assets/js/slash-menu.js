// ── Menu contextuel "/" + chips force-tool / force-skill ──────────────────────

import { escHtml } from './utils.js';
import { state } from './state.js';

let forceTool      = null; // null | { id: 'search_documents', label: 'search-documents' }
let forceSkill     = null; // null | { id: 'mermaid', label: 'mermaid' }
let slashMenuIndex = -1;

// Refs injectées par init()
let _elInput;
let _autoResizeTextarea;
let _updateSendBtn;

export function init({ elInput, autoResizeTextarea, updateSendBtn }) {
    _elInput             = elInput;
    _autoResizeTextarea  = autoResizeTextarea;
    _updateSendBtn       = updateSendBtn;
}

// ── Getters ───────────────────────────────────────────────────────────────────

export function getForceTool()      { return forceTool; }
export function getForceSkill()     { return forceSkill; }
export function getSlashMenuIndex() { return slashMenuIndex; }

// ── Menu ──────────────────────────────────────────────────────────────────────

export function updateSlashMenu(query) {
    const agent = state.agents.find((a) => a.id === state.currentAgentId);
    const allTools  = agent?.tools  ?? [];
    const allSkills = agent?.skills ?? [];
    if (!allTools.length && !allSkills.length) return;

    const q = query.toLowerCase().replace(/-/g, '');
    const filteredTools  = q ? allTools.filter(({ id, title })       => id.replace(/-/g, '').includes(q) || title.toLowerCase().includes(q))       : allTools;
    const filteredSkills = q ? allSkills.filter(({ id, description }) => id.replace(/-/g, '').includes(q) || description.toLowerCase().includes(q)) : allSkills;

    const menu = document.getElementById('symbiose-slash-menu');
    if (!filteredTools.length && !filteredSkills.length) { menu.hidden = true; return; }

    const wrenchSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
    const bookSvg   = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';

    let html = '';
    if (filteredTools.length) {
        html += '<div class="symbiose-slash-section">Outils</div>'
            + filteredTools.map(({ id, title }) =>
                '<button class="symbiose-slash-item" data-type="tool" data-tool="' + escHtml(id) + '" data-title="' + escHtml(title) + '">'
                + wrenchSvg
                + '<span class="symbiose-slash-item__name">' + escHtml(title) + '</span>'
                + '</button>'
            ).join('');
    }
    if (filteredSkills.length) {
        html += '<div class="symbiose-slash-section">Compétences</div>'
            + filteredSkills.map(({ id, description }) =>
                '<button class="symbiose-slash-item" data-type="skill" data-skill="' + escHtml(id) + '">'
                + bookSvg
                + '<span class="symbiose-slash-item__label">'
                + '<span class="symbiose-slash-item__name">' + escHtml(id) + '</span>'
                + (description ? '<span class="symbiose-slash-item__desc">' + escHtml(description) + '</span>' : '')
                + '</span>'
                + '</button>'
            ).join('');
    }
    menu.innerHTML = html;

    menu.querySelectorAll('.symbiose-slash-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.dataset.type === 'skill') selectForceSkill(btn.dataset.skill);
            else selectForceTool(btn.dataset.tool, btn.dataset.title);
        });
    });

    menu.hidden = false;
    setSlashMenuIndex(0);
}

export function setSlashMenuIndex(i) {
    const menu = document.getElementById('symbiose-slash-menu');
    if (!menu) return;
    const items = menu.querySelectorAll('.symbiose-slash-item');
    slashMenuIndex = Math.max(0, Math.min(i, items.length - 1));
    items.forEach((el, idx) => el.classList.toggle('symbiose-slash-item--active', idx === slashMenuIndex));
}

export function closeSlashMenu() {
    const menu = document.getElementById('symbiose-slash-menu');
    if (menu) menu.hidden = true;
    slashMenuIndex = -1;
}

// ── Force Tool ────────────────────────────────────────────────────────────────

export function selectForceTool(toolKebabId, title) {
    forceTool = { id: toolKebabId.replace(/-/g, '_'), label: title ?? toolKebabId };
    const current = _elInput.value;
    _elInput.value = current.startsWith('/') ? '' : current;
    _autoResizeTextarea();
    _updateSendBtn();
    closeSlashMenu();
    renderForceToolChip();
    _elInput.focus();
}

export function renderForceToolChip() {
    const wrap = document.getElementById('symbiose-force-tool-wrap');
    if (!wrap) return;
    if (!forceTool) { wrap.hidden = true; wrap.innerHTML = ''; return; }

    wrap.innerHTML = '<div id="symbiose-force-tool-chip">'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
        + escHtml(forceTool.label)
        + '<button aria-label="Retirer l\'outil forcé">×</button>'
        + '</div>';
    wrap.querySelector('button').addEventListener('click', clearForceTool);
    wrap.hidden = false;
}

export function clearForceTool() {
    forceTool = null;
    renderForceToolChip();
}

// ── Force Skill ───────────────────────────────────────────────────────────────

export function selectForceSkill(skillId) {
    forceSkill = { id: skillId, label: skillId };
    const current = _elInput.value;
    _elInput.value = current.startsWith('/') ? '' : current;
    _autoResizeTextarea();
    _updateSendBtn();
    closeSlashMenu();
    renderForceSkillChip();
    _elInput.focus();
}

export function renderForceSkillChip() {
    const wrap = document.getElementById('symbiose-force-skill-wrap');
    if (!wrap) return;
    if (!forceSkill) { wrap.hidden = true; wrap.innerHTML = ''; return; }

    wrap.innerHTML = '<div id="symbiose-force-skill-chip">'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
        + escHtml(forceSkill.label)
        + '<button aria-label="Retirer le skill forcé">×</button>'
        + '</div>';
    wrap.querySelector('button').addEventListener('click', clearForceSkill);
    wrap.hidden = false;
}

export function clearForceSkill() {
    forceSkill = null;
    renderForceSkillChip();
}
