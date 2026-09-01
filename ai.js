/* =====================================================================
   ai.js — geração de resumos com IA, chamada direto do browser.
   Suporta 2 serviços (a chave fica só no dispositivo):
     • Google Gemini  → GRÁTIS (Google AI Studio, sem cartão)  [por defeito]
     • Anthropic Claude → pago
   Gera um resumo estruturado (JSON garantido) — a "bíblia" de conhecimento.
   ===================================================================== */
(function (global) {
  /* ---------- prompt partilhado ---------- */
  function systemPrompt() {
    return [
      "És um assistente que transforma conteúdo de podcasts e vídeos (TikTok, YouTube, etc.)",
      "num resumo estruturado e reutilizável — uma 'bíblia' de conhecimento pessoal.",
      "Escreves sempre em português de Portugal, claro e direto.",
      "Extrais o valor real: ideias, factos, modelos mentais, passos práticos.",
      "Se o conteúdo for pouco (só um título ou link, sem transcrição), fazes o melhor resumo",
      "possível com o que existe e não inventas detalhes que não estão presentes.",
      "Preenches SEMPRE todos os campos do esquema JSON pedido; usa listas vazias quando",
      "não houver conteúdo para um campo (ex.: sem citações).",
      "Guia dos campos: title (título curto e descritivo — cria um se não houver);",
      "tldr (1-3 frases com a essência); takeaways (3 a 8 pontos-chave acionáveis);",
      "sections (secções temáticas com 'heading' e 'body'); quotes (frases marcantes, só se existirem);",
      "actions (passos práticos, só se fizerem sentido); topics (2 a 6 etiquetas de tema em minúsculas).",
    ].join(" ");
  }

  function userContent({ title, type, url, raw }) {
    const parts = [];
    parts.push("Resume o seguinte conteúdo para a minha biblioteca de conhecimento.\n");
    const tipo = { podcast: "Podcast", tiktok: "Vídeo do TikTok", youtube: "Vídeo do YouTube", artigo: "Artigo", outro: "Conteúdo" }[type] || "Conteúdo";
    parts.push(`Tipo: ${tipo}`);
    if (title) parts.push(`Título fornecido: ${title}`);
    if (url) parts.push(`Fonte (URL): ${url}`);
    parts.push("");
    if (raw && raw.trim()) {
      parts.push("Transcrição / notas / descrição do conteúdo:", "---", raw.trim(), "---");
    } else {
      parts.push("(Não foi fornecida transcrição — baseia-te apenas no título/URL e no que for possível inferir com segurança, sem inventar.)");
    }
    return parts.join("\n");
  }

  /* ---------- esquemas de saída (JSON estruturado) ---------- */
  // Anthropic (JSON Schema clássico)
  const ANTHROPIC_SCHEMA = {
    type: "object", additionalProperties: false,
    properties: {
      title: { type: "string" }, tldr: { type: "string" },
      takeaways: { type: "array", items: { type: "string" } },
      sections: { type: "array", items: { type: "object", additionalProperties: false, properties: { heading: { type: "string" }, body: { type: "string" } }, required: ["heading", "body"] } },
      quotes: { type: "array", items: { type: "string" } },
      actions: { type: "array", items: { type: "string" } },
      topics: { type: "array", items: { type: "string" } },
    },
    required: ["title", "tldr", "takeaways", "sections", "quotes", "actions", "topics"],
  };
  // Gemini (Schema com tipos em MAIÚSCULAS, sem additionalProperties)
  const GEMINI_SCHEMA = {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" }, tldr: { type: "STRING" },
      takeaways: { type: "ARRAY", items: { type: "STRING" } },
      sections: { type: "ARRAY", items: { type: "OBJECT", properties: { heading: { type: "STRING" }, body: { type: "STRING" } }, required: ["heading", "body"] } },
      quotes: { type: "ARRAY", items: { type: "STRING" } },
      actions: { type: "ARRAY", items: { type: "STRING" } },
      topics: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["title", "tldr", "takeaways", "sections", "quotes", "actions", "topics"],
  };

  /* ---------- serviços ---------- */
  const PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      free: true,
      defaultModel: "gemini-2.5-flash",
      models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-1.5-flash", "gemini-2.5-flash-lite"],
      keyPlaceholder: "AIza…",
      keyHelp: "Chave GRÁTIS em aistudio.google.com/app/apikey (não precisa de cartão). Se um modelo deixar de existir, a app tenta outro da lista automaticamente.",
    },
    anthropic: {
      label: "Anthropic Claude",
      free: false,
      defaultModel: "claude-sonnet-5",
      models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
      keyPlaceholder: "sk-ant-…",
      keyHelp: "Chave em console.anthropic.com → API Keys. Requer crédito pago.",
    },
  };

  /* ---------- Gemini ---------- */
  async function geminiCall(apiKey, model, { system, user, schema, maxTokens }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: Object.assign({ temperature: 0.4, maxOutputTokens: maxTokens || 8192 },
        schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
    };
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw await providerError(r, "gemini");
    const data = await r.json();
    const cand = (data.candidates || [])[0];
    if (!cand) {
      const blocked = data.promptFeedback && data.promptFeedback.blockReason;
      throw new Error(blocked ? "O conteúdo foi bloqueado pelos filtros do Gemini." : "Resposta vazia do Gemini.");
    }
    if (cand.finishReason === "SAFETY") throw new Error("O Gemini bloqueou este conteúdo (filtros de segurança).");
    const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
    return text;
  }

  /* ---------- Anthropic ---------- */
  async function anthropicCall(apiKey, model, { system, user, schema, maxTokens }) {
    const body = { model, max_tokens: maxTokens || 8000, system, messages: [{ role: "user", content: user }] };
    if (schema) body.output_config = { format: { type: "json_schema", schema } };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await providerError(r, "anthropic");
    const data = await r.json();
    if (data.stop_reason === "refusal") throw new Error("O modelo recusou processar este conteúdo.");
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) throw new Error("Resposta vazia do modelo.");
    return block.text;
  }

  function call(provider, apiKey, model, args) {
    return provider === "anthropic" ? anthropicCall(apiKey, model, args) : geminiCall(apiKey, model, args);
  }
  function schemaFor(provider) { return provider === "anthropic" ? ANTHROPIC_SCHEMA : GEMINI_SCHEMA; }

  /** Pergunta à conta Google quais modelos a chave pode mesmo usar (evita adivinhar nomes). */
  async function listGeminiModels(apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url);
      if (!r.ok) return [];
      const data = await r.json();
      const names = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => (m.name || "").replace(/^models\//, ""))
        .filter(Boolean);
      // modelos "flash"/"lite" costumam ter quotas grátis mais generosas — tentar esses primeiro
      names.sort((a, b) => {
        const score = (n) => (/flash/.test(n) ? 0 : /lite/.test(n) ? 1 : /pro/.test(n) ? 3 : 2);
        return score(a) - score(b);
      });
      return names;
    } catch (e) { return []; }
  }

  // Erros por-modelo que valem a pena tentar noutro modelo: não encontrado, sem quota, ou
  // temporariamente sobrecarregado do lado da Google. Erros de chave/pedido (400/401/403) não —
  // esses vão falhar da mesma forma em qualquer modelo.
  const RETRYABLE_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);

  /** Chama o modelo pedido; se falhar por um motivo específico do modelo (não existe, sem quota,
   *  sobrecarregado), tenta os seguintes automaticamente — cada modelo do Gemini tem quota e carga
   *  próprias. Se todos os modelos conhecidos falharem, pergunta à conta quais existem mesmo e
   *  tenta esses também. Devolve { text, model }. */
  async function callWithFallback(provider, apiKey, model, args) {
    const staticList = PROVIDERS[provider].models;
    const tried = new Set();
    let lastErr, sawQuotaLimit = false, sawNotFound = false, sawBusy = false;

    async function attempt(candidates) {
      for (const m of candidates) {
        if (tried.has(m)) continue;
        tried.add(m);
        try {
          const text = await call(provider, apiKey, m, args);
          return { text, model: m };
        } catch (err) {
          lastErr = err;
          if (provider === "gemini" && err && RETRYABLE_STATUS.has(err.status)) {
            if (err.status === 429) sawQuotaLimit = true;
            else if (err.status === 404) sawNotFound = true;
            else sawBusy = true; // 500/502/503/504/408
            continue; // tenta o próximo modelo
          }
          throw err; // outro tipo de erro (chave inválida, bloqueio, etc.) — não vale a pena tentar mais
        }
      }
      return null;
    }

    let result = await attempt([model, ...staticList]);
    if (result) return result;

    if (provider === "gemini") {
      const liveModels = await listGeminiModels(apiKey);
      result = await attempt(liveModels);
      if (result) return result;
      // uma segunda volta pelos modelos que só falharam por sobrecarga/quota (não por 404) —
      // spikes de procura costumam resolver-se em segundos.
      if (sawBusy || sawQuotaLimit) {
        tried.clear();
        await new Promise((r) => setTimeout(r, 1500));
        result = await attempt([model, ...staticList, ...liveModels]);
        if (result) return result;
      }
    }

    if (lastErr) {
      if (sawBusy && !sawQuotaLimit && !sawNotFound) {
        lastErr.message = "Os servidores do Gemini estão sobrecarregados neste momento (em todos os modelos disponíveis). É temporário — tenta de novo daqui a um ou dois minutos.";
      } else if (sawQuotaLimit && !sawNotFound && !sawBusy) {
        lastErr.message = "Atingiste o limite grátis em todos os modelos disponíveis nesta chave. É um limite da própria Google (por minuto e por dia) — espera uns minutos, ou tenta amanhã se for o limite diário.";
      } else if (sawNotFound && !sawQuotaLimit && !sawBusy) {
        lastErr.message = "A tua chave não tem acesso a nenhum modelo de texto do Gemini. Confirma que a chave é da Google AI Studio (aistudio.google.com/app/apikey), não da Google Cloud.";
      } else {
        lastErr.message = "Não consegui usar nenhum modelo do Gemini agora (mistura de sobrecarga/limite/indisponibilidade). Tenta de novo daqui a pouco.";
      }
      throw lastErr;
    }
    throw new Error("Nenhum modelo disponível.");
  }

  /** Guarda o modelo que funcionou, para os próximos pedidos irem direitos a ele. */
  function rememberWorkingModel(provider, model) {
    const a = Store.get("sys").ai || {};
    if (a.model === model) return;
    Store.update("sys", (s) => { s.ai = s.ai || {}; s.ai.provider = provider; s.ai.model = model; });
  }

  /* ---------- API pública ---------- */
  const AI = {
    PROVIDERS,
    get settings() { return Store.get("sys").ai || {}; },
    get provider() { return this.settings.provider || "gemini"; },
    get configured() { const a = this.settings; return !!(a.apiKey && a.apiKey.trim()); },
    get model() { const a = this.settings; return (a.model && a.model.trim()) || PROVIDERS[this.provider].defaultModel; },

    /** Testa a chave; devolve o nome do modelo que respondeu (pode não ser o pedido). */
    async test(apiKey, model, provider) {
      provider = provider || "gemini";
      const m = (model && model.trim()) || PROVIDERS[provider].defaultModel;
      const { model: workingModel } = await callWithFallback(provider, apiKey, m, { system: "Responde apenas: ok", user: "ok", schema: null, maxTokens: 16 });
      return workingModel;
    },

    async summarize(input) {
      const a = this.settings;
      const provider = a.provider || "gemini";
      if (!a.apiKey) throw new Error("Falta a chave da API. Vai a Definições e adiciona a tua chave (grátis com o Gemini).");
      const model = (a.model && a.model.trim()) || PROVIDERS[provider].defaultModel;
      const { text: raw, model: workingModel } = await callWithFallback(provider, a.apiKey, model, {
        system: systemPrompt(), user: userContent(input), schema: schemaFor(provider), maxTokens: 8000,
      });
      rememberWorkingModel(provider, workingModel);
      let parsed;
      try { parsed = JSON.parse(cleanJSON(raw)); }
      catch (e) { throw new Error("Não foi possível ler o resumo devolvido (JSON inválido). Tenta outro modelo em Definições."); }
      return normalize(parsed);
    },

    // Planos de pasta deixaram de ser gerados aqui (ver "Importar plano" em app.js, que cola a
    // resposta de uma conversa num Projeto do claude.ai) — normalizePlan continua a ser usado
    // para validar/sanear esse texto colado antes de guardar.
    normalizePlan,
  };

  /** Normaliza um item de passo do plano para { text, source } ou { text, url } — aceita texto
   *  simples, um item de plano antigo (gerado na app, referencia um conteúdo por "source"), ou
   *  um item de plano importado (colado do claude.ai, pode trazer um "url" solto). */
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

  function cleanJSON(s) {
    if (!s) return s;
    let t = s.trim();
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) t = m[1].trim();
    return t;
  }

  function normalize(s) {
    const arr = (x) => Array.isArray(x) ? x.filter((v) => (typeof v === "string" ? v.trim() : v)) : [];
    return {
      title: (s.title || "").trim() || "Sem título",
      tldr: (s.tldr || "").trim(),
      takeaways: arr(s.takeaways),
      sections: (Array.isArray(s.sections) ? s.sections : []).filter((x) => x && (x.heading || x.body)),
      quotes: arr(s.quotes),
      actions: arr(s.actions),
      topics: arr(s.topics).map((t) => String(t).toLowerCase()),
    };
  }

  async function providerError(r, provider) {
    let detail = "";
    try { const j = await r.json(); detail = (j.error && (j.error.message || j.error.status)) || ""; } catch (e) {}
    let msg = "Erro " + r.status;
    if (provider === "gemini") {
      if (r.status === 400 && /api key/i.test(detail)) msg = "Chave do Gemini inválida. Confirma-a em Definições.";
      else if (r.status === 403) msg = "Chave sem permissão ou API não ativada. Cria a chave em aistudio.google.com/app/apikey.";
      else if (r.status === 404) msg = "Modelo não encontrado. Experimenta outro modelo (ex.: gemini-1.5-flash).";
      else if (r.status === 429) msg = "Limite grátis atingido por agora. Espera um pouco e tenta de novo.";
      else if (r.status === 503) msg = "Este modelo está com muita procura neste momento. Tenta de novo.";
      else if (r.status >= 500) msg = "Servidor do Gemini temporariamente indisponível. Tenta de novo.";
      else if (detail) msg += ": " + detail;
    } else {
      if (r.status === 401) msg = "Chave da API inválida ou em falta. Verifica-a em Definições.";
      else if (r.status === 400) msg = "Pedido inválido" + (detail ? ": " + detail : ".");
      else if (r.status === 403) msg = "Sem permissão. A tua chave pode não ter acesso a este modelo.";
      else if (r.status === 429) msg = "Limite de utilização atingido. Espera um pouco e tenta de novo.";
      else if (r.status >= 500) msg = "Serviço temporariamente indisponível. Tenta de novo.";
      else if (detail) msg += ": " + detail;
    }
    const err = new Error(msg); err.status = r.status; return err;
  }

  global.AI = AI;
})(window);
