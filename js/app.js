/* ============================================================
   TrackCase WebApp — Logica applicativa
   Stesse schermate dell'app Flutter (Home, Statistiche, Diario,
   Impostazioni) senza la "spalmatura": i timestamp arrivano
   dall'ESP32 precisi al secondo/minuto.
   ============================================================ */
(function () {
  'use strict';

  const ble = new TrackCaseBle();
  const $ = (id) => document.getElementById(id);

  // Stato UI
  let activeDeviceId = null;
  let diaryDate = new Date();
  let helloResolve = null;
  let iqosMacResolve = null;
  let ownerResolve = null;
  let ownerWarned = false;
  let syncing = false;

  // ============ UTILITY ============
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms || 3000);
  }

  function fmtTime(ts) {
    const d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function user() { return Store.getCurrentUser(); }

  function todayTotal() {
    return Store.getSessionsForDate(user().id, new Date(), activeDeviceId).length;
  }

  // ============ BOOT ============
  document.addEventListener('DOMContentLoaded', () => {
    Icons.mount(document);
    bindLogin();
    bindMain();
    if (user()) showMain();
    else showLogin();
  });

  // ============ LOGIN ============
  function showLogin() {
    $('mainView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    renderProfileList();
  }

  function renderProfileList() {
    const list = $('profileList');
    list.innerHTML = '';
    for (const u of Store.getUsers()) {
      const devCount = Object.keys(u.devices || {}).length;
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML =
        '<div class="profile-avatar">' + (u.name[0] || '?').toUpperCase() + '</div>' +
        '<div><div class="profile-name">' + escapeHtml(u.name) + '</div>' +
        '<div class="profile-meta">' + devCount + ' dispositiv' + (devCount === 1 ? 'o' : 'i') +
        ' · ' + Store.totalSessionCount(u.id) + ' TEREA tracciate</div></div>';
      card.onclick = () => { Store.selectUser(u.id); showMain(); };
      list.appendChild(card);
    }
  }

  function bindLogin() {
    $('btnNewProfile').onclick = () => $('newProfileForm').classList.toggle('hidden');
    $('btnCreateProfile').onclick = () => {
      const name = $('inputName').value.trim();
      const budget = parseInt($('inputBudget').value, 10) || 20;
      const model = $('inputModel').value;
      if (!name) { toast('Inserisci il tuo nome'); return; }
      Store.createUser(name, budget, model);
      toast('Benvenuto, ' + name + '!');
      showMain();
    };
  }

  // ============ MAIN ============
  function showMain() {
    $('loginView').classList.add('hidden');
    $('mainView').classList.remove('hidden');
    const u = user();
    activeDeviceId = u.activeDeviceId && u.devices[u.activeDeviceId]
      ? u.activeDeviceId
      : (Object.keys(u.devices)[0] || null);
    renderAll();
  }

  function bindMain() {
    // Navigazione tab
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.onclick = () => activateTab(btn.dataset.tab);
    });

    // Deep-link: #tab-stats, #tab-diary, #tab-settings
    const h = location.hash.replace('#', '');
    if (['tab-home', 'tab-stats', 'tab-diary', 'tab-settings'].includes(h)) {
      activateTab(h);
    }

    // Home
    $('btnSync').onclick = onSyncPressed;

    // Diario
    $('diaryPrev').onclick = () => moveDiary(-1);
    $('diaryNext').onclick = () => moveDiary(1);

    // Impostazioni
    $('budgetMinus').onclick = () => changeBudget(-1);
    $('budgetPlus').onclick = () => changeBudget(1);
    $('pollSelect').onchange = onPollChange;
    $('rowEditName').onclick = editName;
    $('rowEditModel').onclick = editModel;
    $('btnAddDevice').onclick = () => onSyncPressed(); // stesso flusso: collega un ESP32
    $('rowPairIqos').onclick = pairIqos;
    $('rowUnpairIqos').onclick = unpairIqos;
    $('rowClearEvents').onclick = clearEspEvents;
    $('rowClearLocal').onclick = clearLocalHistory;
    $('rowSwitchUser').onclick = () => { if (ble.connected) ble.disconnect(); showLogin(); };

    // BLE callbacks
    ble.onMessage = onBleMessage;
    ble.onConnectionChange = (connected) => {
      syncing = false;
      if (connected) ownerWarned = false;
      renderConnState();
      renderHome();
      if (!connected) toast('TrackCase disconnesso');
    };

    // Ridisegna i grafici su resize/orientamento (larghezza canvas)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { renderStats(); renderDiary(); }, 150);
    });
  }

  function activateTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('hidden', p.id !== tabId));
    renderAll();
    // Re-render dei grafici dopo che il layout si è stabilizzato:
    // un canvas misurato mentre la tab era nascosta resterebbe bianco.
    setTimeout(() => { renderStats(); renderDiary(); }, 120);
  }

  function renderAll() {
    renderConnState();
    renderDeviceSelector();
    renderHome();
    renderStats();
    renderDiary();
    renderSettings();
  }

  // ============ RENDER: HOME ============
  function renderConnState() {
    const dot = $('connDot');
    const txt = $('connText');
    const dev = user() && activeDeviceId ? user().devices[activeDeviceId] : null;
    dot.classList.toggle('online', ble.connected);
    if (ble.connected) {
      txt.textContent = (dev && dev.stateDesc) || 'Connesso';
    } else {
      txt.textContent = dev ? 'Ultimo stato: ' + (dev.stateDesc || '—') : 'Disconnesso';
    }
  }

  function renderDeviceSelector() {
    const wrap = $('deviceSelector');
    const devices = Store.getDevices(user().id);
    if (devices.length <= 1) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = '';
    for (const d of devices) {
      const chip = document.createElement('button');
      chip.className = 'device-chip' + (d.id === activeDeviceId ? ' active' : '');
      chip.textContent = d.name + ' (' + d.id.slice(-5) + ')';
      chip.onclick = () => {
        activeDeviceId = d.id;
        Store.updateUser(user().id, { activeDeviceId: d.id });
        renderAll();
      };
      wrap.appendChild(chip);
    }
  }

  function renderHome() {
    const u = user();
    $('greeting').textContent = 'Ciao, ' + (u.name || 'Utente');

    const used = todayTotal();
    const budget = u.budget;
    const progress = budget > 0 ? Math.min(used / budget, 2) : 0;
    const remaining = Math.max(budget - used, 0);

    Charts.renderRing($('homeRing'), progress, 220, 22, used + ' / ' + budget, 'SESSIONI OGGI');
    Charts.renderRing($('homeRingMini'), progress, 45, 5, String(remaining), '');

    const dev = activeDeviceId ? u.devices[activeDeviceId] : null;
    $('pillBattery').textContent = dev && dev.battery ? dev.battery + '%' : '--%';
    $('pillVoltage').textContent = dev && dev.voltage ? Number(dev.voltage).toFixed(2) + ' V' : '-- V';
    $('pillTime').textContent = dev && dev.lastSeen ? fmtTime(dev.lastSeen) : '--:--';

    const btn = $('btnSync');
    btn.classList.toggle('syncing', syncing);
    if (syncing) btn.textContent = 'Sincronizzazione...';
    else if (ble.connected) btn.textContent = 'Sincronizza Dispositivo';
    else btn.textContent = devices_count() > 0 ? 'Collega TrackCase' : 'Registra il tuo TrackCase';
  }

  function devices_count() { return Store.getDevices(user().id).length; }

  // ============ RENDER: STATISTICHE ============
  function renderStats() {
    const u = user();
    const totals = Store.getLastSevenDaysTotals(u.id, activeDeviceId);
    const avg = totals.reduce((a, b) => a + b, 0) / 7;
    const streak = Store.getBestStreak(u.id, u.budget, activeDeviceId);

    $('statWeeklyAvg').textContent = avg.toFixed(1);
    $('statBestStreak').textContent = streak + ' gg';
    $('chartBudgetLabel').textContent = 'Budget: ' + u.budget;
    Charts.renderWeeklyChart($('weeklyChart'), totals, u.budget);

    const dev = activeDeviceId ? u.devices[activeDeviceId] : null;
    const lifetime = dev && dev.lifetime ? dev.lifetime : 0;
    $('odometerCard').classList.toggle('hidden', lifetime <= 0);
    $('statLifetime').textContent = String(lifetime);

    // Impatto calcolato solo sul totale vita del dispositivo
    $('statMoney').textContent = (lifetime * 0.275).toFixed(2) + ' €';
    const mins = lifetime * 5;
    $('statTime').textContent = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
  }

  // ============ RENDER: DIARIO ============
  function moveDiary(delta) {
    const d = new Date(diaryDate);
    d.setDate(d.getDate() + delta);
    const today = new Date();
    const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (d > endToday) return; // niente futuro
    diaryDate = d;
    renderDiary();
  }

  function renderDiary() {
    const u = user();
    const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const now = new Date();
    const isToday = diaryDate.toDateString() === now.toDateString();
    $('diaryDateLabel').textContent =
      (isToday ? 'Oggi' : giorni[diaryDate.getDay()]) + ' ' + diaryDate.getDate() + ' ' +
      mesi[diaryDate.getMonth()] + ' ' + diaryDate.getFullYear();

    // Week strip (settimana del giorno selezionato)
    const strip = $('weekStrip');
    strip.innerHTML = '';
    const labels = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
    const dow = (diaryDate.getDay() + 6) % 7; // 0=Lun
    const monday = new Date(diaryDate);
    monday.setDate(diaryDate.getDate() - dow);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const count = Store.getSessionsForDate(u.id, d, activeDeviceId).length;
      const prog = u.budget > 0 ? Math.min(count / u.budget, 2) : 0;
      const cell = document.createElement('div');
      cell.className = 'week-day' + (d.toDateString() === diaryDate.toDateString() ? ' selected' : '');
      const lbl = document.createElement('div');
      lbl.className = 'week-day-label';
      lbl.textContent = labels[i];
      const ring = document.createElement('div');
      cell.appendChild(lbl);
      cell.appendChild(ring);
      cell.onclick = () => {
        if (d <= now) { diaryDate = d; renderDiary(); }
      };
      strip.appendChild(cell);
      Charts.renderRing(ring, prog, 30, 4, '', '');
    }

    // Anello del giorno
    const sessions = Store.getSessionsForDate(u.id, diaryDate, activeDeviceId);
    const progress = u.budget > 0 ? Math.min(sessions.length / u.budget, 2) : 0;
    Charts.renderRing($('diaryRing'), progress, 200, 22, sessions.length + ' / ' + u.budget, 'SESSIONI');

    // Timeline 24h
    Charts.renderTimeline($('timelineChart'), sessions.map(ts => new Date(ts * 1000)));

    // Lista sessioni
    const list = $('sessionList');
    list.innerHTML = '';
    if (sessions.length === 0) {
      list.innerHTML = '<div class="session-item"><span class="session-origin">Nessuna TEREA registrata in questo giorno</span></div>';
    } else {
      sessions.forEach((ts, i) => {
        const item = document.createElement('div');
        item.className = 'session-item';
        item.innerHTML = '<span class="session-name">' + Icons.get('cigarette', 15) +
          ' TEREA #' + (i + 1) + '</span><span class="session-time">' + fmtTime(ts) + '</span>';
        list.appendChild(item);
      });
    }
  }

  // ============ RENDER: IMPOSTAZIONI ============
  function renderSettings() {
    const u = user();
    $('budgetValue').textContent = String(u.budget);
    $('settingsUserName').textContent = u.name;
    const modelNames = {
      IlumaDiego: 'ILUMA Prime Breeze Blue', IlumaMid: 'ILUMA Standard',
      IlumaOne: 'ILUMA One', IlumaPrime: 'ILUMA Prime'
    };
    $('settingsModel').textContent = modelNames[u.model] || u.model;

    const dev = activeDeviceId ? u.devices[activeDeviceId] : null;
    $('settingsIqosMac').textContent = dev && dev.iqosMac ? dev.iqosMac : 'Nessun IQOS associato';
    if (dev && dev.pollSec) $('pollSelect').value = String(dev.pollSec);

    // Lista dispositivi
    const wrap = $('deviceList');
    wrap.innerHTML = '';
    const devices = Store.getDevices(u.id);
    if (devices.length === 0) {
      wrap.innerHTML = '<div class="device-item"><div class="device-item-info"><div class="device-item-meta">Nessun dispositivo registrato. Collega il tuo primo TrackCase!</div></div></div>';
    }
    for (const d of devices) {
      const item = document.createElement('div');
      item.className = 'device-item' + (d.id === activeDeviceId ? ' active' : '');
      item.innerHTML =
        '<div class="device-item-info">' +
        '<div class="device-item-name">' + escapeHtml(d.name) + '</div>' +
        '<div class="device-item-meta">' + d.id + ' · ' + (Store.getSessions(u.id, d.id).length) + ' TEREA · IQOS: ' + (d.iqosMac || '—') + '</div>' +
        '</div>';
      const sel = document.createElement('button');
      sel.className = 'icon-btn' + (d.id === activeDeviceId ? ' accent' : '');
      sel.innerHTML = Icons.get('check', 16);
      sel.title = 'Attiva';
      sel.onclick = () => {
        activeDeviceId = d.id;
        Store.updateUser(u.id, { activeDeviceId: d.id });
        renderAll();
      };
      const del = document.createElement('button');
      del.className = 'device-remove';
      del.innerHTML = Icons.get('trash', 16);
      del.onclick = () => {
        if (confirm('Rimuovere il dispositivo ' + d.name + ' e il suo storico locale?')) {
          Store.removeDevice(u.id, d.id);
          if (activeDeviceId === d.id) activeDeviceId = Object.keys(user().devices)[0] || null;
          renderAll();
          toast('Dispositivo rimosso');
        }
      };
      item.appendChild(sel);
      item.appendChild(del);
      wrap.appendChild(item);
    }
  }

  function changeBudget(delta) {
    const u = user();
    const next = Math.min(100, Math.max(1, u.budget + delta));
    Store.updateUser(u.id, { budget: next });
    renderAll();
  }

  function editName() {
    const u = user();
    const name = prompt('Come ti chiami?', u.name);
    if (name && name.trim()) {
      Store.updateUser(u.id, { name: name.trim() });
      renderAll();
    }
  }

  function editModel() {
    const u = user();
    const choice = prompt('Modello IQOS (IlumaPrime / IlumaMid / IlumaOne / IlumaDiego):', u.model);
    if (choice && ['IlumaPrime', 'IlumaMid', 'IlumaOne', 'IlumaDiego'].includes(choice.trim())) {
      Store.updateUser(u.id, { model: choice.trim() });
      renderAll();
    } else if (choice) {
      toast('Modello non valido');
    }
  }

  function onPollChange() {
    const sec = parseInt($('pollSelect').value, 10);
    if (activeDeviceId) Store.updateDevice(user().id, activeDeviceId, { pollSec: sec });
    if (ble.connected) {
      ble.setPoll(sec).then(() => toast('Intervallo poll impostato: ' + sec + ' s'));
    } else {
      toast('Verrà applicato alla prossima connessione');
    }
  }

  // ============ BLE: SYNC FLOW ============
  async function onSyncPressed() {
    if (syncing) return;
    syncing = true;
    renderHome();
    $('syncHint').textContent = '';

    try {
      if (!ble.connected) {
        $('syncHint').textContent = 'Cerco il TrackCase... accettalo dal pannello Bluetooth.';
        await ble.connect();
      }

      // Richiedi HELLO con l'ID reale (MAC ESP32): id stabile tra sessioni
      // e browser, niente piu' dispositivi duplicati.
      const helloId = await waitHello(4000);
      const deviceId = helloId || ble.device.id;
      const u = user();
      const isNew = !u.devices[deviceId];
      Store.addDevice(u.id, deviceId, 'TrackCase ' + deviceId.slice(-5));
      activeDeviceId = deviceId;
      Store.updateUser(u.id, { activeDeviceId: deviceId });

      // 1. Sincronizza orologio
      await ble.sendTime();

      // 2. Registra l'owner la prima volta. L'ESP32 ha UN SOLO owner:
      // se e' gia' registrato a un altro profilo/browser, chiedi conferma
      // prima di sovrascrivere (altrimenti lo stesso ESP32 finirebbe
      // registrato su due profili senza che l'utente lo sappia).
      if (isNew) {
        const currentOwner = await waitOwner(2500);
        if (currentOwner && currentOwner !== '-' && currentOwner !== u.id) {
          const other = Store.getUsers().find(x => x.id === currentOwner);
          const label = other ? '"' + other.name + '"' : 'un altro profilo o browser';
          if (confirm('Questo TrackCase è già registrato da ' + label +
                      '.\nVuoi trasferirlo al profilo "' + u.name + '"?')) {
            await ble.sendRegister(u.id, u.name);
            toast('TrackCase trasferito a ' + u.name);
          } else {
            toast('Registrazione annullata: il TrackCase resta del profilo precedente');
          }
        } else {
          await ble.sendRegister(u.id, u.name);
          toast('TrackCase registrato!');
        }
      }

      // 3. Applica l'intervallo di poll desiderato
      const dev = user().devices[deviceId];
      if (dev.pollSec) await ble.setPoll(dev.pollSec);

      // 4. Sync eventi + stato
      $('syncHint').textContent = 'Scarico lo storico dall\'ESP32...';
      await ble.requestSync(0); // storico completo: il dedup per timestamp è lato Store
      await ble.requestStatus();
      await ble.pollNow(); // forza una lettura odometro fresca

      $('syncHint').textContent = 'Sincronizzazione completata';
    } catch (e) {
      console.warn(e);
      $('syncHint').textContent = '';
      toast(e.message || 'Connessione fallita');
      syncing = false;
      renderHome();
      return;
    }

    syncing = false;
    renderAll();
  }

  // Richiede attivamente l'HELLO (l'HELLO di onConnect puo' perdersi:
  // parte prima che la WebApp completi startNotifications). Senza l'id
  // reale (MAC ESP32) si creerebbe un dispositivo duplicato con l'id
  // opaco del browser, diverso a ogni sessione.
  function waitHello(timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { helloResolve = null; resolve(null); }, timeoutMs);
      helloResolve = (id) => { clearTimeout(timer); helloResolve = null; resolve(id); };
      ble.requestHello();
    });
  }

  // Chiede uno STATUS e risolve con l'owner registrato sull'ESP32
  // ('-' se nessuno, null se timeout). Usata prima di REGISTER.
  function waitOwner(timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { ownerResolve = null; resolve(null); }, timeoutMs);
      ownerResolve = (owner) => { clearTimeout(timer); ownerResolve = null; resolve(owner); };
      ble.requestStatus();
    });
  }

  // ============ BLE: GESTIONE MESSAGGI ============
  function onBleMessage(line) {
    const msg = BleProtocol.parseKv(line);

    switch (msg.type) {
      case 'HELLO': {
        if (msg.kv.id && helloResolve) helloResolve(msg.kv.id);
        break;
      }
      case 'STATUS': {
        if (ownerResolve) ownerResolve(msg.kv.owner || '-');
        // Avviso passivo (una volta per connessione): questo ESP32 risulta
        // registrato a un profilo diverso da quello attivo nella WebApp.
        if (!ownerWarned && msg.kv.owner && msg.kv.owner !== '-' &&
            user() && msg.kv.owner !== user().id) {
          ownerWarned = true;
          toast('Nota: questo TrackCase è registrato a un altro profilo', 5000);
        }
        if (!activeDeviceId) break;
        Store.updateDevice(user().id, activeDeviceId, {
          battery: parseInt(msg.kv.battery, 10) || 0,
          lifetime: parseInt(msg.kv.odometer, 10) || 0,
          stateDesc: msg.kv.stateDesc || '',
          charging: msg.kv.charging === '1' ? 1 : 0,
          holder: msg.kv.holder === '1' ? 1 : 0,
          voltage: parseFloat(msg.kv.voltage) || 0,
          pollSec: parseInt(msg.kv.poll, 10) || 600,
          iqosMac: msg.kv.iqos && msg.kv.iqos !== '-' ? msg.kv.iqos : null,
          lastSeen: Math.floor(Date.now() / 1000)
        });
        renderConnState();
        renderHome();
        renderStats();
        renderSettings();
        break;
      }
      case 'EVENTS': {
        if (msg.kv.page) {
          const tsList = (msg.list[1] || '').split(',').filter(Boolean).map(Number);
          const added = Store.mergeEvents(user().id, activeDeviceId, tsList);
          if (added > 0) $('syncHint').textContent = 'Ricevuti ' + added + ' nuovi eventi...';
        } else if (msg.kv.total !== undefined) {
          $('syncHint').textContent = 'Storico sincronizzato (' + msg.kv.total + ' eventi)';
          renderHome(); renderStats(); renderDiary();
        }
        break;
      }
      case 'EVENT': {
        // TEREA appena registrata in tempo reale dall'ESP32
        const ts = parseInt(msg.list[0], 10);
        if (ts) {
          Store.mergeEvents(user().id, activeDeviceId, [ts]);
          toast('TEREA registrata alle ' + fmtTime(ts >= Store.MIN_VALID_TS ? ts : Math.floor(Date.now() / 1000)));
          renderHome(); renderStats(); renderDiary();
        }
        break;
      }
      case 'LIVE': {
        if (activeDeviceId) {
          Store.updateDevice(user().id, activeDeviceId, { stateDesc: msg.kv.desc || '' });
          renderConnState();
        }
        break;
      }
      case 'IQOS_MAC': {
        const mac = msg.list[0];
        if (activeDeviceId && mac) {
          Store.updateDevice(user().id, activeDeviceId, { iqosMac: mac });
          renderSettings();
        }
        if (iqosMacResolve) iqosMacResolve(mac);
        toast('IQOS associato: ' + mac);
        break;
      }
      case 'OK': break; // ack silenziosi
      case 'ERR': {
        toast('Errore ESP32: ' + line);
        break;
      }
    }
  }

  // ============ BLE: AZIONI IMPOSTAZIONI ============
  async function pairIqos() {
    if (!ble.connected) { toast('Collega prima il TrackCase dalla Home'); return; }
    toast('Caccia all\'IQOS in corso... tienilo vicino all\'ESP32', 6000);
    await ble.pairIqos();
    const mac = await new Promise((resolve) => {
      iqosMacResolve = resolve;
      setTimeout(() => { iqosMacResolve = null; resolve(null); }, 45000);
    });
    if (!mac) toast('Nessun IQOS trovato entro 45 s. Riprova.');
  }

  async function unpairIqos() {
    if (!ble.connected) { toast('Collega prima il TrackCase dalla Home'); return; }
    if (!confirm('Dissociare l\'IQOS dal TrackCase?')) return;
    await ble.resetIqos();
    if (activeDeviceId) Store.updateDevice(user().id, activeDeviceId, { iqosMac: null });
    renderSettings();
    toast('IQOS dissociato');
  }

  async function clearEspEvents() {
    if (!ble.connected) { toast('Collega prima il TrackCase dalla Home'); return; }
    if (!confirm('Cancellare lo storico eventi sull\'ESP32? (Lo storico nella WebApp resta)')) return;
    await ble.resetEvents();
    toast('Storico ESP32 cancellato');
  }

  function clearLocalHistory() {
    const u = user();
    const n = Store.getSessions(u.id, null).length;
    if (!confirm('Cancellare TUTTO lo storico WebApp di ' + u.name + ' (' + n + ' sessioni)? L\'operazione non è reversibile.')) return;
    Store.clearSessions(u.id, null);
    renderAll();
    toast('Storico WebApp cancellato');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
