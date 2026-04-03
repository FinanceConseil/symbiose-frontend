// ── Moteurs de rendu : Markdown, LaTeX, Mermaid ───────────────────────────────

import { escHtml } from './utils.js';

// ── SVG → Canvas PNG (@2x) ────────────────────────────────────────────────────
// Exporté pour réutilisation dans export.js (diagrammes Mermaid → PNG/DOCX/PDF).

export function svgToCanvas(svgEl) {
    return new Promise((resolve) => {
        const vb      = svgEl.getAttribute('viewBox');
        const vbParts = vb ? vb.trim().split(/[\s,]+/) : [];
        const w  = parseFloat(vbParts[2]) || parseFloat(svgEl.getAttribute('width'))  || svgEl.getBoundingClientRect().width  || 800;
        const h  = parseFloat(vbParts[3]) || parseFloat(svgEl.getAttribute('height')) || svgEl.getBoundingClientRect().height || 600;
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width',  w);
        clone.setAttribute('height', h);
        const svgStr  = new XMLSerializer().serializeToString(clone);
        const bytes   = new TextEncoder().encode(svgStr);
        const binary  = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(binary);
        const img     = new Image();
        img.onload = () => {
            const canvas  = document.createElement('canvas');
            canvas.width  = w * 2;
            canvas.height = h * 2;
            const ctx     = canvas.getContext('2d');
            ctx.scale(2, 2);
            ctx.drawImage(img, 0, 0);
            resolve({ canvas, blob: () => new Promise((res) => canvas.toBlob(res, 'image/png')) });
        };
        img.src = dataUrl;
    });
}

// ── LaTeX ─────────────────────────────────────────────────────────────────────

export function renderLatex(text) {
    if (!window.katex) return text;
    // \[...\] → blocs display (avant marked pour éviter que \[ soit mangé)
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
        try { return window.katex.renderToString(math.trim(), { displayMode: true,  throwOnError: false }); }
        catch { return _; }
    });
    // \(...\) → inline
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
        try { return window.katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }); }
        catch { return _; }
    });
    return text;
}

export function renderMath(el) {
    if (window.renderMathInElement) {
        renderMathInElement(el, {
            delimiters: [
                { left: '$$',   right: '$$',   display: true  },
                { left: '$',    right: '$',    display: false },
                { left: '\\[', right: '\\]', display: true  },
                { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
        });
    }
}

// ── Markdown ──────────────────────────────────────────────────────────────────

// Tags autorisés par DOMPurify : markdown + KaTeX (span).
// Tout ce qui n'est pas dans cette liste est supprimé (div, form, input, iframe…).
const PURIFY_TAGS = [
    'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'strong', 'b', 'em', 'i', 'del', 's',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span',  // KaTeX utilise des spans avec styles inline
];
const PURIFY_ATTR = ['href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel'];

export function renderMarkdown(text) {
    if (!text) return '';
    // renderLatex doit tourner avant marked : marked échappe \( en ( et \[ en [,
    // ce qui empêche KaTeX auto-render de retrouver ses délimiteurs après coup.
    // Recoudre les liens markdown dont le texte s'étale sur plusieurs lignes
    // ex: "[ Prêt\n    immobilier](url)" → "[Prêt immobilier](url)"
    text = text.replace(/\[([^\]\n]*)\n[ \t]+([^\]\n]*)\]\(/g, '[$1 $2](');
    text = renderLatex(text);
    if (window.marked) {
        const raw = window.marked.parse(text);
        if (window.DOMPurify) {
            // Whitelist stricte : les tags non listés (div, form, script…) sont supprimés.
            // ADD_ATTR: style est nécessaire pour les spans KaTeX.
            return window.DOMPurify.sanitize(raw, {
                ALLOWED_TAGS: PURIFY_TAGS,
                ALLOWED_ATTR: PURIFY_ATTR,
            });
        }
        // DOMPurify non disponible : fallback texte brut sécurisé
        return escHtml(text).replace(/\n/g, '<br>');
    }
    // Fallback minimal si marked n'est pas disponible
    return escHtml(text).replace(/\n/g, '<br>');
}

// ── Bouton copier sur les blocs de code ───────────────────────────────────────

export function addCodeCopyButtons(containerEl) {
    if (!navigator.clipboard) return;

    containerEl.querySelectorAll('pre > code').forEach((codeEl) => {
        const pre = codeEl.parentElement;
        if (pre.closest('.symbiose-code-block') || pre.closest('.symbiose-mermaid')) return; // déjà traité
        if (codeEl.classList.contains('language-mermaid')) return; // géré par renderMermaidBlocks

        // Langue depuis la classe language-xxx ajoutée par marked
        const langClass = [...codeEl.classList].find((c) => c.startsWith('language-'));
        const lang = langClass ? langClass.replace('language-', '') : '';

        const wrapper = document.createElement('div');
        wrapper.className = 'symbiose-code-block';

        const toolbar = document.createElement('div');
        toolbar.className = 'symbiose-code-block__toolbar';

        if (lang) {
            const langEl = document.createElement('span');
            langEl.className = 'symbiose-code-block__lang';
            langEl.textContent = lang;
            toolbar.appendChild(langEl);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'symbiose-code-block__copy';
        copyBtn.textContent = '⎘ Copier';
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(codeEl.textContent || '');
                copyBtn.textContent = '✓ Copié';
                setTimeout(() => { copyBtn.textContent = '⎘ Copier'; }, 2000);
            } catch {
                copyBtn.textContent = '✗ Erreur';
                setTimeout(() => { copyBtn.textContent = '⎘ Copier'; }, 2000);
            }
        });
        toolbar.appendChild(copyBtn);

        wrapper.appendChild(toolbar);
        pre.before(wrapper);
        wrapper.appendChild(pre);
    });
}

