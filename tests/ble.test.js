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


// ---------- batteria TrackCase ----------

test('TC_BATTERY: letture 82% e 59% preservano la stima del firmware', () => {
  const first = BleProtocol.parseTrackCaseBattery('TC_BATTERY|voltage=4.04|percent=82', 1000);
  assert.deepStrictEqual(first, { voltage: 4.04, percent: 82, available: true, updatedAt: 1000 });

  const second = BleProtocol.parseTrackCaseBattery('TC_BATTERY|voltage=3.83|percent=59', 2000);
  assert.deepStrictEqual(second, { voltage: 3.83, percent: 59, available: true, updatedAt: 2000 });
});

test('TC_BATTERY: lettura non disponibile e 0% valido sono distinti', () => {
  const unavailable = BleProtocol.parseTrackCaseBattery('TC_BATTERY|voltage=0.00|percent=-1', 1000);
  assert.deepStrictEqual(unavailable, { voltage: 0, percent: -1, available: false, updatedAt: 1000 });

  const empty = BleProtocol.parseTrackCaseBattery('TC_BATTERY|voltage=3.20|percent=0', 2000);
  assert.strictEqual(empty.available, true);
  assert.strictEqual(empty.percent, 0);
});

test('TC_BATTERY: valori assenti o non numerici non sono disponibili', () => {
  assert.strictEqual(BleProtocol.parseTrackCaseBattery('TC_BATTERY|voltage=4.04').available, false);
  assert.strictEqual(BleProtocol.parseTrackCaseBattery('TC_BATTERY|percent=82').available, false);
  assert.strictEqual(BleProtocol.parseTrackCaseBattery('TC_BATTERY|voltage=abc|percent=82').available, false);
});

test('STATUS: tc_battery e tc_voltage restano separati dalla batteria IQOS', () => {
  const line = 'STATUS|battery=31|voltage=5.03|tc_battery=82|tc_voltage=4.04|odometer=5537';
  const msg = BleProtocol.parseKv(line);
  const reading = BleProtocol.parseTrackCaseBattery(msg, 1234);

  assert.deepStrictEqual(reading, { voltage: 4.04, percent: 82, available: true, updatedAt: 1234 });
  assert.strictEqual(msg.kv.battery, '31');
  assert.strictEqual(msg.kv.voltage, '5.03');
  assert.strictEqual(BleProtocol.parseTrackCaseBattery('STATUS|battery=31|voltage=5.03'), null);
});

test('STATUS: lettura TrackCase non disponibile non altera i campi IQOS', () => {
  const msg = BleProtocol.parseKv('STATUS|battery=0|voltage=0|tc_battery=-1|tc_voltage=0.00');
  const reading = BleProtocol.parseTrackCaseBattery(msg);
  assert.strictEqual(reading.available, false);
  assert.strictEqual(reading.percent, -1);
  assert.strictEqual(msg.kv.battery, '0');
  assert.strictEqual(msg.kv.voltage, '0');
});

test('TC_BATTERY: messaggio spezzato tra due notifiche', () => {
  const r = makeReceiver();
  r.feed('TC_BATTERY|voltage=4.04|per');
  assert.deepStrictEqual(r.lines, []);
  r.feed('cent=82\n');
  assert.deepStrictEqual(r.lines, ['TC_BATTERY|voltage=4.04|percent=82']);
  assert.strictEqual(BleProtocol.parseTrackCaseBattery(r.lines[0]).percent, 82);
});

test('TC_BATTERY: piu messaggi nella stessa notifica', () => {
  const r = makeReceiver();
  r.feed('TC_BATTERY|voltage=4.04|percent=82\nTC_BATTERY|voltage=3.83|percent=59\nTC_BATTERY|voltage=0.00|percent=-1\n');
  assert.deepStrictEqual(r.lines.map(line => BleProtocol.parseTrackCaseBattery(line).percent), [82, 59, -1]);
  assert.deepStrictEqual(r.lines.map(line => BleProtocol.parseTrackCaseBattery(line).available), [true, true, false]);
});

test('requestTrackCaseBattery: scrive esattamente TC_BATTERY con newline', async () => {
  const ble = new TrackCaseBle();
  const writes = [];
  ble.connected = true;
  ble.rxChar = {
    writeValueWithResponse: async chunk => writes.push(new TextDecoder().decode(chunk))
  };
  await ble.requestTrackCaseBattery();
  assert.deepStrictEqual(writes, ['TC_BATTERY\n']);
});

test('connessione e riconnessione: richiesta iniziale e listener non duplicati', async (t) => {
  const writes = [];
  const deviceListeners = new Set();
  const txListeners = new Set();
  const txChar = {
    startNotifications: async () => {},
    addEventListener: (type, fn) => { if (type === 'characteristicvaluechanged') txListeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'characteristicvaluechanged') txListeners.delete(fn); }
  };
  const rxChar = {
    writeValueWithResponse: async chunk => writes.push(new TextDecoder().decode(chunk))
  };
  const service = {
    getCharacteristic: async uuid => uuid === '19b10001-e8f2-537e-4f6c-d104768a1214' ? rxChar : txChar
  };
  const device = {
    id: 'trackcase-test',
    addEventListener: (type, fn) => { if (type === 'gattserverdisconnected') deviceListeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'gattserverdisconnected') deviceListeners.delete(fn); },
    gatt: {
      connected: false,
      connect: async () => {
        device.gatt.connected = true;
        return { getPrimaryService: async () => service };
      },
      disconnect: () => {
        device.gatt.connected = false;
        deviceListeners.forEach(fn => fn());
      }
    }
  };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { bluetooth: { requestDevice: async () => device } }
  });
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });

  const ble = new TrackCaseBle();
  const states = [];
  const lines = [];
  ble.onConnectionChange = connected => states.push(connected);
  ble.onMessage = line => lines.push(line);

  await ble.connect();
  await ble.disconnect();
  await ble.connect();
  assert.deepStrictEqual(writes, ['TC_BATTERY\n', 'TC_BATTERY\n']);
  assert.deepStrictEqual(states, [true, false, true]);
  assert.strictEqual(deviceListeners.size, 1);
  assert.strictEqual(txListeners.size, 1);

  const value = new TextEncoder().encode('TC_BATTERY|voltage=3.83|percent=59\n');
  txListeners.forEach(fn => fn({ target: { value: { buffer: value.buffer } } }));
  assert.deepStrictEqual(lines, ['TC_BATTERY|voltage=3.83|percent=59']);
  await ble.disconnect();
});
