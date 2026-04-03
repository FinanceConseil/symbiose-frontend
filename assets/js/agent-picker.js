// ── Sélecteur d'agents custom (groupes, recherche, favoris) ──────────────────

let _container    = null;
let _onSelect     = null;
let _agents       = [];
let _favoriteIds  = [];
let _selectedId   = null;
let _disabled     = false;
let _isOpen       = false;
let _searchQuery  = '';
let _focusedIndex = -1;
// Ensemble des clés de groupes repliés (par défaut tous ouverts)
const _collapsedGroups = new Set();

// ── API publique ──────────────────────────────────────────────────────────────

export function init({ container, onSelect }) {
    _container = container;
    _onSelect  = onSelect;
    _renderTrigger();
    document.addEventListener('click', _onDocClick);
    document.addEventListener('keydown', _onDocKeydown);
}

export function render(agents, favoriteIds) {
    _agents      = agents      ?? [];
    _favoriteIds = favoriteIds ?? [];
    _renderTrigger();
    if (_isOpen) _renderPanel();
}

export function setValue(id) {
    _selectedId = id ?? null;
    _renderTriggerLabel();
}

export function getValue() {
    return _selectedId;
}

export function setDisabled(disabled) {
    _disabled = !!disabled;
    if (_disabled && _isOpen) _close();
    _container?.classList.toggle('symbiose-agent-picker--disabled', _disabled);
    const trigger = _container?.querySelector('.symbiose-agent-picker__trigger');
    if (trigger) trigger.disabled = _disabled;
}

// ── Rendu du déclencheur ──────────────────────────────────────────────────────

function _renderTrigger() {
    if (!_container) return;
    // Créer le trigger s'il n'existe pas encore
    if (!_container.querySelector('.symbiose-agent-picker__trigger')) {
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'symbiose-agent-picker__trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const label = document.createElement('span');
        label.className = 'symbiose-agent-picker__label';
        label.textContent = '— Choisir un agent —';

        const chevron = _chevronSvg();

        trigger.appendChild(label);
        trigger.appendChild(chevron);
        trigger.addEventListener('click', _onTriggerClick);
        _container.appendChild(trigger);
    }
    _renderTriggerLabel();
}

function _renderTriggerLabel() {
    const label = _container?.querySelector('.symbiose-agent-picker__label');
    if (!label) return;
    if (_selectedId) {
        const agent = _agents.find(a => a.id === _selectedId);
        label.textContent = agent ? agent.name : _selectedId;
    } else {
        label.textContent = '— Choisir un agent —';
    }
    // Met à jour l'état actif dans le panel si ouvert
    _container?.querySelectorAll('.symbiose-ap-item').forEach(el => {
        el.classList.toggle('symbiose-ap-item--active', el.dataset.agentId === _selectedId);
        el.setAttribute('aria-selected', el.dataset.agentId === _selectedId ? 'true' : 'false');
    });
}

// ── Rendu du panneau ──────────────────────────────────────────────────────────

function _renderPanel() {
    if (!_container) return;
    let panel = _container.querySelector('.symbiose-agent-picker__panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'symbiose-agent-picker__panel';
        panel.setAttribute('role', 'listbox');

        // Barre de recherche
        const searchWrap = document.createElement('div');
        searchWrap.className = 'symbiose-agent-picker__search';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Rechercher un agent…';
        searchInput.autocomplete = 'off';
        searchInput.setAttribute('aria-label', 'Rechercher un agent');
        searchInput.addEventListener('input', _onSearchInput);
        searchInput.addEventListener('keydown', _onSearchKeydown);
        searchWrap.appendChild(searchInput);
        panel.appendChild(searchWrap);

        // Résultats de recherche (liste plate)
        const results = document.createElement('div');
        results.className = 'symbiose-agent-picker__results';
        results.hidden = true;
        panel.appendChild(results);

        // Arborescence
        const tree = document.createElement('div');
        tree.className = 'symbiose-agent-picker__tree';
        panel.appendChild(tree);

        _container.appendChild(panel);
    }

    // Réinitialiser la recherche à l'ouverture
    const searchInput = panel.querySelector('input');
    if (searchInput && !_searchQuery) searchInput.value = '';

    _rebuildTree();
}