// ── Pipeline unifié ───────────────────────────────────────────────────────────

// cache optionnel : Map<source → svg> partagée entre le stream et le finally
export async function renderContent(containerEl, text, cache = null) {
    if (!text) return;
    containerEl.innerHTML = renderMarkdown(text);
    await renderMermaidBlocks(containerEl, cache);
    addCodeCopyButtons(containerEl);
    renderMath(containerEl);
}

// ── Mermaid ───────────────────────────────────────────────────────────────────

let mermaidViewer = null;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getSvgSize(svgEl) {
    const viewBox = (svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
    const vbWidth = parseFloat(viewBox[2]);
    const vbHeight = parseFloat(viewBox[3]);
    if (vbWidth > 0 && vbHeight > 0) {
        return { width: vbWidth, height: vbHeight };
    }

    const attrWidth = parseFloat(svgEl.getAttribute('width'));
    const attrHeight = parseFloat(svgEl.getAttribute('height'));
    if (attrWidth > 0 && attrHeight > 0) {
        return { width: attrWidth, height: attrHeight };
    }

    try {
        const box = svgEl.getBBox();
        if (box.width > 0 && box.height > 0) {
            return { width: box.width, height: box.height };
        }
    } catch (_) { /* ignore */ }

    const rect = svgEl.getBoundingClientRect();
    return {
        width: Math.max(rect.width || 0, 320),
        height: Math.max(rect.height || 0, 240),
    };
}

function ensureMermaidViewer() {
    if (mermaidViewer) return mermaidViewer;

    const root = document.createElement('div');
    root.id = 'symbiose-mermaid-modal';
    root.className = 'symbiose-mermaid-modal';
    root.hidden = true;
    root.innerHTML = ''
        + '<div class="symbiose-mermaid-modal__panel" role="dialog" aria-modal="true" aria-label="Diagramme Mermaid en plein écran">'
        + '<div class="symbiose-mermaid-modal__header">'
        + '<div class="symbiose-mermaid-modal__title">Diagramme Mermaid</div>'
        + '<div class="symbiose-mermaid-modal__actions">'
        + '<button type="button" class="symbiose-mermaid-modal__reset">Réinitialiser</button>'
        + '<button type="button" class="symbiose-mermaid-modal__close">Fermer</button>'
        + '</div>'
        + '</div>'
        + '<div class="symbiose-mermaid-modal__viewport" tabindex="0">'
        + '<div class="symbiose-mermaid-modal__content"></div>'
        + '</div>'
        + '</div>';

    const viewport = root.querySelector('.symbiose-mermaid-modal__viewport');
    const content = root.querySelector('.symbiose-mermaid-modal__content');
    const resetBtn = root.querySelector('.symbiose-mermaid-modal__reset');
    const closeBtn = root.querySelector('.symbiose-mermaid-modal__close');

    const state = {
        svgWidth: 0,
        svgHeight: 0,
        baseScale: 1,
        zoom: 1,
        minZoom: 1,
        maxZoom: 6,
        translateX: 0,
        translateY: 0,
        isDragging: false,
        isPinching: false,
        dragPointerId: null,
        lastPoint: null,
        pinchDistance: 0,
        pinchMidpoint: null,
        pointers: new Map(),
        lastFocused: null,
        pointerMoved: false,
    };

    function getViewportCenterPoint(clientX, clientY) {
        const rect = viewport.getBoundingClientRect();
        return {
            x: clientX - rect.left - rect.width / 2,
            y: clientY - rect.top - rect.height / 2,
        };
    }

    function clampTranslation() {
        const rect = viewport.getBoundingClientRect();
        const scaledWidth = state.svgWidth * state.baseScale * state.zoom;
        const scaledHeight = state.svgHeight * state.baseScale * state.zoom;
        const limitX = Math.max(0, (scaledWidth - rect.width) / 2);
        const limitY = Math.max(0, (scaledHeight - rect.height) / 2);
        state.translateX = clamp(state.translateX, -limitX, limitX);
        state.translateY = clamp(state.translateY, -limitY, limitY);
    }

    function updateTransform() {
        content.style.transform =
            `translate(-50%, -50%) translate(${state.translateX}px, ${state.translateY}px) scale(${state.baseScale * state.zoom})`;
        viewport.classList.toggle('symbiose-mermaid-modal__viewport--pannable', state.zoom > 1.001);
        viewport.classList.toggle('symbiose-mermaid-modal__viewport--dragging', state.isDragging || state.isPinching);
    }

    function resetView() {
        state.zoom = 1;
        state.translateX = 0;
        state.translateY = 0;
        clampTranslation();
        updateTransform();
    }

    function syncBaseScale() {
        if (!state.svgWidth || !state.svgHeight) return;
        const rect = viewport.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        state.baseScale = Math.min(rect.width / state.svgWidth, rect.height / state.svgHeight, 1);
        clampTranslation();
        updateTransform();
    }

    function zoomAtPoint(nextZoom, clientX, clientY) {
        const zoom = clamp(nextZoom, state.minZoom, state.maxZoom);
        if (Math.abs(zoom - state.zoom) < 0.001) return;

        const point = getViewportCenterPoint(clientX, clientY);
        const oldScale = state.baseScale * state.zoom;
        const newScale = state.baseScale * zoom;
        if (oldScale > 0 && newScale > 0) {
            state.translateX = point.x - ((point.x - state.translateX) * (newScale / oldScale));
            state.translateY = point.y - ((point.y - state.translateY) * (newScale / oldScale));
        }

        state.zoom = zoom;
        clampTranslation();
        updateTransform();
    }

    function closeViewer() {
        root.hidden = true;
        content.innerHTML = '';
        state.isDragging = false;
        state.isPinching = false;
        state.dragPointerId = null;
        state.lastPoint = null;
        state.pointers.clear();
        state.pointerMoved = false;
        document.body.classList.remove('symbiose-mermaid-modal-open');
        if (state.lastFocused?.focus) state.lastFocused.focus();
    }

    function openViewer(svgEl) {
        const clone = svgEl.cloneNode(true);
        const { width, height } = getSvgSize(svgEl);
        state.svgWidth = width;
        state.svgHeight = height;
        state.lastFocused = document.activeElement;

        clone.removeAttribute('width');
        clone.removeAttribute('height');

        content.innerHTML = '';
        content.style.width = `${width}px`;
        content.style.height = `${height}px`;
        content.appendChild(clone);

        root.hidden = false;
        document.body.classList.add('symbiose-mermaid-modal-open');
        syncBaseScale();
        resetView();
        closeBtn.focus();
    }

    function getPointerSummary() {
        const points = Array.from(state.pointers.values());
        if (points.length < 2) return null;
        const [first, second] = points;
        return {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            midpoint: {
                x: (first.x + second.x) / 2,
                y: (first.y + second.y) / 2,
            },
        };
    }

    viewport.addEventListener('wheel', (event) => {
        if (root.hidden) return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAtPoint(state.zoom * factor, event.clientX, event.clientY);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
        if (root.hidden) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        event.preventDefault();
        viewport.setPointerCapture(event.pointerId);
        state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        state.pointerMoved = false;

        if (event.pointerType === 'touch' && state.pointers.size === 2) {
            const pinch = getPointerSummary();
            if (pinch) {
                state.isPinching = true;
                state.isDragging = false;
                state.dragPointerId = null;
                state.pinchDistance = pinch.distance;
                state.pinchMidpoint = pinch.midpoint;
                updateTransform();
            }
            return;
        }

        if (state.zoom > 1.001) {
            state.isDragging = true;
            state.dragPointerId = event.pointerId;
            state.lastPoint = { x: event.clientX, y: event.clientY };
            updateTransform();
        }
    });

    viewport.addEventListener('pointermove', (event) => {
        if (root.hidden) return;
        if (state.pointers.has(event.pointerId)) {
            state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        if (state.isPinching && state.pointers.size >= 2) {
            const pinch = getPointerSummary();
            if (!pinch || !state.pinchDistance) return;
            state.pointerMoved = true;
            state.translateX += pinch.midpoint.x - state.pinchMidpoint.x;
            state.translateY += pinch.midpoint.y - state.pinchMidpoint.y;
            zoomAtPoint(state.zoom * (pinch.distance / state.pinchDistance), pinch.midpoint.x, pinch.midpoint.y);
            state.pinchDistance = pinch.distance;
            state.pinchMidpoint = pinch.midpoint;
            return;
        }

        if (!state.isDragging || state.dragPointerId !== event.pointerId || !state.lastPoint) return;

        const deltaX = event.clientX - state.lastPoint.x;
        const deltaY = event.clientY - state.lastPoint.y;
        if (deltaX || deltaY) {
            state.pointerMoved = true;
            state.translateX += deltaX;
            state.translateY += deltaY;
            state.lastPoint = { x: event.clientX, y: event.clientY };
            clampTranslation();
            updateTransform();
        }
    });

    function releasePointer(event) {
        state.pointers.delete(event.pointerId);
        if (state.dragPointerId === event.pointerId) {
            state.isDragging = false;
            state.dragPointerId = null;
            state.lastPoint = null;
        }

        if (state.pointers.size < 2) {
            state.isPinching = false;
            state.pinchDistance = 0;
            state.pinchMidpoint = null;
        }

        updateTransform();
        setTimeout(() => { state.pointerMoved = false; }, 0);
    }

    viewport.addEventListener('pointerup', releasePointer);
    viewport.addEventListener('pointercancel', releasePointer);
    viewport.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'mouse') return;
        releasePointer(event);
    });

    resetBtn.addEventListener('click', resetView);
    closeBtn.addEventListener('click', closeViewer);

    root.addEventListener('click', (event) => {
        if (event.target === root && !state.pointerMoved) closeViewer();
    });

    document.addEventListener('keydown', (event) => {
        if (root.hidden) return;
        if (event.key === 'Escape') closeViewer();
    });

    window.addEventListener('resize', () => {
        if (root.hidden) return;
        syncBaseScale();
    });

    (document.getElementById('symbiose-app') || document.body).appendChild(root);

    mermaidViewer = { openViewer, closeViewer };
    return mermaidViewer;
}

