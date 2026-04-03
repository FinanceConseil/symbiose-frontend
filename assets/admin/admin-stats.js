/* ── Symbiose — Admin Stats ─────────────────────────────────────────────── */
/* global symbioseAdminConfig */

(function () {
  'use strict'

  const cfg        = window.symbioseAdminConfig || {}
  const JWT        = cfg.jwt        || ''
  const BACKEND    = cfg.backendUrl || ''
  const container  = document.getElementById('symbiose-admin-stats')

  if (!container || !JWT || !BACKEND) return

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function fmt(n, decimals = 0) {
    return Number(n ?? 0).toLocaleString('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  function fmtCost(n) {
    const val = Number(n ?? 0)
    if (val === 0) return '—'
    if (val < 0.001) return '< 0,001 $'
    return val.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 4 }) + ' $'
  }

  function fmtTokens(n) {
    const val = Number(n ?? 0)
    if (val === 0) return '—'
    if (val >= 1_000_000) return fmt(Math.round(val / 1000) / 1000, 3) + ' M'
    if (val >= 1_000)     return fmt(Math.round(val / 100) / 10, 1) + ' k'
    return fmt(val)
  }

  function firstOfMonth() {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  }

  function today() {
    return new Date().toISOString().slice(0, 10)
  }

  const SYSTEM_TYPE_LABELS = {
    ocr:         'OCR',
    embed:       'Embedding',
    compact:     'Compaction',
    doc_summary: 'Résumé doc',
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(BACKEND + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    if (res.status === 204) return null
    return res.json()
  }

  // ── Rendu — Synthèse conversations (KPI cards) ────────────────────────────

  function renderConvSummary(summary, hasUserFilter) {
    const inferenceCost = Number(summary.inference_cost ?? 0)
    const systemCost    = Number(summary.system_cost    ?? 0)
    const totalCost     = inferenceCost + systemCost
    const totalConv     = Number(summary.total_conversations ?? 0)
    const avgCostPerConv = totalConv > 0 ? totalCost / totalConv : 0

    const cards = [
      { label: 'Conversations',      value: fmt(summary.total_conversations) },
      { label: 'Messages / conv',    value: fmt(summary.avg_messages_per_conv, 1) },
      ...(!hasUserFilter ? [{ label: 'Utilisateurs actifs', value: fmt(summary.active_users) }] : []),
      { label: 'Coût inférence',     value: fmtCost(inferenceCost) },
      { label: 'Coût système',       value: fmtCost(systemCost) },
      { label: 'Coût total',         value: fmtCost(totalCost), highlight: true },
      { label: 'Coût moyen / conv',  value: fmtCost(avgCostPerConv) },
    ]

    const cardsHtml = cards.map((c) =>
      `<div class="symbiose-kpi-card${c.highlight ? ' symbiose-kpi-card--highlight' : ''}">
        <div class="symbiose-kpi-value">${esc(c.value)}</div>
        <div class="symbiose-kpi-label">${esc(c.label)}</div>
      </div>`
    ).join('')

    return `<div class="symbiose-kpi-row">${cardsHtml}</div>`
  }

  // ── Rendu — Synthèse des coûts ────────────────────────────────────────────

  function renderCostSummary(inferenceByModel, system) {
    const rows = []
    let grandTotal = 0

    // Lignes inférence LLM
    for (const m of inferenceByModel) {
      const costTotal = Number(m.cost_input ?? 0) + Number(m.cost_output ?? 0)
      grandTotal += costTotal
      rows.push(`<tr>
        <td>Inférence LLM</td>
        <td>${esc(m.model || '—')}</td>
        <td class="num">${fmtTokens(m.tokens_input)}</td>
        <td class="num">${fmtTokens(m.tokens_output)}</td>
        <td class="num cost">${fmtCost(costTotal)}</td>
      </tr>`)
    }

    // Lignes opérations système
    for (const s of system) {
      const cost = Number(s.estimated_cost ?? 0)
      grandTotal += cost
      const isPages = s.price_unit === 'per_thousand_pages'
      const volIn   = isPages
        ? `${fmt(s.units_input)} pages`
        : fmtTokens(s.units_input)
      const volOut  = !isPages && Number(s.units_output) > 0
        ? fmtTokens(s.units_output)
        : '—'
      const label = SYSTEM_TYPE_LABELS[s.type] ?? esc(s.type)
      rows.push(`<tr>
        <td>${label}</td>
        <td>${esc(s.model || '—')}</td>
        <td class="num">${volIn}</td>
        <td class="num">${volOut}</td>
        <td class="num cost">${fmtCost(cost)}</td>
      </tr>`)
    }

    if (!rows.length) return '<p class="symbiose-stats-empty">Aucun coût sur cette période.</p>'

    return `
      <table class="symbiose-stats-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Modèle</th>
            <th class="num">Volume entrée</th>
            <th class="num">Volume sortie</th>
            <th class="num">Coût ($)</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
        <tfoot>
          <tr>
            <td colspan="4"><strong>Total</strong></td>
            <td class="num cost"><strong>${fmtCost(grandTotal)}</strong></td>
          </tr>
        </tfoot>
      </table>`
  }

  // ── Rendu — Agents ────────────────────────────────────────────────────────

  function renderAgents(agents) {
    if (!agents.length) return '<p class="symbiose-stats-empty">Aucun agent utilisé sur cette période.</p>'

    const rows = agents.map((a) => {
      const costPerConv = a.usages_count > 0
        ? Number(a.estimated_cost) / Number(a.usages_count)
        : 0
      return `<tr>
        <td>${esc(a.agent_id)}</td>
        <td class="num">${fmt(a.usages_count)}</td>
        <td class="num">${fmt(a.messages_count)}</td>
        <td class="num">${fmt(a.tokens_input)}</td>
        <td class="num">${fmt(a.tokens_output)}</td>
        <td class="num">${fmtCost(a.estimated_cost)}</td>
        <td class="num">${fmtCost(costPerConv)}</td>
      </tr>`
    }).join('')

    return `
      <table class="symbiose-stats-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th class="num">Conversations</th>
            <th class="num">Messages</th>
            <th class="num">Tokens entrée</th>
            <th class="num">Tokens sortie</th>
            <th class="num">Coût total ($)</th>
            <th class="num">Coût / conv ($)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  // ── Rendu — Tools / Skills ────────────────────────────────────────────────

  function renderSimpleCount(items, keyName) {
    if (!items.length) return '<p class="symbiose-stats-empty">Aucune utilisation sur cette période.</p>'
    const rows = items.map((i) => `
      <tr>
        <td>${esc(i[keyName])}</td>
        <td class="num">${fmt(i.usages_count)}</td>
      </tr>`).join('')
    return `
      <table class="symbiose-stats-table">
        <thead><tr><th>Nom</th><th class="num">Utilisations</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  // ── Rendu — Opérations système ────────────────────────────────────────────

  function renderSystemUsages(items) {
    if (!items.length) return '<p class="symbiose-stats-empty">Aucune opération système sur cette période.</p>'

    const rows = items.map((s) => {
      const isPages  = s.price_unit === 'per_thousand_pages'
      const volume   = isPages
        ? `${fmt(s.units_input)} page${Number(s.units_input) > 1 ? 's' : ''}`
        : `${fmt(Number(s.units_input) + Number(s.units_output))} tokens`
      return `
        <tr>
          <td>${esc(s.type)}</td>
          <td>${esc(s.model)}</td>
          <td class="num">${fmt(s.usages_count)}</td>
          <td class="num">${volume}</td>
          <td class="num">${fmtCost(s.estimated_cost)}</td>
        </tr>`
    }).join('')

    return `
      <table class="symbiose-stats-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Modèle</th>
            <th class="num">Appels</th>
            <th class="num">Volume</th>
            <th class="num">Coût ($)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  // ── Rendu — Tarification des modèles ─────────────────────────────────────

  const ADD_FORM = `
    <div class="symbiose-pricing-add-form">
      <h3>Ajouter un modèle</h3>
      <div class="symbiose-pricing-add-fields">
        <input type="text"   id="symbiose-new-model"    placeholder="Nom du modèle (ex. gpt-4o)">
        <input type="text"   id="symbiose-new-provider" placeholder="Fournisseur (ex. openai)">
        <select id="symbiose-new-unit">
          <option value="per_million_tokens">$ / M tokens</option>
          <option value="per_thousand_pages">$ / 1 000 pages</option>
        </select>
        <input type="number" id="symbiose-new-input"    placeholder="Prix entrée" step="0.001" min="0">
        <input type="number" id="symbiose-new-output"   placeholder="Prix sortie" step="0.001" min="0">
        <button class="symbiose-stats-btn" id="symbiose-add-model-btn">Ajouter</button>
      </div>
    </div>`

  function renderPricing(pricing) {
    if (!pricing.length) return '<p class="symbiose-stats-empty">Aucun modèle configuré.</p>' + ADD_FORM

    const rows = pricing.map((p) => {
      const isPages  = p.price_unit === 'per_thousand_pages'
      const unitBadge = isPages
        ? '<span class="symbiose-unit-badge symbiose-unit-pages">pages</span>'
        : '<span class="symbiose-unit-badge symbiose-unit-tokens">tokens</span>'
      return `
        <tr data-model="${esc(p.model)}">
          <td>${esc(p.model)} ${unitBadge}</td>
          <td>${esc(p.provider)}</td>
          <td class="num">
            <input type="number" class="symbiose-price-input" value="${Number(p.price_input)}" step="0.001" min="0" data-field="price_input">
          </td>
          <td class="num">
            <input type="number" class="symbiose-price-output" value="${Number(p.price_output)}" step="0.001" min="0" data-field="price_output">
          </td>
          <td>
            <button class="symbiose-pricing-save-btn" data-model="${esc(p.model)}" data-provider="${esc(p.provider)}" data-unit="${esc(p.price_unit || 'per_million_tokens')}">Enregistrer</button>
            <button class="symbiose-pricing-del-btn"  data-model="${esc(p.model)}">Supprimer</button>
          </td>
        </tr>`
    }).join('')

    return `
      <table class="symbiose-stats-table">
        <thead>
          <tr>
            <th>Modèle</th>
            <th>Fournisseur</th>
            <th class="num">Prix entrée ($)</th>
            <th class="num">Prix sortie ($)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="padding:8px 20px;font-size:0.8rem;color:#666">Tokens : $ / million de tokens — Pages : $ / 1 000 pages</p>
      ${ADD_FORM}`
  }

  // ── Chargement des stats ──────────────────────────────────────────────────

  async function loadStats(from, to, userId) {
    const sections = container.querySelector('.symbiose-stats-sections')
    sections.innerHTML = '<div class="symbiose-stats-loading">Chargement…</div>'

    const hasUserFilter = !!userId
    const userParam     = userId ? `&userId=${encodeURIComponent(userId)}` : ''

    // Bandeau utilisateur
    const banner = container.querySelector('.symbiose-user-banner')
    if (hasUserFilter && banner) {
      const userOpt = container.querySelector(`#symbiose-user-filter option[value="${CSS.escape(String(userId))}"]`)
      banner.textContent = userOpt ? `Filtre : ${userOpt.textContent}` : `Filtre : utilisateur #${userId}`
      banner.hidden = false
    } else if (banner) {
      banner.hidden = true
    }

    try {
      const data = await apiFetch(`/api/admin/stats?from=${from}&to=${to}${userParam}`)
      const cs   = data.conversation_summary ?? {}

      sections.innerHTML = `
        <div class="symbiose-stats-section">
          <h2>Synthèse des conversations</h2>
          ${renderConvSummary(cs, hasUserFilter)}
        </div>
        <div class="symbiose-stats-section">
          <h2>Synthèse des coûts</h2>
          ${renderCostSummary(data.inference_by_model || [], data.system || [])}
        </div>
        <div class="symbiose-stats-section">
          <h2>Agents</h2>
          ${renderAgents(data.agents || [])}
        </div>
        <div class="symbiose-stats-section">
          <h2>Tools</h2>
          ${renderSimpleCount(data.tools || [], 'tool_name')}
        </div>
        <div class="symbiose-stats-section">
          <h2>Skills</h2>
          ${renderSimpleCount(data.skills || [], 'skill_id')}
        </div>
        <div class="symbiose-stats-section">
          <h2>Opérations système</h2>
          ${renderSystemUsages(data.system || [])}
        </div>`
    } catch (err) {
      sections.innerHTML = `<div class="symbiose-stats-error">Erreur lors du chargement des statistiques : ${esc(err.message)}</div>`
    }
  }

  async function loadPricing() {
    const pricingSection = container.querySelector('.symbiose-pricing-section')
    pricingSection.innerHTML = '<div class="symbiose-stats-loading">Chargement…</div>'

    try {
      const data = await apiFetch('/api/admin/model-pricing')
      pricingSection.innerHTML = renderPricing(data)

      pricingSection.querySelectorAll('.symbiose-pricing-save-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const model      = btn.dataset.model
          const provider   = btn.dataset.provider
          const price_unit = btn.dataset.unit
          const row        = pricingSection.querySelector(`tr[data-model="${CSS.escape(model)}"]`)
          const price_input  = parseFloat(row.querySelector('.symbiose-price-input').value)
          const price_output = parseFloat(row.querySelector('.symbiose-price-output').value)

          btn.disabled = true
          btn.textContent = '…'
          try {
            await apiFetch(`/api/admin/model-pricing/${encodeURIComponent(model)}`, {
              method: 'PUT',
              body: JSON.stringify({ provider, price_input, price_output, price_unit }),
            })
            btn.textContent = '✓ Enregistré'
            btn.classList.add('saved')
            setTimeout(() => {
              btn.textContent = 'Enregistrer'
              btn.classList.remove('saved')
              btn.disabled = false
            }, 2000)
          } catch {
            btn.textContent = 'Erreur'
            btn.disabled = false
          }
        })
      })

      pricingSection.querySelectorAll('.symbiose-pricing-del-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Supprimer le modèle "${btn.dataset.model}" ?`)) return
          btn.disabled = true
          try {
            await apiFetch(`/api/admin/model-pricing/${encodeURIComponent(btn.dataset.model)}`, { method: 'DELETE' })
            await loadPricing()
          } catch {
            alert('Erreur lors de la suppression')
            btn.disabled = false
          }
        })
      })

      pricingSection.querySelector('#symbiose-add-model-btn').addEventListener('click', async () => {
        const model        = pricingSection.querySelector('#symbiose-new-model').value.trim()
        const provider     = pricingSection.querySelector('#symbiose-new-provider').value.trim()
        const price_unit   = pricingSection.querySelector('#symbiose-new-unit').value
        const price_input  = parseFloat(pricingSection.querySelector('#symbiose-new-input').value)
        const price_output = parseFloat(pricingSection.querySelector('#symbiose-new-output').value)

        if (!model || !provider || isNaN(price_input) || isNaN(price_output)) {
          alert('Tous les champs sont requis')
          return
        }
        const addBtn = pricingSection.querySelector('#symbiose-add-model-btn')
        addBtn.disabled = true
        try {
          await apiFetch(`/api/admin/model-pricing/${encodeURIComponent(model)}`, {
            method: 'PUT',
            body: JSON.stringify({ provider, price_input, price_output, price_unit }),
          })
          await loadPricing()
        } catch {
          alert("Erreur lors de l'ajout")
          addBtn.disabled = false
        }
      })

    } catch (err) {
      pricingSection.innerHTML = `<div class="symbiose-stats-error">Erreur : ${esc(err.message)}</div>`
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="symbiose-stats-filters">
      <label for="symbiose-from">Du</label>
      <input type="date" id="symbiose-from" value="${firstOfMonth()}">
      <label for="symbiose-to">au</label>
      <input type="date" id="symbiose-to" value="${today()}">
      <label for="symbiose-user-filter">Utilisateur</label>
      <select id="symbiose-user-filter">
        <option value="">Tous les utilisateurs</option>
      </select>
      <button class="symbiose-stats-btn" id="symbiose-load-btn">Charger</button>
    </div>
    <div class="symbiose-user-banner" hidden></div>
    <div class="symbiose-stats-sections"></div>
    <div class="symbiose-stats-section" style="margin-top:24px">
      <h2>Tarification des modèles</h2>
      <div class="symbiose-pricing-section"></div>
    </div>`

  const loadBtn    = container.querySelector('#symbiose-load-btn')
  const userSelect = container.querySelector('#symbiose-user-filter')

  function triggerLoad() {
    const from   = container.querySelector('#symbiose-from').value
    const to     = container.querySelector('#symbiose-to').value
    const userId = userSelect.value || null
    loadBtn.disabled = true
    loadStats(from, to, userId).finally(() => { loadBtn.disabled = false })
  }

  loadBtn.addEventListener('click', triggerLoad)
  userSelect.addEventListener('change', triggerLoad)

  // Charger la liste des utilisateurs et les stats initiales en parallèle
  Promise.all([
    apiFetch('/api/admin/users').then((users) => {
      if (!Array.isArray(users)) return
      users.forEach((u) => {
        const opt = document.createElement('option')
        opt.value = u.id
        opt.textContent = (u.display_name || u.email) + (u.display_name && u.email ? ` (${u.email})` : '')
        userSelect.appendChild(opt)
      })
    }).catch(() => {}),
    loadPricing(),
  ]).then(() => {
    triggerLoad()
  })
})()