function _rebuildTree() {
    const panel = _container?.querySelector('.symbiose-agent-picker__panel');
    if (!panel) return;

    const results = panel.querySelector('.symbiose-agent-picker__results');
    const tree    = panel.querySelector('.symbiose-agent-picker__tree');

    if (_searchQuery) {
        // Mode recherche : liste plate filtrée
        tree.hidden    = true;
        results.hidden = false;
        results.innerHTML = '';
        const filtered = _filterAgents(_searchQuery);
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'symbiose-ap-empty';
            empty.textContent = 'Aucun agent trouvé';
            results.appendChild(empty);
        } else {
            filtered.forEach(agent => results.appendChild(_buildItem(agent)));
        }
    } else {
        // Mode normal : favoris + arborescence
        results.hidden = true;
        tree.hidden    = false;
        tree.innerHTML = '';

        // Section favoris
        const favAgents = _favoriteIds
            .map(id => _agents.find(a => a.id === id))
            .filter(Boolean);

        if (favAgents.length > 0) {
            const section = document.createElement('div');
            section.className = 'symbiose-ap-section symbiose-ap-section--favorites';
            const header = document.createElement('div');
            header.className = 'symbiose-ap-section__header';
            header.textContent = '⭐ Favoris';
            section.appendChild(header);
            favAgents.forEach(agent => section.appendChild(_buildItem(agent)));
            tree.appendChild(section);
        }

        // Groupes
        const { general, groups } = _buildTree(_agents);

        // Section "Général" (agents sans groupe)
        if (general.length > 0) {
            const section = document.createElement('div');
            section.className = 'symbiose-ap-section symbiose-ap-section--general';
            const header = document.createElement('div');
            header.className = 'symbiose-ap-section__header';
            header.textContent = 'Général';
            section.appendChild(header);
            general.forEach(agent => section.appendChild(_buildItem(agent)));
            tree.appendChild(section);
        }

        // Groupes principaux — fermés par défaut à la première ouverture
        Object.entries(groups).forEach(([groupName, groupData]) => {
            if (!_collapsedGroups.has(groupName) && !_collapsedGroups.has('__initialized__')) {
                _collapsedGroups.add(groupName);
                Object.keys(groupData.children ?? {}).forEach(subName => {
                    _collapsedGroups.add(groupName + ' / ' + subName);
                });
            }
            tree.appendChild(_buildGroup(groupName, groupData));
        });
        _collapsedGroups.add('__initialized__');
    }
}

function _buildGroup(groupName, groupData) {
    const groupKey = groupName;
    const groupEl  = document.createElement('div');
    groupEl.className = 'symbiose-ap-group';
    groupEl.dataset.group = groupName;
    if (_collapsedGroups.has(groupKey)) groupEl.classList.add('symbiose-ap-group--collapsed');

    const headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.className = 'symbiose-ap-group__header';
    const chevron = _chevronSvg('symbiose-ap-group__chevron');
    headerBtn.appendChild(chevron);
    headerBtn.appendChild(document.createTextNode(' ' + groupName));
    headerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_collapsedGroups.has(groupKey)) {
            _collapsedGroups.delete(groupKey);
            groupEl.classList.remove('symbiose-ap-group--collapsed');
        } else {
            _collapsedGroups.add(groupKey);
            groupEl.classList.add('symbiose-ap-group--collapsed');
        }
    });
    groupEl.appendChild(headerBtn);

    const body = document.createElement('div');
    body.className = 'symbiose-ap-group__body';

    // Agents directs du groupe
    groupData.agents.forEach(agent => body.appendChild(_buildItem(agent)));

    // Sous-groupes
    Object.entries(groupData.children ?? {}).forEach(([subName, subData]) => {
        const subKey = groupName + ' / ' + subName;
        const subEl  = document.createElement('div');
        subEl.className = 'symbiose-ap-subgroup';
        if (_collapsedGroups.has(subKey)) subEl.classList.add('symbiose-ap-group--collapsed');

        const subHeader = document.createElement('button');
        subHeader.type = 'button';
        subHeader.className = 'symbiose-ap-group__header symbiose-ap-group__header--sub';
        const subChevron = _chevronSvg('symbiose-ap-group__chevron');
        subHeader.appendChild(subChevron);
        subHeader.appendChild(document.createTextNode(' ' + subName));
        subHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_collapsedGroups.has(subKey)) {
                _collapsedGroups.delete(subKey);
                subEl.classList.remove('symbiose-ap-group--collapsed');
            } else {
                _collapsedGroups.add(subKey);
                subEl.classList.add('symbiose-ap-group--collapsed');
            }
        });
        subEl.appendChild(subHeader);

        const subBody = document.createElement('div');
        subBody.className = 'symbiose-ap-group__body';
        subData.agents.forEach(agent => subBody.appendChild(_buildItem(agent)));
        subEl.appendChild(subBody);
        body.appendChild(subEl);
    });

    groupEl.appendChild(body);
    return groupEl;
}