// Construit le wrapper .symbiose-mermaid avec toolbar et listeners.
// svg doit déjà avoir le bon viewBox (appelé après adjustMermaidViewBox).
function buildMermaidWrapper(source, svg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'symbiose-mermaid';
    wrapper.innerHTML =
        '<div class="symbiose-mermaid__diagram">' + svg + '</div>'
        + '<div class="symbiose-mermaid__toolbar">'
        + '<button class="symbiose-mermaid__fullscreen" aria-label="Ouvrir le diagramme en plein écran"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-.1em;margin-right:4px"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>Plein écran</button>'
        + '<button class="symbiose-mermaid__toggle-code">{ } Code</button>'
        + '<button class="symbiose-mermaid__dl-svg">↓ SVG</button>'
        + '<button class="symbiose-mermaid__dl-png">↓ PNG</button>'
        + (navigator.clipboard ? '<button class="symbiose-mermaid__copy-png">⎘ Copier</button>' : '')
        + '</div>'
        + '<pre class="symbiose-mermaid__source" hidden><code>' + escHtml(source) + '</code></pre>';

    wrapper.querySelector('.symbiose-mermaid__fullscreen').addEventListener('click', () => {
        const svgEl = wrapper.querySelector('svg');
        if (svgEl) ensureMermaidViewer().openViewer(svgEl);
    });

    wrapper.querySelector('.symbiose-mermaid__toggle-code').addEventListener('click', () => {
        const src = wrapper.querySelector('.symbiose-mermaid__source');
        src.hidden = !src.hidden;
    });

    wrapper.querySelector('.symbiose-mermaid__dl-svg').addEventListener('click', () => {
        const svgEl = wrapper.querySelector('svg');
        const blob  = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
        const a     = document.createElement('a');
        a.href      = URL.createObjectURL(blob);
        a.download  = 'diagram.svg';
        a.click();
        URL.revokeObjectURL(a.href);
    });

    wrapper.querySelector('.symbiose-mermaid__dl-png').addEventListener('click', async () => {
        const { canvas } = await svgToCanvas(wrapper.querySelector('svg'));
        const a    = document.createElement('a');
        a.href     = canvas.toDataURL('image/png');
        a.download = 'diagram.png';
        a.click();
    });

    if (navigator.clipboard) {
        wrapper.querySelector('.symbiose-mermaid__copy-png').addEventListener('click', async () => {
            const btn = wrapper.querySelector('.symbiose-mermaid__copy-png');
            try {
                const { blob } = await svgToCanvas(wrapper.querySelector('svg'));
                const pngBlob  = await blob();
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                btn.textContent = '✓ Copié';
                setTimeout(() => { btn.textContent = '⎘ Copier'; }, 2000);
            } catch (err) {
                console.warn('[FCC] copy PNG failed:', err);
                btn.textContent = '✗ Erreur';
                setTimeout(() => { btn.textContent = '⎘ Copier'; }, 2000);
            }
        });
    }

    return wrapper;
}

