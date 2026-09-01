/* =====================================================================
   ai.js — normalização do plano importado (colado de uma conversa
   num Projeto do claude.ai — ver "Importar plano" em app.js).
   ===================================================================== */
(function (global) {
  /** Normaliza um item de passo do plano para { text, source } ou { text, url } — aceita texto
   *  simples ou um item de plano importado (colado do claude.ai, pode trazer um "url" solto). */
  function normalizePlanItem(v) {
    if (v == null) return null;
    if (typeof v === "string") { const t = v.trim(); return t ? { text: t, source: 0 } : null; }
    const text = (v.text || "").trim();
    if (!text) return null;
    const source = Number.isInteger(v.source) ? v.source : 0;
    const out = { text, source: source > 0 ? source : 0 };
    if (v.url && typeof v.url === "string") out.url = v.url.trim();
    return out;
  }

  function normalizePlan(p) {
    const strArr = (x) => Array.isArray(x) ? x.filter((v) => (typeof v === "string" ? v.trim() : v)) : [];
    return {
      title: (p.title || "").trim() || "Plano da pasta",
      overview: (p.overview || "").trim(),
      steps: (Array.isArray(p.steps) ? p.steps : []).filter((x) => x && (x.heading || (x.items && x.items.length)))
        .map((x) => ({
          heading: (x.heading || "").trim(),
          items: (Array.isArray(x.items) ? x.items : []).map(normalizePlanItem).filter(Boolean),
        })),
      principles: strArr(p.principles),
    };
  }

  global.AI = { normalizePlan };
})(window);
