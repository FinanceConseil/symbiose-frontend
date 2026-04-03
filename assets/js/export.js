// ── Copie et export des messages (PDF, DOCX, presse-papier) ──────────────────

import { svgToCanvas } from './render.js';
import { checkSvg } from './utils.js';

// ── Préparation ───────────────────────────────────────────────────────────────

export async function prepareBubbleForExport(bubbleEl) {
    const clone = bubbleEl.cloneNode(true);

    // WordPress/Twemoji remplace les emojis Unicode par des <img class="emoji">.
    // On restaure le caractère original (alt) pour éviter des images surdimensionnées à l'export.
    clone.querySelectorAll('img.emoji').forEach(img => img.replaceWith(img.alt || ''));

    const svgs = bubbleEl.querySelectorAll('.symbiose-mermaid__diagram svg');
    const clonedContainers = clone.querySelectorAll('.symbiose-mermaid__diagram');

    for (let i = 0; i < svgs.length; i++) {
        const { canvas } = await svgToCanvas(svgs[i]);
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.style.maxWidth = '100%';
        clonedContainers[i].innerHTML = '';
        clonedContainers[i].appendChild(img);
    }

    clone.querySelectorAll('.symbiose-mermaid__toolbar, .symbiose-mermaid__source, .symbiose-code-block__toolbar').forEach((el) => el.remove());
    return clone;
}

// ── Copie dans le presse-papier ───────────────────────────────────────────────

export async function copyBubble(bubbleEl) {
    const clone = await prepareBubbleForExport(bubbleEl);
    const html = '<html><body>' + clone.innerHTML + '</body></html>';
    const blob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([clone.textContent], { type: 'text/plain' });
    await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
    ]);
}

// ── Export PDF ────────────────────────────────────────────────────────────────

export async function exportToPdf(bubbleEl, title) {
    title = title || 'export';
    const clone = await prepareBubbleForExport(bubbleEl);
    clone.style.border = 'none';
    clone.style.boxShadow = 'none';
    clone.style.borderRadius = '0';
    clone.style.padding = '0';
    const container = document.createElement('div');
    container.className = 'symbiose-msg--assistant';
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;padding:32px;background:#fff;font-size:14px;line-height:1.6';
    container.appendChild(clone);
    const mountPoint = document.getElementById('symbiose-app') || document.body;
    mountPoint.appendChild(container);
    try {
        const canvas = await window.html2canvas(container, { scale: 1.5, useCORS: true, backgroundColor: '#fff' });
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'px', format: 'a4' });
        const pdfW = pdf.internal.pageSize.getWidth();
        const ratio = pdfW / canvas.width;
        const pdfH = canvas.height * ratio;
        let y = 0;
        const pageH = pdf.internal.pageSize.getHeight();
        while (y < pdfH) {
            if (y > 0) pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, -y, pdfW, pdfH, 'export-img');
            y += pageH;
        }
        pdf.save(title + '.pdf');
    } finally {
        mountPoint.removeChild(container);
    }
}

// ── Export DOCX ───────────────────────────────────────────────────────────────

export async function exportToDocx(bubbleEl, title) {
    title = title || 'export';
    const clone = await prepareBubbleForExport(bubbleEl);
    const MAX_IMG_W = 550;
    for (const img of clone.querySelectorAll('img')) {
        await new Promise((resolve) => {
            const tmp = new Image();
            tmp.onload = () => {
                const scale = Math.min(1, MAX_IMG_W / tmp.naturalWidth);
                img.setAttribute('width',  Math.round(tmp.naturalWidth  * scale));
                img.setAttribute('height', Math.round(tmp.naturalHeight * scale));
                resolve();
            };
            tmp.src = img.src;
        });
    }
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
        + '<style>body{font-family:Calibri,sans-serif;font-size:11pt;color:#1a3235}'
        + 'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px}'
        + 'th{background:#e0f7f8}img{max-width:100%}</style></head>'
        + '<body>' + clone.innerHTML + '</body></html>';
    const blob = window.htmlDocx.asBlob(html);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.docx';
    a.click();
    URL.revokeObjectURL(url);
}

// ── Barre d'actions sur les messages ─────────────────────────────────────────

export function addMessageActions(msgEl, role, text) {
    const bubble = msgEl.querySelector('.symbiose-msg__bubble');
    if (!bubble) return;

    const bar = document.createElement('div');
    bar.className = 'symbiose-msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'symbiose-icon-btn symbiose-msg-action-btn';
    copyBtn.title = 'Copier';
    const copyIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.innerHTML = copyIconSvg;
    copyBtn.addEventListener('click', async () => {
        try {
            await copyBubble(bubble);
            copyBtn.classList.add('symbiose-msg-action-btn--done');
            copyBtn.innerHTML = checkSvg();
            setTimeout(() => {
                copyBtn.classList.remove('symbiose-msg-action-btn--done');
                copyBtn.innerHTML = copyIconSvg;
            }, 1500);
        } catch (err) {
            console.warn('[FCC] copyBubble failed:', err);
        }
    });
    bar.appendChild(copyBtn);

    if (role === 'assistant') {
        const title = (text || '').slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_') || 'message';

        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'symbiose-icon-btn symbiose-msg-action-btn';
        pdfBtn.title = 'Exporter en PDF';
        pdfBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>';
        pdfBtn.addEventListener('click', () => exportToPdf(bubble, title));
        bar.appendChild(pdfBtn);

        const docxBtn = document.createElement('button');
        docxBtn.className = 'symbiose-icon-btn symbiose-msg-action-btn';
        docxBtn.title = 'Exporter en DOCX';
        docxBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';
        docxBtn.addEventListener('click', () => exportToDocx(bubble, title));
        bar.appendChild(docxBtn);
    }

    const toolsZone = msgEl.querySelector('.symbiose-tools-zone');
    toolsZone ? msgEl.insertBefore(bar, toolsZone) : msgEl.appendChild(bar);
}