// Recalibre le viewBox après insertion dans le DOM (getBBox nécessite un élément visible).
function adjustMermaidViewBox(wrapper) {
    const svgEl = wrapper.querySelector('svg');
    if (!svgEl) return;
    try {
        const bbox = svgEl.getBBox();
        const pad  = 8;
        svgEl.setAttribute('viewBox',
            `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
    } catch (_) { /* SVG non visible, viewBox original conservé */ }
}

// Rend un seul bloc mermaid, remplace le <pre> dans le DOM,
// stocke le SVG ajusté dans le cache (si fourni).
export async function renderMermaidBlock(pre, source, cache = null) {
    if (!window.mermaid) return;
    const key = source.trim();
    const id = 'symbiose-mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    try {
        // Pas de sanitisation supplémentaire : mermaid v11 + securityLevel:'strict'
        // sanitise son SVG en interne. Une double-sanitisation DOMPurify détruirait
        // les éléments <style> et attributs SVG nécessaires au rendu du texte.
        const { svg } = await mermaid.render(id, key);
        const wrapper = buildMermaidWrapper(key, svg);
        pre.replaceWith(wrapper);
        adjustMermaidViewBox(wrapper);
        // Mettre en cache le SVG avec son viewBox déjà ajusté pour la restauration instantanée
        if (cache) cache.set(key, wrapper.querySelector('svg')?.outerHTML || svg);
    } catch (err) {
        console.warn('[FCC] mermaid render error:', err);
        const errMsg = (err?.message || String(err)).slice(0, 200);
        const errBox = document.createElement('div');
        errBox.className = 'symbiose-mermaid-error';
        errBox.innerHTML = '<strong>Diagramme non rendu</strong><br><code>' + escHtml(errMsg) + '</code>';
        pre.replaceWith(errBox);
    }
}

// Restaure synchroniquement les blocs déjà en cache (aucun appel mermaid.render).
// Utilisé à chaque chunk pour éviter le clignotement des diagrammes déjà rendus.
// Ajuste le viewBox après insertion (nécessaire quand le SVG vient de renderMermaidToCache).
export function restoreMermaidFromCache(containerEl, cache) {
    if (!cache || !cache.size) return;
    containerEl.querySelectorAll('pre > code.language-mermaid').forEach(codeEl => {
        const source = (codeEl.textContent || '').trim();
        if (cache.has(source)) {
            const wrapper = buildMermaidWrapper(source, cache.get(source));
            codeEl.parentElement.replaceWith(wrapper);
            adjustMermaidViewBox(wrapper);
            // Mettre en cache le SVG avec viewBox ajusté pour les restaurations suivantes
            const adjustedSvg = wrapper.querySelector('svg')?.outerHTML;
            if (adjustedSvg) cache.set(source, adjustedSvg);
        }
    });
}

// Rend un bloc mermaid vers le cache uniquement, sans modifier le DOM.
// Les erreurs sont silencieuses : renderContent les affichera en fin de stream.
export async function renderMermaidToCache(source, cache) {
    const key = source.trim();
    if (!window.mermaid || cache.has(key)) return;
    const id = 'symbiose-mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    try {
        const { svg } = await mermaid.render(id, key);
        cache.set(key, svg);
    } catch {
        // Silencieux pendant le streaming — renderContent gère l'affichage d'erreur après
    }
}

// Rend tous les blocs mermaid d'un container.
// Si cache fourni : restaure les blocs connus, rend seulement les nouveaux.
export async function renderMermaidBlocks(containerEl, cache = null) {
    if (!window.mermaid) return;
    const codeEls = containerEl.querySelectorAll('pre > code.language-mermaid');
    for (const codeEl of codeEls) {
        const source = (codeEl.textContent || '').trim();
        const pre    = codeEl.parentElement;
        if (cache && cache.has(source)) {
            const wrapper = buildMermaidWrapper(source, cache.get(source));
            pre.replaceWith(wrapper);
        } else {
            await renderMermaidBlock(pre, source, cache);
        }
    }
}
