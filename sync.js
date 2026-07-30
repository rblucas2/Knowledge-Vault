/* =====================================================================
   sync.js — sincronização gratuita e opcional via Supabase (REST)
   Modelo "blob por app" com merge sem perdas por id (last-write-wins
   nos campos, união nas listas). O mesmo "código de sincronização" liga
   telemóvel e PC. Sem cartão de crédito — free tier chega de sobra.

   Tabela (cola no SQL Editor do Supabase):
     create table if not exists app_state (
       app text not null, sync_code text not null, data jsonb not null,
       updated_at timestamptz not null default now(),
       primary key (app, sync_code));
     alter table app_state enable row level security;
     create policy "acesso por codigo" on app_state
       for all using (true) with check (true);
   ===================================================================== */
(function (global) {
  const CFG_NS = "sys";
  let cfg = null;         // { url, key, code }
  let status = "off";     // off | ready | syncing | error
  const pushTimers = {};
  const statusCbs = new Set();

  function setStatus(s, detail) { status = s; statusCbs.forEach((f) => f(s, detail)); }

  function loadCfg() {
    const sys = Store.get(CFG_NS);
    const c = sys.sync || {};
    cfg = (c.url && c.key && c.code) ? { url: c.url.replace(/\/$/, ""), key: c.key, code: c.code } : null;
    setStatus(cfg ? "ready" : "off");
    return cfg;
  }

  function authFor(k) { const h = { apikey: k }; if (k && k.indexOf("eyJ") === 0) h.Authorization = "Bearer " + k; return h; }
  function headers() {
    return Object.assign({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, authFor(cfg.key));
  }

  const apps = ["vault"];
  const ID_ARRAYS = { vault: ["entries", "collections"] };

  async function push(ns, data) {
    if (!cfg || !apps.includes(ns)) return;
    clearTimeout(pushTimers[ns]);
    pushTimers[ns] = setTimeout(async () => {
      try {
        setStatus("syncing");
        const body = [{ app: ns, sync_code: cfg.code, data, updated_at: new Date(data._updatedAt || Date.now()).toISOString() }];
        const r = await fetch(`${cfg.url}/rest/v1/app_state`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
        if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()));
        setStatus("ready");
      } catch (e) { console.warn("sync push", e); setStatus("error", e.message); }
    }, 1200);
  }

  function mergeStates(ns, local, remote) {
    const remoteNewer = (remote._updatedAt || 0) >= (local._updatedAt || 0);
    const newer = remoteNewer ? remote : local, older = remoteNewer ? local : remote;
    const out = JSON.parse(JSON.stringify(newer));
    (ID_ARRAYS[ns] || []).forEach((k) => {
      const arr = Array.isArray(out[k]) ? out[k] : [];
      const ids = new Set(arr.map((x) => x && x.id));
      (older[k] || []).forEach((x) => { if (x && !ids.has(x.id)) arr.push(x); });
      out[k] = arr;
    });
    out._updatedAt = Math.max(local._updatedAt || 0, remote._updatedAt || 0);
    return out;
  }
  const stripVol = (o) => { const c = { ...o }; delete c._updatedAt; return JSON.stringify(c); };

  async function pullOne(ns) {
    const url = `${cfg.url}/rest/v1/app_state?app=eq.${ns}&sync_code=eq.${encodeURIComponent(cfg.code)}&select=data,updated_at`;
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rows = await r.json();
    const local = Store.get(ns);
    if (!rows.length) { if (Object.keys(local).length) push(ns, local); return false; }
    const remote = rows[0].data || {};
    const merged = mergeStates(ns, local, remote);
    const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
    if (changedLocal) Store.replace(ns, merged, { fromSync: true });
    if (stripVol(merged) !== stripVol(remote)) push(ns, merged);
    return changedLocal;
  }

  async function pullAll() {
    if (!cfg) return;
    try {
      setStatus("syncing");
      let changed = 0;
      for (const ns of apps) { if (await pullOne(ns)) changed++; }
      setStatus("ready");
      return changed;
    } catch (e) { console.warn("sync pull", e); setStatus("error", e.message); }
  }

  async function test(c) {
    const u = c.url.replace(/\/$/, "");
    const r = await fetch(`${u}/rest/v1/app_state?select=app&limit=1`, { headers: authFor(c.key) });
    if (!r.ok) throw new Error("HTTP " + r.status + " — verifica URL/chave e se a tabela 'app_state' existe.");
    return true;
  }

  const Sync = {
    init() {
      loadCfg();
      if (cfg) { pullAll(); setInterval(pullAll, 60000); }
      document.addEventListener("visibilitychange", () => { if (!document.hidden && cfg) pullAll(); });
      window.addEventListener("online", () => { if (cfg) pullAll(); });
    },
    push, pullAll, test,
    reload() { loadCfg(); if (cfg) pullAll(); },
    onStatus(cb) { statusCbs.add(cb); cb(status); return () => statusCbs.delete(cb); },
    get status() { return status; },
    get enabled() { return !!cfg; },
    sqlSchema:
`-- Cola isto no SQL Editor do teu projeto Supabase (gratuito) e clica RUN:
create table if not exists app_state (
  app text not null,
  sync_code text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (app, sync_code)
);
alter table app_state enable row level security;
create policy "acesso por codigo" on app_state
  for all using (true) with check (true);`,
  };

  global.Sync = Sync;
})(window);
