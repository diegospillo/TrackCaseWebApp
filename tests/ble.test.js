/* ============================================================
   Test unitari protocollo BLE WebApp (parser + reassembly) — node:test
   Esegui:  node --test webapp/tests/
   ============================================================ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/ble.js');
const { TrackCaseBle, BleProtocol } = global;

// ---------- parseKv ----------

test('parseKv: STATUS con sole coppie chiave=valore', () => {
  const m = BleProtocol.parseKv(
    'STATUS|fw=2.0.0|battery=31|odometer=5537|state=0|charging=1|holder=0|voltage=5.03|poll=30');
  assert.strictEqual(m.type, 'STATUS');
  assert.strictEqual(m.kv.battery, '31');
  assert.strictEqual(m.kv.odometer, '5537');
  assert.strictEqual(m.kv.voltage, '5.03');
  assert.strictEqual(m.kv.charging, '1');
  assert.strictEqual(m.kv.holder, '0');
});

test('parseKv: HELLO con mix di elementi posizionali e kv', () => {
  const m = BleProtocol.parseKv('HELLO|TrackCase|fw=2.0.0|id=88:56:a6:3b:01:6a');
  assert.strictEqual(m.type, 'HELLO');
  assert.strictEqual(m.list[0], 'TrackCase');
  assert.strictEqual(m.kv.fw, '2.0.0');
  assert.strictEqual(m.kv.id, '88:56:a6:3b:01:6a');
});

test('parseKv: pagina EVENTS vs END', () => {
  const page = BleProtocol.parseKv('EVENTS|page=0|1725000000,1725000060,1725003600');
  assert.strictEqual(page.type, 'EVENTS');
  assert.strictEqual(page.kv.page, '0');
  assert.strictEqual(page.list[1], '1725000000,1725000060,1725003600');
  const tsList = page.list[1].split(',').filter(Boolean).map(Number);
  assert.deepStrictEqual(tsList, [1725000000, 1725000060, 1725003600]);

  const end = BleProtocol.parseKv('EVENTS|END|total=0');
  assert.strictEqual(end.kv.page, undefined);
  assert.strictEqual(end.list[0], 'END');
  assert.strictEqual(end.kv.total, '0');
});

test('parseKv: IQOS_MAC, EVENT, LIVE, OK', () => {
  const mac = BleProtocol.parseKv('IQOS_MAC|c0:69:06:10:85:23');
  assert.strictEqual(mac.list[0], 'c0:69:06:10:85:23');

  const ev = BleProtocol.parseKv('EVENT|1725000000|live');
  assert.strictEqual(ev.list[0], '1725000000');
  assert.strictEqual(ev.list[1], 'live');

  const live = BleProtocol.parseKv('LIVE|state=0|desc=Inizio Handshake / Lettura Stick');
  assert.strictEqual(live.kv.state, '0');
  assert.strictEqual(live.kv.desc, 'Inizio Handshake / Lettura Stick');

  const ok = BleProtocol.parseKv('OK|SET_POLL|30');
  assert.strictEqual(ok.type, 'OK');
  assert.strictEqual(ok.list[0], 'SET_POLL');
  assert.strictEqual(ok.list[1], '30');
});

// ---------- reassembly chunk -> righe ----------

function makeReceiver() {
  const ble = new TrackCaseBle();
  const lines = [];
  ble.onMessage = l => lines.push(l);
  const enc = new TextEncoder();
  return {
    lines,
    feed: (s) => ble._onChunk({ buffer: enc.encode(s).buffer })
  };
}

test('reassembly: una riga intera in un chunk', () => {
  const r = makeReceiver();
  r.feed('OK|TIME\n');
  assert.deepStrictEqual(r.lines, ['OK|TIME']);
});

test('reassembly: riga spezzata su piu chunk (caso BLE reale)', () => {
  const r = makeReceiver();
  const msg = 'STATUS|fw=2.0.0|battery=31|odometer=5537|poll=30\n';
  // spezzo in 3 pezzi, anche a meta' token
  r.feed(msg.slice(0, 7));
  assert.strictEqual(r.lines.length, 0); // niente emissione parziale
  r.feed(msg.slice(7, 40));
  assert.strictEqual(r.lines.length, 0);
  r.feed(msg.slice(40));
  assert.deepStrictEqual(r.lines, [msg.trim()]);
});

test('reassembly: piu righe in un solo chunk', () => {
  const r = makeReceiver();
  r.feed('HELLO|TrackCase|fw=2.0.0\nOK|TIME\nEVENTS|END|total=0\n');
  assert.deepStrictEqual(r.lines, ['HELLO|TrackCase|fw=2.0.0', 'OK|TIME', 'EVENTS|END|total=0']);
});

test('reassembly: coda di riga senza newline arriva al chunk successivo', () => {
  const r = makeReceiver();
  r.feed('OK|POLL_NOW\nLIVE|state=0'); // seconda riga incompleta
  assert.deepStrictEqual(r.lines, ['OK|POLL_NOW']);
  r.feed('|desc=Fine\n');
  assert.deepStrictEqual(r.lines, ['OK|POLL_NOW', 'LIVE|state=0|desc=Fine']);
});

test('reassembly: righe vuote ignorate', () => {
  const r = makeReceiver();
  r.feed('\n\nOK|TIME\n\n');
  assert.deepStrictEqual(r.lines, ['OK|TIME']);
});

test('reassembly: chunk lunghi (EVENTS paginati) ricomposti intatti', () => {
  const r = makeReceiver();
  const ts = Array.from({ length: 25 }, (_, i) => 1725000000 + i * 60).join(',');
  const line = 'EVENTS|page=0|' + ts;
  // firmware invia in chunk da 180 byte: simulo lo stesso
  const full = line + '\n';
  for (let off = 0; off < full.length; off += 180) {
    r.feed(full.slice(off, off + 180));
  }
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0], line);
  assert.strictEqual(r.lines[0].split(',').length, 25);
});

test('setLimits: exact command, disabled mode, and invalid input rejection', async () => {
  const ble = new TrackCaseBle();
  const sent = [];
  ble.send = async line => sent.push(line);
  await ble.setLimits(10, 4);
  await ble.setLimits(0, 168);
  assert.deepStrictEqual(sent, ['SET_LIMITS|10|4', 'SET_LIMITS|0|168']);
  for (const [n, h] of [[-1,4], [201,4], [10,0], [10,169], [1.5,4], [10,NaN], ['10',4]]) {
    assert.throws(() => ble.setLimits(n, h));
  }
});

test('lock STATUS: fragmented settings, intent and deadline survive reassembly', () => {
  const { feed, lines } = makeReceiver();
  const line = 'STATUS|max_terea_per_day=10|lock_duration_hours=4|lock_phase=3|lock_until=1788886800|today=10|timezone=Europe/Rome\n';
  for (let i = 0; i < line.length; i += 17) {
    feed(line.slice(i, i + 17));
  }
  const msg = BleProtocol.parseKv(lines[0]);
  assert.strictEqual(msg.kv.lock_phase, '3');
  assert.strictEqual(msg.kv.lock_until, '1788886800');
  assert.strictEqual(msg.kv.timezone, 'Europe/Rome');
});
