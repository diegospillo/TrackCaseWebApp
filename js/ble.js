/* ============================================================
   TrackCase WebApp — Client Web Bluetooth
   Parla con il firmware v2 (WebAppServer) sul servizio
   19B10000-... Protocollo a righe '\n' con riassemblaggio chunk.
   Compatibile Bluefy (iOS) e Chrome (Android/desktop).
   ============================================================ */
(function (global) {
  'use strict';

  const SERVICE_UUID = '19b10000-e8f2-537e-4f6c-d104768a1214';
  const CHAR_RX = '19b10001-e8f2-537e-4f6c-d104768a1214'; // WebApp -> ESP32
  const CHAR_TX = '19b10002-e8f2-537e-4f6c-d104768a1214'; // ESP32 -> WebApp

  const CHUNK = 180; // deve corrispondere a TC_TX_CHUNK_SIZE nel firmware

  class TrackCaseBle {
    constructor() {
      this.device = null;
      this.server = null;
      this.rxChar = null;
      this.txChar = null;
      this.connected = false;
      this.rxBuffer = '';
      this.writeQueue = Promise.resolve();

      // Callback pubbliche
      this.onMessage = null;      // (line: string)
      this.onConnectionChange = null; // (connected: boolean)
    }

    static isSupported() {
      return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
    }

    // Apre il picker di sistema (richiede gesto utente) e si connette.
    async connect() {
      if (!TrackCaseBle.isSupported()) {
        throw new Error('Web Bluetooth non supportato: usa Bluefy (iOS) o Chrome.');
      }
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this._setConnected(false);
      });

      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(SERVICE_UUID);
      this.rxChar = await service.getCharacteristic(CHAR_RX);
      this.txChar = await service.getCharacteristic(CHAR_TX);

      await this.txChar.startNotifications();
      this.txChar.addEventListener('characteristicvaluechanged', (ev) => {
        this._onChunk(ev.target.value);
      });

      this._setConnected(true);
      return this.device;
    }

    async disconnect() {
      try {
        if (this.device && this.device.gatt.connected) {
          this.device.gatt.disconnect();
        }
      } catch (e) { /* già disconnesso */ }
      this._setConnected(false);
    }

    _setConnected(state) {
      this.connected = state;
      if (this.onConnectionChange) this.onConnectionChange(state);
    }

    // ---------- RX: riassembla i chunk in righe ----------
    _onChunk(value) {
      const text = new TextDecoder().decode(value.buffer);
      this.rxBuffer += text;
      let nl;
      while ((nl = this.rxBuffer.indexOf('\n')) >= 0) {
        const line = this.rxBuffer.slice(0, nl).trim();
        this.rxBuffer = this.rxBuffer.slice(nl + 1);
        if (line && this.onMessage) this.onMessage(line);
      }
      if (this.rxBuffer.length > 4096) this.rxBuffer = ''; // sicurezza
    }

    // ---------- TX: scrive frammentando se necessario ----------
    send(line) {
      const payload = new TextEncoder().encode(line + '\n');
      this.writeQueue = this.writeQueue.then(async () => {
        if (!this.rxChar || !this.connected) return;
        for (let off = 0; off < payload.length; off += CHUNK) {
          const chunk = payload.slice(off, off + CHUNK);
          try {
            await this.rxChar.writeValueWithResponse(chunk);
          } catch (e) {
            // fallback per stack che accettano solo write without response
            await this.rxChar.writeValueWithoutResponse(chunk);
          }
          await new Promise(r => setTimeout(r, 20));
        }
      }).catch(err => console.warn('BLE write fallita:', err));
      return this.writeQueue;
    }

    // ---------- Comandi di comodo ----------
    requestHello() { return this.send('HELLO'); }
    sendTime() { return this.send('TIME|' + Math.floor(Date.now() / 1000)); }
    sendRegister(uid, name) { return this.send('REGISTER|' + uid + '|' + name); }
    requestStatus() { return this.send('STATUS'); }
    requestSync(sinceTs) { return this.send('SYNC|' + (sinceTs || 0)); }
    pairIqos() { return this.send('PAIR_IQOS'); }
    resetIqos() { return this.send('RESET_IQOS'); }
    resetEvents() { return this.send('RESET_EVENTS'); }
    resetAll() { return this.send('RESET_ALL'); }
    setPoll(seconds) { return this.send('SET_POLL|' + seconds); }
    pollNow() { return this.send('POLL_NOW'); }
  }

  // ---------- Parser dei messaggi del firmware ----------
  function parseKv(line) {
    // "STATUS|battery=85|odometer=123" -> {type:'STATUS', kv:{...}, raw}
    const parts = line.split('|');
    const out = { type: parts[0], kv: {}, list: parts.slice(1), raw: line };
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq > 0) out.kv[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
    }
    return out;
  }

  global.TrackCaseBle = TrackCaseBle;
  global.BleProtocol = { parseKv, SERVICE_UUID };
})(window);
