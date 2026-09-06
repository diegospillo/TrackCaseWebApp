/* ============================================================
   TrackCase WebApp — Store (localStorage)
   Multi-utente, multi-dispositivo. Ogni utente ha:
   - profilo (nome, budget, modello IQOS)
   - dispositivi ESP32 registrati (1..n)
   - sessioni TEREA per dispositivo (timestamp unix in secondi)
   ============================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'trackcase_web_v1';
  const MIN_VALID_TS = 946684800; // 1/1/2000: sotto questa soglia il ts ESP32 non era affidabile

  let db = { users: [], currentUserId: null };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (e) {
      console.warn('Store: caricamento fallito, reset.', e);
      db = { users: [], currentUserId: null };
    }
    if (!Array.isArray(db.users)) db.users = [];
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function uid() {
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Utenti ----------
  function createUser(name, budget, model) {
    const user = {
      id: uid(),
      name: name,
      budget: budget || 20,
      model: model || 'IlumaPrime',
      createdAt: Math.floor(Date.now() / 1000),
      devices: {},   // deviceId -> {id, name, iqosMac, addedAt, lastSyncTs, lifetime, battery, stateDesc, voltage, pollSec}
      sessions: {},  // deviceId -> [ts, ts, ...] ordinati
      rawMap: {}     // deviceId -> {rawTs: correctedTs} per eventi con orologio non valido
    };
    db.users.push(user);
    db.currentUserId = user.id;
    save();
    return user;
  }

  function getUsers() { return db.users; }

  function getCurrentUser() {
    return db.users.find(u => u.id === db.currentUserId) || null;
  }

  function selectUser(id) {
    if (db.users.some(u => u.id === id)) {
      db.currentUserId = id;
      save();
      return true;
    }
    return false;
  }

  function updateUser(id, patch) {
    const u = db.users.find(x => x.id === id);
    if (u) { Object.assign(u, patch); save(); }
  }

  // ---------- Dispositivi ----------
  function addDevice(userId, deviceId, name) {
    const u = db.users.find(x => x.id === userId);
    if (!u) return null;
    if (!u.devices[deviceId]) {
      u.devices[deviceId] = {
        id: deviceId,
        name: name || 'TrackCase',
        iqosMac: null,
        addedAt: Math.floor(Date.now() / 1000),
        lastSyncTs: 0,
        lifetime: 0,
        battery: 0,
        stateDesc: '',
        voltage: 0,
        pollSec: 600
      };
      u.sessions[deviceId] = [];
      u.rawMap[deviceId] = {};
      save();
    }
    return u.devices[deviceId];
  }

  function removeDevice(userId, deviceId) {
    const u = db.users.find(x => x.id === userId);
    if (!u) return;
    delete u.devices[deviceId];
    delete u.sessions[deviceId];
    delete u.rawMap[deviceId];
    save();
  }

  function updateDevice(userId, deviceId, patch) {
    const u = db.users.find(x => x.id === userId);
    if (u && u.devices[deviceId]) {
      Object.assign(u.devices[deviceId], patch);
      save();
    }
  }

  function getDevices(userId) {
    const u = db.users.find(x => x.id === userId);
    return u ? Object.values(u.devices) : [];
  }

  // ---------- Sessioni ----------
  // Merge degli eventi ricevuti dall'ESP32 con dedup.
  // Ritorna quanti eventi NUOVI sono stati aggiunti.
  function mergeEvents(userId, deviceId, rawTimestamps) {
    const u = db.users.find(x => x.id === userId);
    if (!u) return 0;
    if (!u.sessions[deviceId]) u.sessions[deviceId] = [];
    if (!u.rawMap[deviceId]) u.rawMap[deviceId] = {};

    const list = u.sessions[deviceId];
    const seen = new Set(list);
    const rawMap = u.rawMap[deviceId];
    const now = Math.floor(Date.now() / 1000);
    let added = 0;

    for (const raw of rawTimestamps) {
      let ts;
      if (raw >= MIN_VALID_TS) {
        ts = raw; // orologio ESP32 valido: timestamp reale
      } else if (rawMap[raw]) {
        ts = rawMap[raw]; // già corretto in una sync precedente
      } else {
        // Orologio non valido: assegna un secondo distinto vicino all'arrivo,
        // senza mai collidere con timestamp già presenti.
        ts = now - Object.keys(rawMap).length;
        while (seen.has(ts)) ts--;
        rawMap[raw] = ts;
      }
      if (!seen.has(ts)) {
        seen.add(ts);
        list.push(ts);
        added++;
      }
    }

    if (added > 0) {
      list.sort((a, b) => a - b);
      const maxTs = list[list.length - 1];
      if (u.devices[deviceId] && maxTs > (u.devices[deviceId].lastSyncTs || 0)) {
        u.devices[deviceId].lastSyncTs = maxTs;
      }
      save();
    }
    return added;
  }

  // Sessioni dell'utente: di un dispositivo o di tutti (merge ordinato)
  function getSessions(userId, deviceId) {
    const u = db.users.find(x => x.id === userId);
    if (!u) return [];
    if (deviceId) return (u.sessions[deviceId] || []).slice();
    let all = [];
    for (const id of Object.keys(u.sessions)) all = all.concat(u.sessions[id]);
    return all.sort((a, b) => a - b);
  }

  function totalSessionCount(userId) {
    return getSessions(userId).length;
  }

  // ---------- Utility date (giorni di calendario locali) ----------
  function dayKey(ts) {
    const d = new Date(ts * 1000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getSessionsForDate(userId, date, deviceId) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
    const end = start + 86400;
    return getSessions(userId, deviceId).filter(ts => ts >= start && ts < end);
  }

  function getLastSevenDaysTotals(userId, deviceId) {
    const totals = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      totals.push(getSessionsForDate(userId, d, deviceId).length);
    }
    return totals;
  }

  function getBestStreak(userId, budget, deviceId) {
    const sessions = getSessions(userId, deviceId);
    if (sessions.length === 0) return 0;
    const counts = {};
    for (const ts of sessions) {
      const k = dayKey(ts);
      counts[k] = (counts[k] || 0) + 1;
    }
    const keys = Object.keys(counts).sort();
    let best = 0, cur = 0;
    let prevDay = null;
    for (const k of keys) {
      const day = new Date(k + 'T00:00:00');
      const consecutive = prevDay && (day - prevDay === 86400000);
      if (counts[k] > 0 && counts[k] <= budget) {
        cur = consecutive ? cur + 1 : 1;
        best = Math.max(best, cur);
      } else {
        cur = 0;
      }
      prevDay = day;
    }
    return best;
  }

  load();

  // Cancella lo storico locale della WebApp per un dispositivo (o tutti).
  // Svuota anche la rawMap: senza, al prossimo sync i raw non validi
  // verrebbero riconosciuti e NON riaggiunti solo se l'ESP32 e' gia' pulito.
  function clearSessions(userId, deviceId) {
    const u = db.users.find(x => x.id === userId);
    if (!u) return;
    if (deviceId) {
      u.sessions[deviceId] = [];
      u.rawMap[deviceId] = {};
    } else {
      for (const id of Object.keys(u.sessions)) u.sessions[id] = [];
      for (const id of Object.keys(u.rawMap)) u.rawMap[id] = {};
    }
    save();
  }

  global.Store = {
    MIN_VALID_TS,
    createUser, getUsers, getCurrentUser, selectUser, updateUser,
    addDevice, removeDevice, updateDevice, getDevices,
    mergeEvents, getSessions, getSessionsForDate, getLastSevenDaysTotals,
    getBestStreak, totalSessionCount, dayKey, clearSessions,
    save
  };
})(window);
