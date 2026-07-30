/* =====================================================================
   app.js — Knowledge Vault
   Biblioteca pessoal de resumos de podcasts e vídeos (TikTok/YouTube…).
   PWA estática, dados local-first + sync opcional, resumos via Claude.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- utilidades ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const view = $("#view");
  const uid = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nl2p = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

  const TYPES = {
    podcast: { e: "🎙️", label: "Podcast" },
    tiktok:  { e: "🎵", label: "TikTok" },
    youtube: { e: "▶️", label: "YouTube" },
    artigo:  { e: "📄", label: "Artigo" },
    outro:   { e: "📌", label: "Outro" },
  };
  const typeMeta = (t) => TYPES[t] || TYPES.outro;

  /** Vai buscar título/legenda automaticamente via oEmbed público (TikTok/YouTube) — sem chave,
   *  sem login, só o endpoint oficial pensado para embeds. Devolve null em silêncio se falhar
   *  (link privado, CORS, endpoint em baixo…) para nunca bloquear o preenchimento manual. */
  async function fetchOEmbed(url) {
    if (!url) return null;
    let endpoint = null;
    if (/tiktok\.com/i.test(url)) endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    else if (/youtube\.com|youtu\.be/i.test(url)) endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    if (!endpoint) return null;
    try {
      const r = await fetch(endpoint);
      if (!r.ok) return null;
      const j = await r.json();
      return { title: (j.title || "").trim(), author: (j.author_name || "").trim() };
    } catch (e) { return null; }
  }

  /* ---------- Bookmarklet: recolher uma pasta de Favoritos do TikTok ---------- */
  // Corre na aba do tiktok.com (sessão do próprio utilizador, disparado manualmente por ele —
  // não é scraping automatizado nem login simulado). Recolhe os links de vídeo visíveis na
  // página, faz scroll para carregar mais (a pasta usa scroll infinito), vai buscar a legenda
  // de cada um via oEmbed público, e copia tudo já formatado para colar em "Vários" aqui.
  const TIKTOK_BOOKMARKLET_SRC = `(async function(){
  var seen = new Set();
  var rx = /https:\\/\\/www\\.tiktok\\.com\\/@[\\w.-]+\\/video\\/\\d+/;
  function collect(){
    document.querySelectorAll('a[href*="/video/"]').forEach(function(a){
      var m = a.href.match(rx);
      if (m) seen.add(m[0]);
    });
  }
  collect();
  var origTitle = document.title;
  document.title = '⏳ A recolher vídeos…';
  var last = 0, stable = 0;
  for (var i = 0; i < 40 && stable < 3; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(function(r){ setTimeout(r, 700); });
    collect();
    if (seen.size === last) stable++; else stable = 0;
    last = seen.size;
  }
  if (!seen.size) { document.title = origTitle; alert('Não encontrei vídeos nesta página. Abre uma pasta de Favoritos com vídeos (tiktok.com/@teu_user/favorites) e tenta de novo.'); return; }
  var links = Array.from(seen);
  var out = [];
  for (var j = 0; j < links.length; j++) {
    document.title = '⏳ ' + (j+1) + '/' + links.length;
    try {
      var r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(links[j]));
      var d = await r.json();
      out.push(links[j] + '\\n' + (d.title || ''));
    } catch (e) { out.push(links[j]); }
    await new Promise(function(r){ setTimeout(r, 200); });
  }
  document.title = origTitle;
  var text = out.join('\\n\\n');
  // caixa de texto real (nao prompt()) — em varios browsers moveis o prompt() so mostra
  // uma linha e perde as quebras de linha entre videos; a textarea preserva-as sempre,
  // e o botao "Copiar" corre num clique novo e direto (execCommand funciona sempre assim).
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;font-family:sans-serif';
  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:12px;padding:16px;max-width:560px;width:100%;max-height:82vh;display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.5)';
  var h = document.createElement('div');
  h.textContent = links.length + ' vídeo(s) encontrado(s) — copia tudo e cola no Knowledge Vault em "Vários"';
  h.style.cssText = 'font-weight:700;color:#111;font-size:14px;line-height:1.4';
  var ta = document.createElement('textarea');
  ta.value = text; ta.readOnly = true;
  ta.style.cssText = 'width:100%;flex:1;min-height:220px;font-family:monospace;font-size:12px;color:#111;background:#f6f2ea;border:1px solid #d3c9b3;border-radius:8px;padding:10px;box-sizing:border-box';
  var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px';
  var copyBtn = document.createElement('button');
  copyBtn.textContent = '⧉ Copiar tudo';
  copyBtn.style.cssText = 'flex:1;padding:13px;background:#bd5227;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer';
  copyBtn.onclick = function(){
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    var okCopy = false;
    try { okCopy = document.execCommand('copy'); } catch (e) {}
    copyBtn.textContent = okCopy ? '✓ Copiado!' : 'Seleciona e copia (Ctrl/Cmd+C)';
  };
  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'Fechar';
  closeBtn.style.cssText = 'padding:13px 18px;background:#eee;color:#111;border:none;border-radius:8px;font-size:14px;cursor:pointer';
  closeBtn.onclick = function(){ ov.remove(); };
  row.appendChild(copyBtn); row.appendChild(closeBtn);
  box.appendChild(h); box.appendChild(ta); box.appendChild(row);
  ov.appendChild(box);
  document.body.appendChild(ov);
  ta.focus(); ta.select();
})();`;

  function detectType(url) {
    if (!url) return "outro";
    const u = url.toLowerCase();
    if (u.includes("tiktok.")) return "tiktok";
    if (u.includes("youtube.") || u.includes("youtu.be")) return "youtube";
    if (u.includes("spotify.") || u.includes("apple.com/") && u.includes("podcast") || u.includes("pca.st") || u.includes("podcast")) return "podcast";
    return "outro";
  }

  function relDate(ts) {
    if (!ts) return "";
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "agora";
    if (d < 3600) return `há ${Math.floor(d / 60)} min`;
    if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
    if (d < 604800) return `há ${Math.floor(d / 86400)} d`;
    return new Date(ts).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" });
  }

  /* ---------- UI helpers ---------- */
  const UI = {
    toast(msg) {
      const wrap = $("#toast");
      const el = document.createElement("div");
      el.className = "t"; el.textContent = msg;
      wrap.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 320); }, 2600);
    },
    openSheet(html) {
      const root = $("#modal-root");
      root.innerHTML = `<div class="scrim"><div class="sheet">${html}</div></div>`;
      const scrim = $(".scrim", root);
      scrim.addEventListener("click", (e) => { if (e.target === scrim) UI.closeSheet(); });
      return root;
    },
    closeSheet() { $("#modal-root").innerHTML = ""; },
  };
  window.UI = UI;

  /* ---------- dados ---------- */
  function vault() { return Store.ensure("vault", { entries: [], collections: [], chats: {} }); }
  const entries = () => vault().entries || [];
  const collections = () => vault().collections || [];
  const entryById = (id) => entries().find((e) => e.id === id);
  const collById = (id) => collections().find((c) => c.id === id);

  function addEntry(e) {
    Store.update("vault", (v) => { (v.entries = v.entries || []).unshift(e); });
  }
  function saveEntry(id, patch) {
    Store.update("vault", (v) => {
      const e = (v.entries || []).find((x) => x.id === id);
      if (e) Object.assign(e, patch, { updatedAt: Date.now() });
    });
  }
  function removeEntry(id) {
    Store.update("vault", (v) => { v.entries = (v.entries || []).filter((e) => e.id !== id); });
  }
  function addCollection(name, emoji) {
    const c = { id: "c" + Date.now().toString(36), name: name.trim(), emoji: emoji || "📁", createdAt: Date.now() };
    Store.update("vault", (v) => { (v.collections = v.collections || []).push(c); });
    return c;
  }
  function removeCollection(id) {
    Store.update("vault", (v) => {
      v.collections = (v.collections || []).filter((c) => c.id !== id);
      (v.entries || []).forEach((e) => { if (e.collectionId === id) e.collectionId = null; });
    });
  }
  function updateCollection(id, patch) {
    Store.update("vault", (v) => { const c = (v.collections || []).find((x) => x.id === id); if (c) Object.assign(c, patch); });
  }
  function entriesInCollection(id) {
    return entries().filter((e) => e.collectionId === id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  function chatHistory(id) { return (vault().chats || {})[id] || []; }
  function pushChatMsg(id, role, text) {
    Store.update("vault", (v) => { v.chats = v.chats || {}; (v.chats[id] = v.chats[id] || []).push({ role, text, when: Date.now() }); });
  }
  function clearChat(id) { Store.update("vault", (v) => { if (v.chats) v.chats[id] = []; }); }

  /* ---------- router ---------- */
  let route = { name: "library" };
  const libFilter = { q: "", type: "", collection: "", fav: false };

  function go(r) { route = r; render(); window.scrollTo(0, 0); }

  function setTab(name) {
    document.querySelectorAll("#tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
    $("#fab").style.display = (name === "library" || name === "folders") ? "flex" : "none";
  }
  const titles = {
    library: ["Biblioteca", "o teu conhecimento, organizado"],
    folders: ["Pastas", "coleções por tema"],
    settings: ["Definições", "IA, sincronização e cópia"],
  };
  function setHeader(name, sub) {
    const t = titles[name];
    $("#topTitle").textContent = (t ? t[0] : name);
    $("#topSub").textContent = sub != null ? sub : (t ? t[1] : "");
  }

  /* ---------- render principal ---------- */
  function render() {
    const n = route.name;
    if (n === "detail") { setTab("library"); renderDetail(route.id); return; }
    if (n === "collection") { setTab("folders"); renderCollection(route.id); return; }
    if (n === "plan") { setTab("folders"); renderPlan(route.id); return; }
    if (n === "chat") { setTab("folders"); renderChat(route.id); return; }
    setTab(n);
    if (n === "library") renderLibrary();
    else if (n === "folders") renderFolders();
    else if (n === "settings") renderSettings();
  }

  /* ---------- Biblioteca ---------- */
  function filteredEntries() {
    let list = entries().slice();
    const q = libFilter.q.trim().toLowerCase();
    if (libFilter.fav) list = list.filter((e) => e.favorite);
    if (libFilter.type) list = list.filter((e) => e.type === libFilter.type);
    if (libFilter.collection) list = list.filter((e) => e.collectionId === libFilter.collection);
    if (q) list = list.filter((e) => {
      const s = e.summary || {};
      return [e.title, s.tldr, (s.topics || []).join(" "), (s.takeaways || []).join(" "), e.raw]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderLibrary() {
    const total = entries().length;
    const activeColl = libFilter.collection ? collById(libFilter.collection) : null;
    setHeader("library", activeColl ? `pasta: ${activeColl.name}` : titles.library[1]);

    const list = filteredEntries();
    const typeChips = ["", "podcast", "tiktok", "youtube", "artigo", "outro"].map((t) => {
      const on = libFilter.type === t;
      const label = t === "" ? "Tudo" : `${typeMeta(t).e} ${typeMeta(t).label}`;
      return `<button class="pill ${on ? "on" : ""}" data-action="filter-type" data-type="${t}">${label}</button>`;
    }).join("");

    let html = `
      <div class="searchbar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="searchInput" type="search" placeholder="Pesquisar na biblioteca…" value="${esc(libFilter.q)}" />
      </div>
      <div class="chiprow" style="margin-top:12px">
        <button class="pill ${libFilter.fav ? "on" : ""}" data-action="filter-fav">⭐ Favoritos</button>
        ${typeChips}
      </div>`;

    if (activeColl) {
      html += `<div class="row between" style="margin-top:14px">
        <div class="pill on">${activeColl.emoji} ${esc(activeColl.name)}</div>
        <button class="btn btn-sm btn-ghost" data-action="clear-collection">✕ limpar</button>
      </div>`;
    }

    if (!total) {
      html += `<div class="empty">
        <span class="ico">📚</span>
        <div class="big-t">A tua biblioteca está vazia</div>
        <div>Adiciona o primeiro podcast ou vídeo no botão <b>+</b>.<br>Vou transformá-lo num resumo estruturado.</div>
        <button class="btn btn-primary" style="margin-top:16px" data-action="add">+ Adicionar conteúdo</button>
      </div>`;
    } else if (!list.length) {
      html += `<div class="empty"><span class="ico">🔍</span><div class="big-t">Sem resultados</div><div>Experimenta outra pesquisa ou filtro.</div></div>`;
    } else {
      html += `<div class="stack" style="margin-top:16px">` + list.map(entryCardHTML).join("") + `</div>`;
    }
    view.innerHTML = html;

    const si = $("#searchInput");
    if (si) si.addEventListener("input", (e) => { libFilter.q = e.target.value; debounceLib(); });
  }

  let libT;
  function debounceLib() { clearTimeout(libT); libT = setTimeout(() => { if (route.name === "library") { renderLibraryListOnly(); } }, 160); }
  function renderLibraryListOnly() {
    // re-render só a lista para não perder o foco do input
    const list = filteredEntries();
    let container = view.querySelector(".stack") || view.querySelector(".empty");
    const html = list.length
      ? `<div class="stack" style="margin-top:16px">${list.map(entryCardHTML).join("")}</div>`
      : `<div class="empty"><span class="ico">🔍</span><div class="big-t">Sem resultados</div><div>Experimenta outra pesquisa ou filtro.</div></div>`;
    if (container) { const tmp = document.createElement("div"); tmp.innerHTML = html; container.replaceWith(tmp.firstElementChild); }
  }

  function entryCardHTML(e, opts) {
    const s = e.summary || {};
    const tm = typeMeta(e.type);
    const coll = (opts && opts.hideCollection) ? null : (e.collectionId ? collById(e.collectionId) : null);
    return `<article class="entry-card" data-action="open" data-id="${e.id}">
      <div class="ec-top">
        <span class="type-badge ${e.type}">${tm.e} ${tm.label}</span>
        <span class="ec-date">${relDate(e.createdAt)}</span>
        ${e.favorite ? `<span class="fav">★</span>` : ""}
      </div>
      <h3 class="title">${esc(e.title)}</h3>
      ${s.tldr ? `<p class="tldr">${esc(s.tldr)}</p>` : ""}
      ${coll ? `<div class="meta"><span class="pill">${coll.emoji} ${esc(coll.name)}</span></div>` : ""}
    </article>`;
  }

  /* ---------- Pastas ---------- */
  function renderFolders() {
    setHeader("folders");
    const colls = collections();
    const counts = {};
    entries().forEach((e) => { if (e.collectionId) counts[e.collectionId] = (counts[e.collectionId] || 0) + 1; });
    const uncat = entries().filter((e) => !e.collectionId).length;

    let html = `<div class="folder-grid" style="margin-top:16px">
      <div class="folder" data-action="open-all">
        <div class="fico">🗂️</div>
        <div class="fname">Tudo</div>
        <div class="fcount">${entries().length} itens</div>
      </div>`;
    html += colls.map((c) => `
      <div class="folder" data-action="open-collection" data-id="${c.id}">
        ${c.plan ? `<span class="plan-flag">PLANO</span>` : ""}
        <button class="folder-edit" data-action="edit-collection" data-id="${c.id}" title="Editar pasta" aria-label="Editar pasta">✎</button>
        <div class="fico">${c.emoji}</div>
        <div class="fname">${esc(c.name)}</div>
        <div class="fcount">${counts[c.id] || 0} itens</div>
      </div>`).join("");
    if (uncat) html += `<div class="folder" data-action="open-none">
        <div class="fico">📌</div><div class="fname">Sem pasta</div><div class="fcount">${uncat} itens</div></div>`;
    html += `<div class="folder dashed" data-action="new-collection">
        <div class="fico">＋</div><div class="fname">Nova pasta</div></div>`;
    html += `</div>
      <p class="kv-fieldnote" style="margin-top:14px">Abre uma pasta para gerar um <b>plano único</b> a partir de todos os conteúdos lá dentro (ex.: juntar todos os alongamentos num só plano).</p>`;
    view.innerHTML = html;
  }

  /* ---------- Vista de pasta (com plano consolidado) ---------- */
  function renderCollection(id) {
    const c = collById(id);
    if (!c) { go({ name: "folders" }); return; }
    const list = entriesInCollection(id);
    setHeader("folders", "");
    $("#topTitle").textContent = "Pasta";
    $("#topSub").textContent = c.name;

    let html = `<div class="row between" style="margin:6px 0 2px">
        <button class="btn btn-ghost btn-sm" data-action="to-folders" style="padding-left:0">‹ Pastas</button>
        <div class="row" style="gap:4px">
          <button class="btn btn-ghost btn-sm" data-action="edit-collection" data-id="${id}">✎ Editar</button>
          <button class="btn btn-ghost btn-sm" data-action="del-collection" data-id="${id}">✕ Apagar</button>
        </div>
      </div>
      <div class="coll-head"><span class="em">${c.emoji}</span>
        <div><div class="nm">${esc(c.name)}</div><div class="ct">${list.length} ${list.length === 1 ? "conteúdo" : "conteúdos"}</div></div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:14px" data-action="open-chat" data-id="${id}">💬 Conversar sobre esta pasta</button>`;

    // Cartão do PLANO
    if (c.plan) {
      const p = c.plan;
      html += `<div class="plan-card" style="margin-top:14px">
        <div class="pk"><span class="dot"></span> Plano da pasta</div>
        <div class="pt">${esc(p.title)}</div>
        ${p.overview ? `<div class="po">${esc(p.overview)}</div>` : ""}
        <div class="pmeta">gerado de ${p.entryCount || list.length} conteúdo(s) · ${relDate(p.generatedAt)}</div>
        <div class="prow">
          <button class="btn btn-primary btn-sm" data-action="view-plan" data-id="${id}">Ver plano completo</button>
          <button class="btn btn-sm" data-action="gen-plan" data-id="${id}">↻ Atualizar</button>
        </div>
      </div>`;
    } else {
      const canGen = AI.configured && list.length >= 1;
      html += `<div class="plan-card plan-empty" style="margin-top:14px">
        <div class="pk" style="justify-content:center"><span class="dot"></span> Plano da pasta</div>
        <div class="pt" style="margin-top:8px">Junta tudo num só plano</div>
        <div class="ps">Em vez de resumos soltos, crio uma guia única a partir de todos os conteúdos desta pasta — um plano que podes seguir.</div>
        <button class="btn btn-primary" data-action="gen-plan" data-id="${id}" ${canGen ? "" : "disabled"}>✨ Gerar plano desta pasta</button>
        ${!AI.configured ? `<div class="kv-fieldnote">Configura a IA em Definições (grátis com o Gemini).</div>` : (!list.length ? `<div class="kv-fieldnote">Adiciona conteúdos a esta pasta primeiro.</div>` : "")}
      </div>`;
    }

    // Lista de conteúdos
    html += `<div class="row between"><div class="section-title" style="margin-bottom:0">Conteúdos</div>
      <button class="btn btn-ghost btn-sm" data-action="bulk-add" data-id="${id}">📋 Vários</button></div>`;
    if (!list.length) {
      html += `<div class="empty" style="padding:28px 12px"><span class="ico">📄</span><div class="big-t">Pasta vazia</div><div>Adiciona conteúdos com o botão + (ou "Vários" acima para colar vários vídeos de uma vez).</div></div>`;
    } else {
      html += `<div class="stack">` + list.map((e) => entryCardHTML(e, { hideCollection: true })).join("") + `</div>`;
    }
    view.innerHTML = html;
  }

  /* ---------- Vista de plano completo ---------- */
  function renderPlan(id) {
    const c = collById(id);
    if (!c || !c.plan) { go({ name: "collection", id }); return; }
    const p = c.plan;
    setHeader("folders", "");
    $("#topTitle").textContent = "Plano";
    $("#topSub").textContent = c.name;

    let html = `<button class="btn btn-ghost btn-sm" data-action="to-collection" data-id="${id}" style="margin:6px 0 2px;padding-left:0">‹ ${esc(c.emoji + " " + c.name)}</button>
      <div class="plan-hero">
        <div class="pk"><span class="dot"></span> Plano · ${c.emoji} ${esc(c.name)}</div>
        <div class="plan-title">${esc(p.title)}</div>
      </div>
      <div class="row wrap" style="margin-top:14px;gap:8px">
        <button class="btn btn-sm" data-action="gen-plan" data-id="${id}">↻ Regenerar</button>
        <button class="btn btn-sm" data-action="copy-plan" data-id="${id}">⧉ Copiar</button>
        <button class="btn btn-sm btn-danger" data-action="del-plan" data-id="${id}">🗑 Apagar plano</button>
      </div>`;

    if (p.overview) html += `<div class="summary-section"><div class="h">Visão geral</div><div class="tldr-block">${esc(p.overview)}</div></div>`;
    if (p.steps && p.steps.length) {
      html += `<div class="summary-section"><div class="h">O plano</div>`;
      html += p.steps.map((st, i) => `<div class="plan-step">
        <div class="sh"><span class="n">${String(i + 1).padStart(2, "0")}</span> ${esc(st.heading)}</div>
        ${(st.items && st.items.length) ? `<ul>${st.items.map((it) => planItemHTML(p, it)).join("")}</ul>` : ""}
      </div>`).join("");
      html += `</div>`;
    }
    if (p.principles && p.principles.length) {
      html += `<div class="summary-section"><div class="h">Princípios a lembrar</div><ul class="takeaways">${p.principles.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    }
    html += `<div class="summary-section"><div class="h">Fontes deste plano</div><div class="list">${entriesInCollection(id).map((e) => `<div class="item" data-action="open" data-id="${e.id}"><div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${typeMeta(e.type).label}</div></div><span class="muted">›</span></div>`).join("") || `<div class="muted tiny">—</div>`}</div></div>`;

    view.innerHTML = html;
  }

  /* ---------- Chat sobre uma pasta ---------- */
  function chatBubbleHTML(m) {
    return `<div class="chat-msg ${m.role}"><div class="bubble">${nl2p(m.text)}</div></div>`;
  }
  function renderChat(id) {
    const c = collById(id);
    if (!c) { go({ name: "folders" }); return; }
    const list = entriesInCollection(id);
    const hist = chatHistory(id);
    setHeader("folders", "");
    $("#topTitle").textContent = "Conversar";
    $("#topSub").textContent = c.name;

    const msgsHtml = hist.length ? hist.map(chatBubbleHTML).join("")
      : `<div class="empty" style="padding:34px 12px"><span class="ico">💬</span><div class="big-t">Pergunta o que quiseres</div>
          <div>${list.length ? `Baseio-me nos ${list.length} conteúdo(s) desta pasta.` : "A pasta ainda está vazia — adiciona conteúdos para eu ter com que responder."}</div></div>`;

    view.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-action="to-collection" data-id="${id}" style="margin:6px 0 2px;padding-left:0">‹ ${esc(c.emoji + " " + c.name)}</button>
      <div class="chat-thread" id="chatThread">${msgsHtml}</div>
      <div class="chat-inputbar">
        <textarea id="chatInput" rows="1" placeholder="${AI.configured ? "Escreve a tua pergunta…" : "Configura a IA em Definições primeiro"}" ${AI.configured ? "" : "disabled"}></textarea>
        <button class="btn btn-primary btn-icon" id="chatSend" aria-label="Enviar" ${AI.configured ? "" : "disabled"}>➤</button>
      </div>
      ${hist.length ? `<button class="btn btn-ghost btn-sm" id="chatClear" style="margin-top:8px">🗑 Limpar conversa</button>` : ""}
    `;
    const thread = $("#chatThread"); thread.scrollTop = thread.scrollHeight;

    async function send() {
      const inp = $("#chatInput");
      const msg = (inp.value || "").trim();
      if (!msg) return;
      if (!AI.configured) { UI.toast("Configura a IA em Definições"); return; }
      const before = chatHistory(id);
      pushChatMsg(id, "user", msg);
      renderChat(id);
      const t2 = $("#chatThread");
      t2.insertAdjacentHTML("beforeend", `<div class="chat-msg assistant loading"><div class="bubble"><span class="spin"></span></div></div>`);
      t2.scrollTop = t2.scrollHeight;
      try {
        const reply = await AI.chat(c.name, entriesInCollection(id), before, msg);
        pushChatMsg(id, "assistant", reply);
      } catch (err) {
        pushChatMsg(id, "assistant", "⚠️ " + (err.message || "Falhou a resposta."));
      }
      renderChat(id);
    }

    const sendBtn = $("#chatSend");
    if (sendBtn) sendBtn.addEventListener("click", send);
    const inp = $("#chatInput");
    if (inp) {
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
      setTimeout(() => inp.focus(), 50);
    }
    const clearBtn = $("#chatClear");
    if (clearBtn) clearBtn.addEventListener("click", () => { clearChat(id); renderChat(id); });
  }

  async function genPlan(id) {
    const c = collById(id); if (!c) return;
    if (!AI.configured) { UI.toast("Configura a IA em Definições"); return; }
    const list = entriesInCollection(id);
    if (!list.length) { UI.toast("Pasta vazia — adiciona conteúdos primeiro"); return; }
    UI.openSheet(`<div class="gen-box"><span class="spin"></span><div class="t">A criar o plano da pasta…</div><div class="s">A juntar ${list.length} conteúdo(s).</div></div>`);
    try {
      const plan = await AI.summarizePlan(c.name, list);
      plan.generatedAt = Date.now(); plan.entryCount = list.length;
      updateCollection(id, { plan });
      UI.closeSheet(); UI.toast("Plano criado ✨");
      go({ name: "plan", id });
    } catch (err) { UI.closeSheet(); UI.toast(err.message || "Falhou a geração do plano"); }
  }

  /** Resolve a fonte (1, 2, 3…) de um item do plano na entrada real, usando plan.sources
   *  (lista de ids guardada no momento da geração, na mesma ordem/numeração usada no prompt). */
  function resolvePlanSource(plan, source) {
    if (!source || !plan.sources) return null;
    const id = plan.sources[source - 1];
    return id ? entryById(id) : null;
  }
  /** Normaliza um item do plano (aceita string simples de planos antigos, ou {text, source}). */
  function planItem(it) { return typeof it === "string" ? { text: it, source: 0 } : (it || { text: "", source: 0 }); }

  function planItemHTML(plan, it) {
    const { text, source } = planItem(it);
    const src = resolvePlanSource(plan, source);
    if (!src) return `<li><span class="pi-tx">${esc(text)}</span></li>`;
    const link = src.url
      ? `<a class="plan-vid" href="${esc(src.url)}" target="_blank" rel="noopener">▶ Ver vídeo</a>`
      : `<button class="plan-vid" data-action="open" data-id="${src.id}">▶ Ver fonte</button>`;
    return `<li><span class="pi-tx">${esc(text)}</span>${link}</li>`;
  }

  function planToText(c) {
    const p = c.plan; if (!p) return "";
    const L = [`# ${p.title}`, ""];
    if (p.overview) L.push(p.overview, "");
    (p.steps || []).forEach((st, i) => {
      L.push(`## ${i + 1}. ${st.heading}`);
      (st.items || []).forEach((raw) => {
        const { text, source } = planItem(raw);
        const src = resolvePlanSource(p, source);
        L.push(`- ${text}` + (src && src.url ? ` (${src.url})` : ""));
      });
      L.push("");
    });
    if (p.principles && p.principles.length) { L.push("## Princípios"); p.principles.forEach((x) => L.push(`- ${x}`)); }
    return L.join("\n");
  }

  /* ---------- Detalhe (a "bíblia") ---------- */
  function renderDetail(id) {
    const e = entryById(id);
    if (!e) { go({ name: "library" }); return; }
    const s = e.summary || {};
    const tm = typeMeta(e.type);
    const coll = e.collectionId ? collById(e.collectionId) : null;
    setHeader("library", "");
    $("#topTitle").textContent = "Resumo";
    $("#topSub").textContent = tm.label;

    const done = e.actionsDone || {};
    const sec = (title, body) => body ? `<div class="summary-section"><div class="h">${title}</div>${body}</div>` : "";

    let html = `
      <button class="btn btn-ghost btn-sm" data-action="back" style="margin:6px 0 4px;padding-left:0">‹ Voltar</button>
      <div class="detail-hero">
        <div class="kicker">
          <span class="type-badge ${e.type}">${tm.e} ${tm.label}</span>
          ${coll ? `<span class="pill" style="padding:2px 10px">${coll.emoji} ${esc(coll.name)}</span>` : ""}
          <span class="tiny muted">${relDate(e.createdAt)}</span>
        </div>
        <div class="detail-title">${esc(e.title)}</div>
        ${e.url ? `<div class="detail-src"><a class="link" href="${esc(e.url)}" target="_blank" rel="noopener">🔗 Abrir fonte original</a></div>` : ""}
      </div>

      <div class="row wrap" style="margin-top:16px;gap:8px">
        <button class="btn btn-sm ${e.favorite ? "btn-soft" : ""}" data-action="fav" data-id="${e.id}">${e.favorite ? "★ Favorito" : "☆ Favorito"}</button>
        <button class="btn btn-sm" data-action="edit" data-id="${e.id}">✎ Editar</button>
        <button class="btn btn-sm" data-action="regen" data-id="${e.id}">↻ Regenerar</button>
        <button class="btn btn-sm" data-action="copy" data-id="${e.id}">⧉ Copiar</button>
        <button class="btn btn-sm btn-danger" data-action="del" data-id="${e.id}">🗑 Apagar</button>
      </div>`;

    html += sec("TL;DR", s.tldr ? `<div class="tldr-block">${esc(s.tldr)}</div>` : "");
    html += sec("Pontos-chave", (s.takeaways && s.takeaways.length)
      ? `<ul class="takeaways">${s.takeaways.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "");
    html += sec("Notas detalhadas", (s.sections && s.sections.length)
      ? `<div class="notes-block">${s.sections.map((x) => `<div class="sub">${esc(x.heading)}</div>${nl2p(x.body)}`).join("")}</div>` : "");
    html += sec("Citações", (s.quotes && s.quotes.length)
      ? s.quotes.map((q) => `<div class="quote">“${esc(q)}”</div>`).join("") : "");
    html += sec("Passos práticos", (s.actions && s.actions.length)
      ? s.actions.map((a, i) => `<div class="action-item ${done[i] ? "done" : ""}" data-action="toggle-do" data-id="${e.id}" data-i="${i}">
            <span class="box ${done[i] ? "done" : ""}">${done[i] ? "✓" : ""}</span><span class="tx">${esc(a)}</span></div>`).join("") : "");
    html += sec("Temas", (s.topics && s.topics.length)
      ? `<div class="topic-tags">${s.topics.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>` : "");

    if (e.raw) {
      html += `<div class="summary-section"><div class="h">Fonte / transcrição</div>
        <details><summary class="link" style="cursor:pointer">Ver texto original</summary>
        <div class="card pad-sm muted tiny" style="margin-top:8px;white-space:pre-wrap;line-height:1.5">${esc(e.raw)}</div></details></div>`;
    }

    view.innerHTML = html;
  }

  /* ---------- Adicionar / Editar (sheet) ---------- */
  function collectionOptions(sel) {
    return `<option value="">— Sem pasta —</option>` +
      collections().map((c) => `<option value="${c.id}" ${sel === c.id ? "selected" : ""}>${esc(c.emoji + " " + c.name)}</option>`).join("");
  }
  function typeSelector(sel) {
    return `<div class="seg-type" id="typeSeg">` + Object.keys(TYPES).map((t) =>
      `<button type="button" class="${sel === t ? "on" : ""}" data-type="${t}"><span class="e">${TYPES[t].e}</span>${TYPES[t].label}</button>`).join("") + `</div>`;
  }

  function openAdd(prefillCollection) {
    const noKey = !AI.configured;
    const html = `
      <div class="row between" style="align-items:flex-start">
        <div>
          <h2>Adicionar conteúdo</h2>
          <p class="muted tiny" style="margin:2px 0 0">Cola o link e a transcrição/legenda — gero um resumo estruturado.</p>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="bulk-add" data-id="${esc(prefillCollection || "")}" title="Adicionar vários vídeos de uma vez">📋 Vários</button>
      </div>
      ${noKey ? `<div class="banner" style="margin-top:12px"><span class="ico">🔑</span><div>Falta configurar a IA. <a class="link" data-action="go-settings" href="#">Configurar agora</a> — é grátis com o Google Gemini.</div></div>` : ""}
      <div class="form-grid" id="addForm">
        <label class="field"><span>Tipo</span>${typeSelector("outro")}</label>
        <label class="field"><span>Link (opcional)</span>
          <input id="f-url" type="url" placeholder="https://tiktok.com/... ou Spotify, YouTube…" />
          <div class="kv-fieldnote">O tipo é detetado automaticamente a partir do link.</div>
        </label>
        <label class="field"><span>Título (opcional)</span>
          <input id="f-title" type="text" placeholder="Se deixares vazio, eu crio um" /></label>
        <label class="field"><span>Pasta</span>
          <select id="f-coll">${collectionOptions(prefillCollection || "")}</select></label>
        <label class="field"><span>Transcrição, legenda ou notas</span>
          <textarea id="f-raw" style="min-height:130px" placeholder="Cola aqui a transcrição do podcast, a legenda do TikTok, ou as tuas notas. Quanto mais texto, melhor o resumo."></textarea>
          <div class="kv-fieldnote">Dica: no YouTube, abre “Mostrar transcrição” e cola aqui. No TikTok, cola a legenda/descrição.</div>
        </label>
        <div id="add-status"></div>
        <button class="btn btn-primary btn-block" id="genBtn" ${noKey ? "disabled" : ""}>✨ Gerar resumo e guardar</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>
      </div>`;
    UI.openSheet(html);

    let type = "outro";
    const seg = $("#typeSeg");
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-type]"); if (!b) return;
      type = b.dataset.type;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
    $("#f-url").addEventListener("blur", async (ev) => {
      const url = ev.target.value.trim();
      const d = detectType(url);
      if (d !== "outro") { type = d; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.type === d)); }
      if ((d === "tiktok" || d === "youtube") && url) {
        const titleInp = $("#f-title"), rawInp = $("#f-raw");
        if (!titleInp || (titleInp.value.trim() && rawInp.value.trim())) return; // já preenchido à mão
        const note = $("#add-status");
        if (note) note.innerHTML = `<div class="tiny muted" style="display:flex;align-items:center;gap:7px"><span class="spin" style="width:13px;height:13px"></span> A ir buscar título/legenda automaticamente…</div>`;
        const meta = await fetchOEmbed(url);
        if (note) note.innerHTML = "";
        if (!meta) return;
        if (!titleInp.value.trim() && meta.title) titleInp.value = meta.title;
        // no TikTok o "title" do oEmbed é a legenda do vídeo — serve de transcrição de base
        if (d === "tiktok" && !rawInp.value.trim() && meta.title) rawInp.value = meta.title;
      }
    });

    $("#genBtn").addEventListener("click", async () => {
      const url = $("#f-url").value.trim();
      const title = $("#f-title").value.trim();
      const raw = $("#f-raw").value.trim();
      const collectionId = $("#f-coll").value || null;
      if (!url && !title && !raw) { $("#add-status").innerHTML = `<div class="banner"><span class="ico">⚠️</span><div>Adiciona pelo menos um link, título ou transcrição.</div></div>`; return; }

      const btn = $("#genBtn"); btn.disabled = true;
      $("#add-status").innerHTML = `<div class="gen-box"><span class="spin"></span><div class="t">A gerar o teu resumo…</div><div class="s">Pode demorar alguns segundos.</div></div>`;
      try {
        const summary = await AI.summarize({ title, type, url, raw });
        const e = {
          id: uid(), type, url: url || "", title: title || summary.title || "Sem título",
          raw, collectionId, summary, favorite: false, actionsDone: {},
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        addEntry(e);
        UI.closeSheet();
        UI.toast("Resumo criado ✨");
        go({ name: "detail", id: e.id });
      } catch (err) {
        console.error(err);
        $("#add-status").innerHTML = `<div class="banner"><span class="ico">⚠️</span><div>${esc(err.message || "Falhou a geração.")}</div></div>`;
        btn.disabled = false;
      }
    });
  }

  /** Divide o texto colado em blocos, um por conteúdo. Aceita separador explícito "---",
   *  ou (se não houver) divide automaticamente sempre que uma linha é só um link. */
  function parseBulkBlocks(raw) {
    const toBlock = (text) => {
      const lines = text.split("\n");
      const first = (lines[0] || "").trim();
      const isUrl = /^https?:\/\/\S+$/.test(first);
      return { url: isUrl ? first : "", raw: (isUrl ? lines.slice(1) : lines).join("\n").trim() };
    };
    const explicit = raw.split(/\n[ \t]*---[ \t]*\n?/).map((b) => b.trim()).filter(Boolean);
    if (explicit.length > 1) return explicit.map(toBlock).filter((b) => b.url || b.raw);

    const lines = raw.split("\n");
    const groups = []; let cur = [];
    for (const line of lines) {
      if (/^https?:\/\/\S+$/.test(line.trim()) && cur.some((l) => l.trim())) { groups.push(cur); cur = [line]; }
      else cur.push(line);
    }
    if (cur.length) groups.push(cur);
    return groups.map((g) => toBlock(g.join("\n"))).filter((b) => b.url || b.raw);
  }

  function openBulkAdd(prefillCollection) {
    const noKey = !AI.configured;
    const html = `
      <h2>Adicionar vários de uma vez</h2>
      <p class="muted tiny" style="margin:2px 0 0">Cola vários vídeos seguidos — gero um resumo para cada um automaticamente.</p>
      ${noKey ? `<div class="banner" style="margin-top:12px"><span class="ico">🔑</span><div>Falta configurar a IA. <a class="link" data-action="go-settings" href="#">Configurar agora</a> — é grátis com o Google Gemini.</div></div>` : ""}
      <div class="form-grid" id="bulkForm">
        <label class="field"><span>Tipo (aplica-se a todos, exceto quando detetado pelo link)</span>${typeSelector("outro")}</label>
        <label class="field"><span>Pasta</span>
          <select id="b-coll">${collectionOptions(prefillCollection || "")}</select></label>
        <label class="field"><span>Vídeos</span>
          <textarea id="b-raw" style="min-height:220px" placeholder="https://tiktok.com/@.../video/1
Legenda ou transcrição do 1º vídeo…

https://tiktok.com/@.../video/2
Legenda ou transcrição do 2º vídeo…"></textarea>
          <div class="kv-fieldnote">Um vídeo por bloco: link (opcional) na 1ª linha, depois a legenda/transcrição. Separa blocos com uma linha em branco antes do próximo link — ou usa uma linha só com <code>---</code> se o texto não começar por um link.</div>
        </label>
        <div id="b-count" class="tiny muted"></div>
        <div id="bulk-status"></div>
        <button class="btn btn-primary btn-block" id="bulkBtn" ${noKey ? "disabled" : ""}>✨ Gerar resumos</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>
      </div>`;
    UI.openSheet(html);

    let type = "outro";
    const seg = $("#typeSeg");
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-type]"); if (!b) return;
      type = b.dataset.type;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });

    const updateCount = () => {
      const n = parseBulkBlocks($("#b-raw").value).length;
      $("#b-count").textContent = n ? `${n} vídeo${n === 1 ? "" : "s"} detetado${n === 1 ? "" : "s"}` : "";
    };
    $("#b-raw").addEventListener("input", updateCount);

    $("#bulkBtn").addEventListener("click", async () => {
      const blocks = parseBulkBlocks($("#b-raw").value);
      const collectionId = $("#b-coll").value || null;
      if (!blocks.length) { $("#bulk-status").innerHTML = `<div class="banner"><span class="ico">⚠️</span><div>Não encontrei nenhum vídeo no texto colado.</div></div>`; return; }

      $("#bulkForm").querySelectorAll("input,textarea,select,button").forEach((el) => el.disabled = true);
      let done = 0, failed = 0;
      const failedTitles = [];
      for (let i = 0; i < blocks.length; i++) {
        $("#bulk-status").innerHTML = `<div class="gen-box"><span class="spin"></span><div class="t">A gerar ${i + 1} de ${blocks.length}…</div><div class="s">${done} feito(s)${failed ? `, ${failed} falhou(aram)` : ""}</div></div>`;
        const b = blocks[i];
        const t = detectType(b.url) !== "outro" ? detectType(b.url) : type;
        // sem legenda colada? tenta ir buscá-la automaticamente (TikTok/YouTube) antes de resumir
        if (!b.raw.trim() && b.url) { const meta = await fetchOEmbed(b.url); if (meta && meta.title) b.raw = meta.title; }
        try {
          const summary = await AI.summarize({ title: "", type: t, url: b.url, raw: b.raw });
          addEntry({
            id: uid(), type: t, url: b.url || "", title: summary.title || "Sem título",
            raw: b.raw, collectionId, summary, favorite: false, actionsDone: {},
            createdAt: Date.now(), updatedAt: Date.now(),
          });
          done++;
        } catch (err) {
          console.error(err);
          failed++;
          failedTitles.push(b.url || `bloco ${i + 1}`);
        }
      }
      UI.closeSheet();
      UI.toast(failed ? `${done} resumo(s) criado(s), ${failed} falhou(aram)` : `${done} resumo(s) criado(s) ✨`);
      if (collectionId) go({ name: "collection", id: collectionId }); else go({ name: "library" });
    });
  }

  function openEdit(id) {
    const e = entryById(id); if (!e) return;
    const html = `
      <h2>Editar</h2>
      <div class="form-grid">
        <label class="field"><span>Tipo</span>${typeSelector(e.type)}</label>
        <label class="field"><span>Título</span><input id="e-title" type="text" value="${esc(e.title)}" /></label>
        <label class="field"><span>Link</span><input id="e-url" type="url" value="${esc(e.url || "")}" /></label>
        <label class="field"><span>Pasta</span><select id="e-coll">${collectionOptions(e.collectionId)}</select></label>
        <label class="field"><span>Transcrição / notas</span><textarea id="e-raw" style="min-height:120px">${esc(e.raw || "")}</textarea></label>
        <button class="btn btn-primary btn-block" id="e-save">Guardar</button>
        <button class="btn btn-soft btn-block" id="e-save-regen" ${AI.configured ? "" : "disabled"}>Guardar e regenerar resumo</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>
      </div>`;
    UI.openSheet(html);
    let type = e.type;
    const seg = $("#typeSeg");
    seg.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-type]"); if (!b) return; type = b.dataset.type; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });

    const collect = () => ({ type, title: $("#e-title").value.trim() || "Sem título", url: $("#e-url").value.trim(), collectionId: $("#e-coll").value || null, raw: $("#e-raw").value.trim() });
    $("#e-save").addEventListener("click", () => { saveEntry(id, collect()); UI.closeSheet(); UI.toast("Guardado"); renderDetail(id); });
    $("#e-save-regen").addEventListener("click", async () => {
      const patch = collect(); saveEntry(id, patch);
      const btn = $("#e-save-regen"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span> A regenerar…`;
      try {
        const summary = await AI.summarize({ title: patch.title, type: patch.type, url: patch.url, raw: patch.raw });
        saveEntry(id, { summary });
        UI.closeSheet(); UI.toast("Resumo atualizado ✨"); renderDetail(id);
      } catch (err) { UI.closeSheet(); UI.toast(err.message || "Falhou a regeneração"); }
    });
  }

  async function regen(id) {
    const e = entryById(id); if (!e) return;
    if (!AI.configured) { UI.toast("Configura a chave da API em Definições"); return; }
    UI.openSheet(`<div class="gen-box"><span class="spin"></span><div class="t">A regenerar o resumo…</div></div>`);
    try {
      const summary = await AI.summarize({ title: e.title, type: e.type, url: e.url, raw: e.raw });
      saveEntry(id, { summary });
      UI.closeSheet(); UI.toast("Resumo atualizado ✨"); renderDetail(id);
    } catch (err) { UI.closeSheet(); UI.toast(err.message || "Falhou"); }
  }

  function newCollectionSheet() {
    const emojis = ["📁", "🧠", "💡", "💰", "🏋️", "🍳", "🎯", "📈", "❤️", "🌱", "🎬", "🎓", "🔧", "✍️"];
    const html = `<h2>Nova pasta</h2>
      <div class="form-grid">
        <label class="field"><span>Ícone</span>
          <div class="chiprow" id="emoPick">${emojis.map((x, i) => `<button type="button" class="pill ${i === 0 ? "on" : ""}" data-emo="${x}" style="font-size:1.1rem">${x}</button>`).join("")}</div></label>
        <label class="field"><span>Nome</span><input id="c-name" type="text" placeholder="Ex.: Produtividade, Investimento…" /></label>
        <button class="btn btn-primary btn-block" id="c-save">Criar pasta</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>
      </div>`;
    UI.openSheet(html);
    let emo = emojis[0];
    $("#emoPick").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-emo]"); if (!b) return; emo = b.dataset.emo; $("#emoPick").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    $("#c-save").addEventListener("click", () => {
      const name = $("#c-name").value.trim();
      if (!name) { UI.toast("Dá um nome à pasta"); return; }
      addCollection(name, emo); UI.closeSheet(); UI.toast("Pasta criada"); renderFolders();
    });
  }

  function editCollectionSheet(id) {
    const c = collById(id); if (!c) return;
    const emojis = ["📁", "🧠", "💡", "💰", "🏋️", "🍳", "🎯", "📈", "❤️", "🌱", "🎬", "🎓", "🔧", "✍️", "🧘", "⚽"];
    const html = `<h2>Editar pasta</h2>
      <div class="form-grid">
        <label class="field"><span>Ícone</span>
          <div class="chiprow" id="emoPick">${emojis.map((x) => `<button type="button" class="pill ${x === c.emoji ? "on" : ""}" data-emo="${x}" style="font-size:1.1rem">${x}</button>`).join("")}</div></label>
        <label class="field"><span>Nome</span><input id="c-name" type="text" value="${esc(c.name)}" /></label>
        <button class="btn btn-primary btn-block" id="c-save">Guardar</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>
      </div>`;
    UI.openSheet(html);
    let emo = c.emoji;
    $("#emoPick").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-emo]"); if (!b) return; emo = b.dataset.emo; $("#emoPick").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    $("#c-name").focus();
    $("#c-save").addEventListener("click", () => {
      const name = $("#c-name").value.trim();
      if (!name) { UI.toast("Dá um nome à pasta"); return; }
      updateCollection(id, { name, emoji: emo });
      UI.closeSheet(); UI.toast("Pasta atualizada");
      go({ name: "collection", id });
    });
  }

  /* ---------- Definições ---------- */
  function renderSettings() {
    setHeader("settings");
    const sys = Store.get("sys");
    const ai = sys.ai || {};
    const sync = sys.sync || {};
    const theme = sys.theme || "auto";
    const stats = { itens: entries().length, pastas: collections().length };
    const prov = ai.provider || "gemini";
    const P = AI.PROVIDERS[prov];

    view.innerHTML = `
      <div class="section-title">Inteligência (resumos)</div>
      <div class="card stack">
        <label class="field"><span>Serviço de IA</span>
          <select id="s-provider">
            <option value="gemini" ${prov === "gemini" ? "selected" : ""}>Google Gemini — grátis ✅</option>
            <option value="anthropic" ${prov === "anthropic" ? "selected" : ""}>Anthropic Claude — pago</option>
          </select></label>
        <div class="banner info"><span class="ico">🔒</span><div>A tua chave fica só neste dispositivo (e sincronizada, se ligares o sync). As chamadas vão direto do teu browser para o serviço de IA.</div></div>
        <label class="field"><span>Chave da API</span>
          <input id="s-key" type="password" placeholder="${P.keyPlaceholder}" value="${esc(ai.apiKey || "")}" /></label>
        <label class="field"><span>Modelo</span>
          <input id="s-model" type="text" list="s-model-list" value="${esc((ai.model && ai.model.trim()) || P.defaultModel)}" />
          <datalist id="s-model-list">${P.models.map((m) => `<option value="${m}"></option>`).join("")}</datalist></label>
        <div class="kv-fieldnote">${P.keyHelp}</div>
        <div class="row" style="gap:8px">
          <button class="btn btn-primary" id="s-key-save">Guardar</button>
          <button class="btn" id="s-key-test">Testar</button>
        </div>
        <div id="s-key-status"></div>
      </div>

      <div class="section-title">Importar do TikTok</div>
      <div class="card stack">
        <div class="banner info"><span class="ico">🎵</span><div>Ao adicionar um link do TikTok ou YouTube, a legenda/título já vêm automaticamente (via oEmbed público). Para recolheres <b>uma pasta inteira</b> de Favoritos de uma vez, usa este atalho de um clique.</div></div>
        <ol class="tiny muted" style="padding-left:18px;line-height:1.7;margin:0">
          <li>Arrasta o botão abaixo para os favoritos do teu browser (ou copia o código e cria um favorito à mão).</li>
          <li>No telemóvel/PC, abre <code>tiktok.com/@teu_user/favorites</code> com sessão iniciada.</li>
          <li>Clica nesse favorito — recolhe os vídeos visíveis e a legenda de cada um, e copia tudo formatado.</li>
          <li>Volta aqui, abre a pasta certa e cola em "📋 Vários".</li>
        </ol>
        <a id="tkBookmarklet" class="btn btn-primary btn-block" href="#" onclick="return false" draggable="true">📲 Recolher pasta do TikTok</a>
        <button class="btn btn-ghost btn-block" id="tkCopyCode">⧉ Copiar código do atalho</button>
        <div class="kv-fieldnote">Corre na tua própria sessão do TikTok, disparado por ti — não guarda nem envia a tua password a lado nenhum. Como o TikTok não tem uma API pública para pastas privadas, isto lê o que já está visível na página; se a estrutura do TikTok mudar, pode precisar de ajuste.</div>
      </div>

      <div class="section-title">Sincronização telemóvel ↔ PC</div>
      <div class="card stack">
        <div class="banner info"><span class="ico">☁️</span><div>Opcional e grátis. Cria um projeto em <b>supabase.com</b> (sem cartão), corre o SQL abaixo, e usa o <b>mesmo código</b> nos teus dispositivos.</div></div>
        <label class="field"><span>Project URL</span><input id="y-url" type="url" placeholder="https://xxxx.supabase.co" value="${esc(sync.url || "")}" /></label>
        <label class="field"><span>Chave anónima (anon/public)</span><input id="y-key" type="password" placeholder="eyJ... ou sb_..." value="${esc(sync.key || "")}" /></label>
        <label class="field"><span>Código de sincronização</span><input id="y-code" type="text" placeholder="à tua escolha — igual nos 2 dispositivos" value="${esc(sync.code || "")}" /></label>
        <div class="row" style="gap:8px">
          <button class="btn btn-primary" id="y-save">Ligar</button>
          <button class="btn" id="y-test">Testar</button>
          <button class="btn btn-ghost" id="y-sql">Ver SQL</button>
        </div>
        <div id="y-status" class="tiny muted">${Sync.enabled ? "✅ Sincronização ligada" : "Não configurada"}</div>
      </div>

      <div class="section-title">Aparência</div>
      <div class="card">
        <label class="field"><span>Tema</span>
          <select id="s-theme">
            <option value="auto" ${theme === "auto" ? "selected" : ""}>Automático (segue o sistema)</option>
            <option value="light" ${theme === "light" ? "selected" : ""}>Claro</option>
            <option value="dark" ${theme === "dark" ? "selected" : ""}>Escuro</option>
          </select></label>
      </div>

      <div class="section-title">Dados</div>
      <div class="card stack">
        <div class="row between"><div><b>${stats.itens}</b> resumos · <b>${stats.pastas}</b> pastas</div></div>
        <div class="row" style="gap:8px">
          <button class="btn" id="d-export">⬇ Exportar (.json)</button>
          <button class="btn" id="d-import">⬆ Importar</button>
          <input id="d-file" type="file" accept="application/json" class="hide" />
        </div>
        <button class="btn btn-danger btn-block" id="d-wipe">Apagar tudo</button>
      </div>

      <div class="section-title plain">Sobre</div>
      <div class="card muted tiny">
        <b>Knowledge Vault</b> — a tua biblioteca de conhecimento. PWA offline, dados no dispositivo, resumos com IA (Google Gemini grátis, ou Claude). Instala no telemóvel: menu do browser → “Adicionar ao ecrã principal”.
      </div>
    `;

    // — Bookmarklet TikTok —
    const bmHref = "javascript:" + encodeURIComponent("void " + TIKTOK_BOOKMARKLET_SRC);
    const bmLink = $("#tkBookmarklet");
    if (bmLink) {
      bmLink.href = bmHref;
      bmLink.addEventListener("click", (e) => { e.preventDefault(); UI.toast("Arrasta este botão para os favoritos do browser — clicar aqui não funciona (é preciso ser um favorito na barra)."); });
    }
    const bmCopy = $("#tkCopyCode");
    if (bmCopy) bmCopy.addEventListener("click", () => { copy(bmHref); UI.toast("Código copiado — cria um novo favorito e cola-o no URL"); });

    // — IA —
    $("#s-provider").addEventListener("change", () => {
      const val = $("#s-provider").value;
      Store.update("sys", (s) => { s.ai = s.ai || {}; s.ai.provider = val; s.ai.model = AI.PROVIDERS[val].defaultModel; });
      renderSettings();
    });
    $("#s-key-save").addEventListener("click", () => {
      const val = $("#s-provider").value;
      Store.update("sys", (s) => { s.ai = s.ai || {}; s.ai.provider = val; s.ai.apiKey = $("#s-key").value.trim(); s.ai.model = $("#s-model").value.trim() || AI.PROVIDERS[val].defaultModel; });
      $("#s-key-status").innerHTML = `<div class="banner info"><span class="ico">✅</span><div>Guardado.</div></div>`;
    });
    $("#s-key-test").addEventListener("click", async () => {
      const key = $("#s-key").value.trim(); const model = $("#s-model").value.trim(); const provider = $("#s-provider").value;
      if (!key) { $("#s-key-status").innerHTML = `<div class="banner"><span class="ico">⚠️</span><div>Cola a chave primeiro.</div></div>`; return; }
      $("#s-key-status").innerHTML = `<div class="gen-box" style="padding:12px"><span class="spin"></span></div>`;
      try {
        const workingModel = await AI.test(key, model, provider);
        Store.update("sys", (s) => { s.ai = s.ai || {}; s.ai.provider = provider; s.ai.apiKey = key; s.ai.model = workingModel; });
        const note = workingModel !== model ? ` (a app usou automaticamente <b>${esc(workingModel)}</b>, que é o que está disponível)` : "";
        $("#s-key-status").innerHTML = `<div class="banner info"><span class="ico">✅</span><div>Chave válida e guardada!${note}</div></div>`;
        $("#s-model").value = workingModel;
      }
      catch (err) { $("#s-key-status").innerHTML = `<div class="banner"><span class="ico">⚠️</span><div>${esc(err.message)}</div></div>`; }
    });

    // — Sync —
    $("#y-save").addEventListener("click", () => {
      Store.update("sys", (s) => { s.sync = { url: $("#y-url").value.trim(), key: $("#y-key").value.trim(), code: $("#y-code").value.trim() }; });
      Sync.reload();
      $("#y-status").textContent = Sync.enabled ? "✅ Sincronização ligada" : "Preenche URL, chave e código.";
    });
    $("#y-test").addEventListener("click", async () => {
      const c = { url: $("#y-url").value.trim(), key: $("#y-key").value.trim(), code: $("#y-code").value.trim() };
      if (!c.url || !c.key) { $("#y-status").textContent = "Preenche URL e chave."; return; }
      $("#y-status").textContent = "A testar…";
      try { await Sync.test(c); $("#y-status").textContent = "✅ Ligação OK — clica Ligar."; }
      catch (err) { $("#y-status").textContent = "⚠️ " + err.message; }
    });
    $("#y-sql").addEventListener("click", () => {
      UI.openSheet(`<h2>SQL para o Supabase</h2><p class="muted tiny">Cola no SQL Editor e clica RUN.</p>
        <div class="card pad-sm tiny" style="white-space:pre-wrap;font-family:var(--mono);margin-top:10px">${esc(Sync.sqlSchema)}</div>
        <button class="btn btn-primary btn-block" style="margin-top:12px" id="sql-copy">Copiar</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Fechar</button>`);
      $("#sql-copy").addEventListener("click", () => { copy(Sync.sqlSchema); UI.toast("SQL copiado"); });
    });

    // — Tema —
    $("#s-theme").addEventListener("change", (e) => { Store.update("sys", (s) => { s.theme = e.target.value; }); applyTheme(); });

    // — Dados —
    $("#d-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `knowledge-vault-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("#d-import").addEventListener("click", () => $("#d-file").click());
    $("#d-file").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { Store.importAll(JSON.parse(rd.result)); UI.toast("Importado ✓"); renderSettings(); } catch (err) { UI.toast("Ficheiro inválido"); } };
      rd.readAsText(f);
    });
    $("#d-wipe").addEventListener("click", () => {
      UI.openSheet(`<h2>Apagar tudo?</h2><p class="muted">Isto apaga todos os resumos e pastas deste dispositivo. Não é reversível (exporta primeiro se quiseres cópia).</p>
        <button class="btn btn-danger btn-block" id="wipe-yes" style="margin-top:8px">Sim, apagar tudo</button>
        <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>`);
      $("#wipe-yes").addEventListener("click", () => { Store.update("vault", (v) => { v.entries = []; v.collections = []; }); UI.closeSheet(); UI.toast("Apagado"); go({ name: "library" }); });
    });
  }

  /* ---------- ações auxiliares ---------- */
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    else { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  }
  function entryToText(e) {
    const s = e.summary || {};
    const L = [];
    L.push(`# ${e.title}`);
    if (e.url) L.push(e.url);
    if (s.tldr) L.push(`\n${s.tldr}`);
    if (s.takeaways && s.takeaways.length) { L.push(`\n## Pontos-chave`); s.takeaways.forEach((t) => L.push(`- ${t}`)); }
    if (s.sections && s.sections.length) { L.push(`\n## Notas`); s.sections.forEach((x) => L.push(`\n### ${x.heading}\n${x.body}`)); }
    if (s.quotes && s.quotes.length) { L.push(`\n## Citações`); s.quotes.forEach((q) => L.push(`> ${q}`)); }
    if (s.actions && s.actions.length) { L.push(`\n## Passos práticos`); s.actions.forEach((a) => L.push(`- [ ] ${a}`)); }
    if (s.topics && s.topics.length) L.push(`\nTemas: ${s.topics.map((t) => "#" + t).join(" ")}`);
    return L.join("\n");
  }

  /* ---------- delegação de eventos ---------- */
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    switch (a) {
      case "open": go({ name: "detail", id }); break;
      case "back": go({ name: "library" }); break;
      case "add": openAdd(route.name === "collection" ? route.id : (libFilter.collection || "")); break;
      case "bulk-add": openBulkAdd(id || ""); break;
      case "filter-type": libFilter.type = el.dataset.type; renderLibrary(); break;
      case "filter-fav": libFilter.fav = !libFilter.fav; renderLibrary(); break;
      case "clear-collection": libFilter.collection = ""; renderLibrary(); break;
      case "open-collection": go({ name: "collection", id }); break;
      case "open-all": libFilter.collection = ""; libFilter.type = ""; libFilter.fav = false; libFilter.q = ""; go({ name: "library" }); break;
      case "open-none": libFilter.collection = ""; go({ name: "library" }); filterNone(); break;
      case "to-folders": go({ name: "folders" }); break;
      case "to-collection": go({ name: "collection", id }); break;
      case "new-collection": newCollectionSheet(); break;
      case "edit-collection": editCollectionSheet(id); break;
      case "del-collection":
        ev.stopPropagation();
        UI.openSheet(`<h2>Apagar pasta?</h2><p class="muted">Os resumos dentro dela ficam “Sem pasta”, não são apagados. O plano da pasta é removido.</p>
          <button class="btn btn-danger btn-block" id="dc-yes">Apagar pasta</button>
          <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>`);
        $("#dc-yes").addEventListener("click", () => { removeCollection(id); UI.closeSheet(); go({ name: "folders" }); });
        break;
      case "gen-plan": genPlan(id); break;
      case "view-plan": go({ name: "plan", id }); break;
      case "open-chat": go({ name: "chat", id }); break;
      case "copy-plan": { const c = collById(id); copy(planToText(c)); UI.toast("Plano copiado"); break; }
      case "del-plan":
        UI.openSheet(`<h2>Apagar plano?</h2><p class="muted">Apaga só o plano consolidado. Os conteúdos da pasta mantêm-se.</p>
          <button class="btn btn-danger btn-block" id="dp-yes">Apagar plano</button>
          <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>`);
        $("#dp-yes").addEventListener("click", () => { updateCollection(id, { plan: null }); UI.closeSheet(); UI.toast("Plano apagado"); go({ name: "collection", id }); });
        break;
      case "fav": { const e = entryById(id); saveEntry(id, { favorite: !e.favorite }); renderDetail(id); break; }
      case "edit": openEdit(id); break;
      case "regen": regen(id); break;
      case "copy": { const e = entryById(id); copy(entryToText(e)); UI.toast("Copiado para a área de transferência"); break; }
      case "del":
        UI.openSheet(`<h2>Apagar resumo?</h2><p class="muted">Esta ação não é reversível.</p>
          <button class="btn btn-danger btn-block" id="de-yes">Apagar</button>
          <button class="btn btn-ghost btn-block" data-action="close-sheet">Cancelar</button>`);
        $("#de-yes").addEventListener("click", () => { removeEntry(id); UI.closeSheet(); UI.toast("Apagado"); go({ name: "library" }); });
        break;
      case "toggle-do": {
        const e = entryById(id); const i = el.dataset.i;
        const done = Object.assign({}, e.actionsDone || {}); done[i] = !done[i];
        saveEntry(id, { actionsDone: done }); renderDetail(id); break;
      }
      case "close-sheet": UI.closeSheet(); break;
      case "go-settings": ev.preventDefault(); UI.closeSheet(); go({ name: "settings" }); break;
    }
  });

  function filterNone() {
    // mostra apenas entries sem pasta
    libFilter.collection = "";
    const list = entries().filter((e) => !e.collectionId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    setHeader("library", "sem pasta");
    view.querySelector(".stack") && (view.querySelector(".stack").innerHTML = list.map(entryCardHTML).join(""));
  }

  // tabs
  $("#tabbar").addEventListener("click", (ev) => {
    const a = ev.target.closest("a[data-tab]"); if (!a) return;
    const tab = a.dataset.tab;
    if (tab === "library") { libFilter.collection = ""; libFilter.type = ""; libFilter.fav = false; libFilter.q = ""; }
    go({ name: tab });
  });
  $("#fab").addEventListener("click", () => openAdd(route.name === "collection" ? route.id : (libFilter.collection || "")));
  $("#syncBtn").addEventListener("click", () => go({ name: "settings" }));

  /* ---------- tema ---------- */
  function applyTheme() {
    const t = (Store.get("sys").theme) || "auto";
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }

  /* ---------- sync indicator ---------- */
  Sync.onStatus((s) => {
    const btn = $("#syncBtn"); if (!btn) return;
    btn.style.color = s === "error" ? "var(--bad)" : s === "syncing" ? "var(--accent)" : s === "ready" ? "var(--good)" : "";
  });

  /* ---------- re-render em mudanças de dados (sync) ---------- */
  Store.subscribe("vault", () => {
    if (route.name === "library") { if (!document.activeElement || document.activeElement.id !== "searchInput") renderLibrary(); }
    else if (route.name === "folders") renderFolders();
    else if (route.name === "collection") { if (collById(route.id)) renderCollection(route.id); else go({ name: "folders" }); }
    else if (route.name === "plan") { const c = collById(route.id); if (c && c.plan) renderPlan(route.id); else if (c) go({ name: "collection", id: route.id }); else go({ name: "folders" }); }
    else if (route.name === "detail") { if (entryById(route.id)) renderDetail(route.id); else go({ name: "library" }); }
  });

  /* ---------- arranque ---------- */
  vault();
  applyTheme();
  Sync.init();
  render();
})();
