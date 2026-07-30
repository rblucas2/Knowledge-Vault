/* =====================================================================
   store.js — estado local-first (localStorage) + pub/sub
   Namespaces: "vault" (dados) e "sys" (definições).
   Liga-se ao sync.js (Supabase, opcional) quando configurado.
   ===================================================================== */
(function (global) {
  const PREFIX = "kvault:";
  const listeners = {};   // ns -> Set(fn)
  const cache = {};       // ns -> objeto

  const key = (ns) => PREFIX + ns;

  function load(ns) {
    if (cache[ns]) return cache[ns];
    let data = {};
    try {
      const raw = localStorage.getItem(key(ns));
      if (raw) data = JSON.parse(raw);
    } catch (e) { console.warn("store load falhou", ns, e); }
    cache[ns] = data;
    return data;
  }

  function save(ns, { silent = false, fromSync = false } = {}) {
    const data = cache[ns] || {};
    data._updatedAt = data._updatedAt || Date.now();
    try { localStorage.setItem(key(ns), JSON.stringify(data)); }
    catch (e) { console.error("store save falhou (cheio?)", e); global.UI && UI.toast("Erro ao guardar (armazenamento cheio?)"); }
    if (!silent) emit(ns);
    if (!fromSync && global.Sync) global.Sync.push(ns, data);
  }

  function emit(ns) {
    (listeners[ns] || []).forEach((fn) => { try { fn(cache[ns]); } catch (e) { console.error(e); } });
    (listeners["*"] || []).forEach((fn) => { try { fn(ns, cache[ns]); } catch (e) { console.error(e); } });
  }

  const Store = {
    get(ns) { return load(ns); },

    update(ns, mutator, opts) {
      const data = load(ns);
      mutator(data);
      data._updatedAt = Date.now();
      save(ns, opts);
      return data;
    },

    replace(ns, data, opts = {}) {
      cache[ns] = data || {};
      save(ns, { ...opts });
    },

    ensure(ns, defaults) {
      const data = load(ns);
      let changed = false;
      for (const k in defaults) if (!(k in data)) { data[k] = defaults[k]; changed = true; }
      if (changed) save(ns, { silent: true });
      return data;
    },

    subscribe(ns, fn) {
      (listeners[ns] = listeners[ns] || new Set()).add(fn);
      return () => listeners[ns].delete(fn);
    },

    emit,

    exportAll() {
      const out = { vault: load("vault"), sys: load("sys"), _exportedAt: new Date().toISOString(), _app: "knowledge-vault" };
      return out;
    },

    importAll(obj) {
      if (obj.vault) { cache.vault = obj.vault; save("vault"); }
      if (obj.sys)   { cache.sys   = obj.sys;   save("sys"); }
    },
  };

  global.Store = Store;
})(window);
