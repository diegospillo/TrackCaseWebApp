/* ============================================================
   Test unitari Store (logica dati WebApp) — node:test
   Esegui:  node --test webapp/tests/
   ============================================================ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

// Carica store.js fresco con una localStorage in-memory isolata.
// Se `mem` e' passata, la riusa (per testare la persistenza al reload).
function freshStore(mem) {
  const memory = mem || {};
  global.window = global;
  global.localStorage = {
    getItem: k => (k in memory ? memory[k] : null),
    setItem: (k, v) => { memory[k] = String(v); },
    removeItem: k => { delete memory[k]; },
    clear: () => { Object.keys(memory).forEach(k => delete memory[k]); }
  };
  delete require.cache[require.resolve('../js/store.js')];
  require('../js/store.js');
  return { Store: global.Store, memory };
}

// Timestamp unix a una data relativa (ore fisse per evitare edge di mezzanotte)
function tsOn(daysAgo, h = 12, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, min, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

test('createUser imposta profilo e utente corrente', () => {
  const { Store } = freshStore();
  const u = Store.createUser('Diego', 12, 'IlumaDiego');
  assert.strictEqual(u.name, 'Diego');
  assert.strictEqual(u.budget, 12);
  assert.strictEqual(u.model, 'IlumaDiego');
  assert.ok(u.id.startsWith('u_'));
  assert.strictEqual(Store.getCurrentUser().id, u.id);
  assert.strictEqual(Store.getUsers().length, 1);
});

test('addDevice e idempotente e ha default sensati', () => {
  const { Store } = freshStore();
  const u = Store.createUser('Diego', 12, 'IlumaDiego');
  const d1 = Store.addDevice(u.id, 'aa:bb:cc:dd:ee:ff', 'TrackCase ee:ff');
  assert.strictEqual(d1.pollSec, 600);
  assert.strictEqual(d1.iqosMac, null);
  const d2 = Store.addDevice(u.id, 'aa:bb:cc:dd:ee:ff', 'Altro nome');
  assert.strictEqual(Store.getDevices(u.id).length, 1); // non duplica
  assert.strictEqual(d2.name, 'TrackCase ee:ff');       // nome originale conservato
});

test('mergeEvents: aggiunta, dedup, ordinamento, lastSyncTs', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  const dev = 'dev1';
  Store.addDevice(u.id, dev, 'T');

  const t1 = tsOn(0, 8), t2 = tsOn(0, 9), t3 = tsOn(1, 10);
  assert.strictEqual(Store.mergeEvents(u.id, dev, [t2, t1, t3]), 3); // arrivano disordinati
  assert.deepStrictEqual(Store.getSessions(u.id, dev), [t3, t1, t2]); // ordinati crescenti
  assert.strictEqual(Store.mergeEvents(u.id, dev, [t1, t2, t3]), 0);  // re-sync: niente doppi
  assert.strictEqual(Store.getSessions(u.id, dev).length, 3);
  // lastSyncTs = timestamp piu' recente
  assert.strictEqual(Store.getDevices(u.id)[0].lastSyncTs, t2);
});

test('mergeEvents: timestamp non validi riassegnati senza collisioni ne duplicati al re-sync', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  const dev = 'dev1';
  Store.addDevice(u.id, dev, 'T');

  // Orologio ESP32 non valido: raw piccoli (1,2,3 = contatore firmware)
  assert.strictEqual(Store.mergeEvents(u.id, dev, [1, 2, 3]), 3);
  const sess = Store.getSessions(u.id, dev);
  assert.strictEqual(sess.length, 3);
  // riassegnati a secondi distinti e validi (>= 1/1/2000)
  assert.ok(sess.every(ts => ts >= Store.MIN_VALID_TS));
  assert.strictEqual(new Set(sess).size, 3);

  // Re-sync con gli STESSI raw: la rawMap li riconosce -> zero duplicati
  assert.strictEqual(Store.mergeEvents(u.id, dev, [1, 2, 3]), 0);
  assert.strictEqual(Store.getSessions(u.id, dev).length, 3);

  // Nuovo raw (4) -> un solo aggiunto
  assert.strictEqual(Store.mergeEvents(u.id, dev, [1, 2, 3, 4]), 1);
  assert.strictEqual(Store.getSessions(u.id, dev).length, 4);
});

test('mergeEvents: raw invalido non collide con timestamp reali esistenti', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  const dev = 'dev1';
  Store.addDevice(u.id, dev, 'T');

  const now = Math.floor(Date.now() / 1000);
  // Esiste gia' un evento reale esattamente a "now": il primo raw invalido
  // punterebbe proprio li' -> deve scalare a now-1 senza perdere eventi.
  Store.mergeEvents(u.id, dev, [now]);
  assert.strictEqual(Store.mergeEvents(u.id, dev, [7, 8]), 2);
  const sess = Store.getSessions(u.id, dev);
  assert.strictEqual(sess.length, 3);
  assert.strictEqual(new Set(sess).size, 3);
});

test('getSessionsForDate filtra per giorno di calendario', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  const dev = 'dev1';
  Store.addDevice(u.id, dev, 'T');

  Store.mergeEvents(u.id, dev, [tsOn(0, 8), tsOn(0, 9), tsOn(1, 10), tsOn(6, 22)]);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  assert.strictEqual(Store.getSessionsForDate(u.id, today, dev).length, 2);
  assert.strictEqual(Store.getSessionsForDate(u.id, yesterday, dev).length, 1);
});

test('getLastSevenDaysTotals restituisce 7 totali corretti', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  const dev = 'dev1';
  Store.addDevice(u.id, dev, 'T');

  Store.mergeEvents(u.id, dev, [tsOn(0, 8), tsOn(0, 9), tsOn(2, 10), tsOn(6, 22), tsOn(8, 12)]);
  const totals = Store.getLastSevenDaysTotals(u.id, dev);
  assert.strictEqual(totals.length, 7);
  // ordine: [6 giorni fa ... oggi]
  assert.deepStrictEqual(totals, [1, 0, 0, 0, 1, 0, 2]);
  assert.strictEqual(totals.reduce((a, b) => a + b, 0), 4); // il ts di 8 gg fa e' fuori
});

test('getBestStreak: giorni consecutivi sotto budget; buchi e sforamenti azzerano', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 2, 'IlumaPrime'); // budget 2/giorno
  const dev = 'dev1';
  Store.addDevice(u.id, dev, 'T');

  // 3 giorni consecutivi ok (5,4,3 giorni fa), poi sforamento (2 gg fa, 3 > budget),
  // poi 1 giorno ok (oggi): streak migliore = 3
  Store.mergeEvents(u.id, dev, [
    tsOn(5, 10), tsOn(4, 10), tsOn(3, 10), tsOn(3, 11),
    tsOn(2, 10), tsOn(2, 11), tsOn(2, 12),
    tsOn(0, 10)
  ]);
  assert.strictEqual(Store.getBestStreak(u.id, u.budget, dev), 3);

  // Nessuna sessione -> 0
  const { Store: s2 } = freshStore();
  const u2 = s2.createUser('X', 5, 'IlumaOne');
  assert.strictEqual(s2.getBestStreak(u2.id, u2.budget, null), 0);
});

test('multi-device: sessioni separate e merge ordinato', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  Store.addDevice(u.id, 'devA', 'A');
  Store.addDevice(u.id, 'devB', 'B');

  Store.mergeEvents(u.id, 'devA', [tsOn(0, 9), tsOn(1, 9)]);
  Store.mergeEvents(u.id, 'devB', [tsOn(0, 10)]);

  assert.strictEqual(Store.getSessions(u.id, 'devA').length, 2);
  assert.strictEqual(Store.getSessions(u.id, 'devB').length, 1);
  const all = Store.getSessions(u.id, null);
  assert.strictEqual(all.length, 3);
  assert.ok(all[0] <= all[1] && all[1] <= all[2]); // merge ordinato
  assert.strictEqual(Store.totalSessionCount(u.id), 3);
});

test('removeDevice elimina dispositivo e storico', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  Store.addDevice(u.id, 'devA', 'A');
  Store.mergeEvents(u.id, 'devA', [tsOn(0, 9)]);
  Store.removeDevice(u.id, 'devA');
  assert.strictEqual(Store.getDevices(u.id).length, 0);
  assert.strictEqual(Store.getSessions(u.id, 'devA').length, 0);
});

test('clearSessions svuota lo storico locale (tutti i dispositivi)', () => {
  const { Store } = freshStore();
  const u = Store.createUser('D', 20, 'IlumaPrime');
  Store.addDevice(u.id, 'devA', 'A');
  Store.addDevice(u.id, 'devB', 'B');
  Store.mergeEvents(u.id, 'devA', [tsOn(0, 9), tsOn(1, 9)]);
  Store.mergeEvents(u.id, 'devB', [1, 2]); // raw non validi -> riassegnati
  assert.strictEqual(Store.totalSessionCount(u.id), 4);

  // Solo un dispositivo
  Store.clearSessions(u.id, 'devA');
  assert.strictEqual(Store.getSessions(u.id, 'devA').length, 0);
  assert.strictEqual(Store.getSessions(u.id, 'devB').length, 2);

  // Tutti i dispositivi
  Store.clearSessions(u.id, null);
  assert.strictEqual(Store.totalSessionCount(u.id), 0);

  // I dispositivi restano registrati: solo lo storico e' svuotato
  assert.strictEqual(Store.getDevices(u.id).length, 2);
});

test('persistenza: i dati sopravvivono a un reload (localStorage)', () => {
  const mem = {};
  const { Store: s1 } = freshStore(mem);
  const u = s1.createUser('Diego', 12, 'IlumaDiego');
  s1.addDevice(u.id, 'devA', 'A');
  s1.mergeEvents(u.id, 'devA', [tsOn(0, 9), tsOn(1, 9)]);

  // Simula riavvio browser: stessa localStorage, modulo ricaricato
  const { Store: s2 } = freshStore(mem);
  const u2 = s2.getCurrentUser();
  assert.ok(u2);
  assert.strictEqual(u2.name, 'Diego');
  assert.strictEqual(s2.getSessions(u2.id, 'devA').length, 2);
  assert.strictEqual(s2.getDevices(u2.id).length, 1);
});