function _buildItem(agent) {
    const item = document.createElement('div');
    item.className = 'symbiose-ap-item';
    if (agent.id === _selectedId) {
        item.classList.add('symbiose-ap-item--active');
        item.setAttribute('aria-selected', 'true');
    } else {
        item.setAttribute('aria-selected', 'false');
    }
    item.setAttribute('role', 'option');
    item.dataset.agentId = agent.id;

    const name = document.createElement('span');
    name.className = 'symbiose-ap-item__name';
    name.textContent = agent.name;
    item.appendChild(name);

    if (agent.description) {
        const desc = document.createElement('span');
        desc.className = 'symbiose-ap-item__desc';
        desc.textContent = agent.description;
        item.appendChild(desc);
    }

    item.addEventListener('click', (e) => {
        e.stopPropagation();
        _selectAgent(agent.id);
    });
    return item;
}

// ── Logique métier ────────────────────────────────────────────────────────────

function _buildTree(agents) {
    const general = [];
    const groups  = {};

    agents.forEach(agent => {
        if (!agent.group) {
            general.push(agent);
            return;
        }
        const parts = agent.group.split('/').map(s => s.trim());
        const topGroup = parts[0];
        if (!groups[topGroup]) groups[topGroup] = { agents: [], children: {} };

        if (parts.length === 1) {
            groups[topGroup].agents.push(agent);
        } else {
            const subGroup = parts.slice(1).join(' / ');
            if (!groups[topGroup].children[subGroup]) {
                groups[topGroup].children[subGroup] = { agents: [] };
            }
            groups[topGroup].children[subGroup].agents.push(agent);
        }
    });

    return { general, groups };
}

function _filterAgents(query) {
    const q = _normalize(query);
    return _agents.filter(agent => {
        return _normalize(agent.name).includes(q) ||
               _normalize(agent.description ?? '').includes(q);
    });
}

function _normalize(str) {
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _selectAgent(agentId) {
    _selectedId = agentId;
    _close();
    _renderTriggerLabel();
    _onSelect?.(agentId);
}

function _openPanel() {
    if (_disabled) return;
    _isOpen = true;
    _container.classList.add('symbiose-agent-picker--open');
    const trigger = _container.querySelector('.symbiose-agent-picker__trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    _renderPanel();
    // Focus sur la recherche
    requestAnimationFrame(() => {
        _container?.querySelector('.symbiose-agent-picker__search input')?.focus();
    });
}

function _close() {
    _isOpen = false;
    _searchQuery  = '';
    _focusedIndex = -1;
    _container?.classList.remove('symbiose-agent-picker--open');
    const trigger = _container?.querySelector('.symbiose-agent-picker__trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    // Nettoie le panneau (pas de mémoire DOM inutile)
    _container?.querySelector('.symbiose-agent-picker__panel')?.remove();
}

// ── Gestionnaires d'événements ────────────────────────────────────────────────

function _onTriggerClick(e) {
    e.stopPropagation();
    if (_isOpen) _close(); else _openPanel();
}

function _onDocClick(e) {
    if (_isOpen && _container && !_container.contains(e.target)) _close();
}

function _onDocKeydown(e) {
    if (e.key === 'Escape' && _isOpen) _close();
}

function _onSearchInput(e) {
    _searchQuery  = e.target.value.trim();
    _focusedIndex = -1;
    _rebuildTree();
}

function _onSearchKeydown(e) {
    if (!_isOpen) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    e.preventDefault();

    const items = _getNavigableItems();
    if (e.key === 'ArrowDown') {
        _focusedIndex = Math.min(_focusedIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
        _focusedIndex = Math.max(_focusedIndex - 1, -1);
    } else if (e.key === 'Enter') {
        const focused = items[_focusedIndex];
        if (focused?.dataset.agentId) _selectAgent(focused.dataset.agentId);
        return;
    }
    _updateFocusedItem(items);
}

function _getNavigableItems() {
    const scope = _searchQuery
        ? _container?.querySelector('.symbiose-agent-picker__results')
        : _container?.querySelector('.symbiose-agent-picker__tree');
    if (!scope) return [];
    return Array.from(scope.querySelectorAll('.symbiose-ap-item'))
        .filter(el => !el.closest('.symbiose-ap-group--collapsed'));
}

function _updateFocusedItem(items) {
    _container?.querySelectorAll('.symbiose-ap-item--focused')
        .forEach(el => el.classList.remove('symbiose-ap-item--focused'));
    const target = items[_focusedIndex];
    if (target) {
        target.classList.add('symbiose-ap-item--focused');
        target.scrollIntoView({ block: 'nearest' });
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _chevronSvg(className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '6 9 12 15 18 9');
    svg.appendChild(poly);
    return svg;
}
