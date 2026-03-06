// dashboard.js - versione robusta e funzionante
// - parsing timestamp robusto (epoch sec/ms, ISO w/o TZ -> UTC)
// - storico richiesto in epoch UTC
// - segment callback per evitare wrap-around (gap > 5min)
// - zoom wheel "on-focus" e sensibilità ridotta
// - gestione MQTT resiliente: usa credenziali globali se presenti, altrimenti chiede all'utente;
//   su "Not authorized" prova automaticamente un broker pubblico di test come fallback
// - log DEBUG dettagliati e helper di simulazione window.__simulateLive()
// NOTE: assicurati che mqtt.min.js sia incluso PRIMA di questo file nell'HTML

(function () {
  'use strict';

  // ---------- Config / Helpers ----------
  Chart.defaults.locale = 'it-IT';

  const fmtTime24 = new Intl.DateTimeFormat('it-IT', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const fmtTimeOnly24 = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });

  function safeGetEl(id) { try { return document.getElementById(id) || null; } catch (e) { return null; } }

  function logDebug(...args) { try { console.log('DEBUG:', ...args); } catch (e) {} }
  function logWarn(...args) { try { console.warn('WARN:', ...args); } catch (e) {} }
  function logErr(...args) { try { console.error('ERROR:', ...args); } catch (e) {} }

  // ---------- Gauges ----------
  function createGauge(ctx, color) {
    if (!ctx) return null;
    try {
      return new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Valore', 'Restante'], datasets: [{ data: [0, 100], backgroundColor: [color, '#333'], borderWidth: 0 }] },
        options: { cutout: '70%', animation: { duration: 200 }, plugins: { legend: { display: false } } }
      });
    } catch (e) {
      logWarn('createGauge failed', e);
      return null;
    }
  }

  const sensorColors = { temp: '#29b6f6', hum: '#fdd835', press: '#66bb6a', co2: '#ff5252', tvoc: '#ffa726', pm25: '#ab47bc' };
  const GAP_THRESHOLD_MS = 1000 * 60 * 5; // 5 minutes
  const MAX_POINTS = 300;

  let g_co2, g_tvoc, g_pm25, g_aiq, g_temp, g_hum, g_press;
  let historyData = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
  let historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };

  // ---------- Timestamp parsing ----------
  function parseTimestampToDate(t) {
    if (typeof t === 'number') {
      if (t > 1e12) return new Date(t);        // ms
      if (t > 1e9) return new Date(t * 1000);  // seconds -> ms
      return new Date(t * 1000);
    }
    if (typeof t === 'string') {
      if (/^\d+$/.test(t)) return parseTimestampToDate(Number(t));
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) return new Date(t + 'Z'); // treat as UTC
      const d = new Date(t);
      if (!isNaN(d.getTime())) return d;
      return new Date(t.replace(' ', 'T'));
    }
    return null;
  }

  // ---------- Segment callback to hide long gaps ----------
  function segmentHideIfGap(ctx) {
    if (!ctx || !ctx.dataset) return ctx && ctx.dataset ? ctx.dataset.borderColor || 'rgba(0,0,0,0)' : 'rgba(0,0,0,0)';
    if (!ctx.p0 || !ctx.p1) return ctx.dataset.borderColor || 'rgba(0,0,0,0)';
    const t0 = (ctx.p0.parsed && ctx.p0.parsed.x) ? new Date(ctx.p0.parsed.x).getTime() : NaN;
    const t1 = (ctx.p1.parsed && ctx.p1.parsed.x) ? new Date(ctx.p1.parsed.x).getTime() : NaN;
    if (isNaN(t0) || isNaN(t1)) return ctx.dataset.borderColor || 'rgba(0,0,0,0)';
    return (Math.abs(t1 - t0) > GAP_THRESHOLD_MS) ? 'rgba(0,0,0,0)' : (ctx.dataset.borderColor || 'rgba(0,0,0,0)');
  }

  // ---------- Chart creation ----------
  let chart_history = null;
  let chart_history_custom = null;

  function buildCharts() {
    const chLive = safeGetEl('chart_history');
    const chHist = safeGetEl('chart_history_custom');

    try {
      chart_history = new Chart(chLive, {
        type: 'line',
        data: {
          datasets: [
            { label: 'temp', borderColor: sensorColors.temp, data: [], tension: 0.3, hidden: false, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'hum', borderColor: sensorColors.hum, data: [], tension: 0.3, hidden: false, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'press', borderColor: sensorColors.press, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'co2', borderColor: sensorColors.co2, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'tvoc', borderColor: sensorColors.tvoc, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'pm25', borderColor: sensorColors.pm25, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } }
          ]
        },
        options: {
          animation: { duration: 150 },
          scales: {
            x: {
              type: 'time',
              time: { tooltipFormat: 'yyyy-MM-dd HH:mm:ss', displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm', hour: 'HH:mm' } },
              ticks: { color: '#aaa', callback: function (value) { try { const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value)); return fmtTimeOnly24.format(t); } catch (e) { return value; } } }
            },
            y: { ticks: { color: '#aaa' } }
          },
          plugins: {
            tooltip: {
              callbacks: {
                title: (items) => { const raw = items[0].parsed.x; const dt = raw instanceof Date ? raw : new Date(raw); return fmtTime24.format(dt); },
                label: (item) => item.dataset.label.toUpperCase() + ': ' + item.formattedValue
              }
            },
            zoom: commonZoomOptions,
            legend: { onClick: () => { } }
          }
        }
      });

      if (chart_history && chart_history.canvas) {
        chart_history.canvas.addEventListener('mouseenter', () => { chart_history.options.plugins.zoom.zoom.wheel.enabled = true; });
        chart_history.canvas.addEventListener('mouseleave', () => { chart_history.options.plugins.zoom.zoom.wheel.enabled = false; });
      }
    } catch (e) {
      logWarn('buildCharts live failed', e);
    }

    try {
      chart_history_custom = new Chart(chHist, {
        type: 'line',
        data: {
          datasets: [
            { label: 'temp', borderColor: sensorColors.temp, data: [], tension: 0.3, hidden: false, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'hum', borderColor: sensorColors.hum, data: [], tension: 0.3, hidden: false, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'press', borderColor: sensorColors.press, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'co2', borderColor: sensorColors.co2, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'tvoc', borderColor: sensorColors.tvoc, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } },
            { label: 'pm25', borderColor: sensorColors.pm25, data: [], tension: 0.3, hidden: true, spanGaps: false, segment: { borderColor: segmentHideIfGap } }
          ]
        },
        options: {
          animation: { duration: 0 },
          scales: {
            x: {
              type: 'time',
              time: { unit: 'minute', tooltipFormat: 'yyyy-MM-dd HH:mm:ss', displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } },
              ticks: { color: '#aaa', callback: function (value) { try { const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value)); return fmtTimeOnly24.format(t); } catch (e) { return value; } } }
            },
            y: { ticks: { color: '#aaa' } }
          },
          plugins: {
            tooltip: {
              callbacks: {
                title: (items) => { const raw = items[0].parsed.x; const dt = raw instanceof Date ? raw : new Date(raw); return fmtTime24.format(dt); },
                label: (item) => item.dataset.label.toUpperCase() + ': ' + item.formattedValue
              }
            },
            zoom: commonZoomOptions,
            legend: { onClick: () => { } }
          }
        }
      });

      if (chart_history_custom && chart_history_custom.canvas) {
        chart_history_custom.canvas.addEventListener('mouseenter', () => { chart_history_custom.options.plugins.zoom.zoom.wheel.enabled = true; });
        chart_history_custom.canvas.addEventListener('mouseleave', () => { chart_history_custom.options.plugins.zoom.zoom.wheel.enabled = false; });
      }
    } catch (e) {
      logWarn('buildCharts history failed', e);
    }

    try { updateZoomLimitsForChart(chart_history, 6); updateZoomLimitsForChart(chart_history_custom, 6); } catch (e) { }
  }

  document.addEventListener('DOMContentLoaded', buildCharts);

  // ---------- Y axis helpers ----------
  function updateYAxisRange() {
    try {
      const selected = [...document.querySelectorAll('.sensorCheck:checked')].map(c => c.value);
      if (selected.length === 0) { delete chart_history.options.scales.y.min; delete chart_history.options.scales.y.max; chart_history.update('none'); return; }
      let allValues = [];
      chart_history.data.datasets.forEach(ds => {
        if (!selected.includes(ds.label)) return;
        ds.data.forEach(pt => { const v = (pt && typeof pt === 'object') ? pt.y : pt; if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v)); });
      });
      if (allValues.length === 0) { delete chart_history.options.scales.y.min; delete chart_history.options.scales.y.max; chart_history.update('none'); return; }
      let min = Math.min(...allValues), max = Math.max(...allValues);
      const range = Math.max((max - min), Math.abs(max) * 0.05, 1), pad = range * 0.06;
      chart_history.options.scales.y.min = Math.max(min - pad, 0);
      chart_history.options.scales.y.max = max + pad;
      chart_history.update('none');
    } catch (e) { logWarn('updateYAxisRange failed', e); }
  }

  function updateYAxisRangeHistory() {
    try {
      const selected = [...document.querySelectorAll('.histCheck:checked')].map(c => c.value);
      if (selected.length === 0) { delete chart_history_custom.options.scales.y.min; delete chart_history_custom.options.scales.y.max; chart_history_custom.update('none'); return; }
      let allValues = [];
      chart_history_custom.data.datasets.forEach(ds => {
        if (!selected.includes(ds.label)) return;
        ds.data.forEach(pt => { const v = (pt && typeof pt === 'object') ? pt.y : pt; if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v)); });
      });
      if (allValues.length === 0) { delete chart_history_custom.options.scales.y.min; delete chart_history_custom.options.scales.y.max; chart_history_custom.update('none'); return; }
      let min = Math.min(...allValues), max = Math.max(...allValues);
      const range = Math.max((max - min), Math.abs(max) * 0.05, 1), pad = range * 0.06;
      chart_history_custom.options.scales.y.min = Math.max(min - pad, 0);
      chart_history_custom.options.scales.y.max = max + pad;
      chart_history_custom.update('none');
    } catch (e) { logWarn('updateYAxisRangeHistory failed', e); }
  }

  // ---------- MQTT connection logic (resilient) ----------
  // Behavior:
  // 1) Try to use global MQTT_USERNAME / MQTT_PASSWORD if defined before this script.
  // 2) If not defined, prompt the user once (browser prompt).
  // 3) If connection fails with "Not authorized", try a public test broker (no auth) as fallback.
  // 4) Provide clear DEBUG logs.

  let mqttClient = null;
  let __startAttempts = 0;
  let __triedFallbackBroker = false;
  const PRIMARY_BROKER = 'wss://02164e543aa54cedb0d1c41246e8c43b.s1.eu.hivemq.cloud:8884/mqtt';
  const FALLBACK_BROKER = 'wss://test.mosquitto.org:8081/mqtt'; // public test broker (no auth)

  function getCredentialsOrPrompt() {
    // Prefer global constants if defined
    try {
      if (typeof MQTT_USERNAME !== 'undefined' && typeof MQTT_PASSWORD !== 'undefined' && MQTT_USERNAME && MQTT_PASSWORD) {
        logDebug('Using MQTT_USERNAME/MQTT_PASSWORD from global scope (not printed)');
        return { username: MQTT_USERNAME, password: MQTT_PASSWORD };
      }
    } catch (e) { /* ignore */ }

    // Prompt user once for credentials
    try {
      const u = window.prompt('Inserisci MQTT username (lascia vuoto per usare broker pubblico di test):', '');
      if (!u) return null;
      const p = window.prompt('Inserisci MQTT password:', '');
      if (p === null) return null;
      return { username: u, password: p };
    } catch (e) {
      return null;
    }
  }

  function startMQTTWithOptions(brokerUrl, creds) {
    if (typeof mqtt === 'undefined') {
      logWarn('mqtt library not present');
      return null;
    }
    try {
      const opts = { clean: true, reconnectPeriod: 2000 };
      if (creds && creds.username) { opts.username = creds.username; opts.password = creds.password; }
      logDebug('Attempting connect to', brokerUrl, 'withAuth=', !!(creds && creds.username));
      const client = mqtt.connect(brokerUrl, opts);
      client.on('connect', (connack) => {
        logDebug('mqtt connected', brokerUrl, connack);
        updateWSStatus(true);
        // subscribe with callbacks
        client.subscribe('esp32/live', (err, granted) => logDebug('subscribe esp32/live', err, granted));
        client.subscribe('esp32/history_chunk', (err, granted) => logDebug('subscribe esp32/history_chunk', err, granted));
        client.subscribe('esp32/relay_state', (err, granted) => logDebug('subscribe esp32/relay_state', err, granted));
      });
      client.on('reconnect', () => logDebug('mqtt reconnecting'));
      client.on('close', () => { logDebug('mqtt closed'); updateWSStatus(false); });
      client.on('offline', () => logDebug('mqtt offline'));
      client.on('error', (err) => {
        logErr('mqtt error', err && err.message ? err.message : err);
        // If Not authorized, try fallback once
        const msg = err && err.message ? err.message.toLowerCase() : '';
        if (msg.includes('not authorized') || msg.includes('not authorized') || msg.includes('connack')) {
          logWarn('Broker refused credentials (Not authorized). Will attempt fallback if available.');
          client.end(true);
          if (!__triedFallbackBroker) {
            __triedFallbackBroker = true;
            setTimeout(() => tryStartMQTT(true), 500);
          }
        }
      });
      client.on('message', (topic, message) => {
        try {
          const payload = message.toString();
          logDebug('mqtt message', topic, payload.slice(0, 200));
          const d = JSON.parse(payload);
          handleIncomingMessage(topic, d);
        } catch (e) {
          logWarn('Failed to parse mqtt message', e);
        }
      });
      return client;
    } catch (e) {
      logErr('startMQTTWithOptions threw', e);
      return null;
    }
  }

  function tryStartMQTT(forceFallback) {
    __startAttempts++;
    logDebug('__tryStartMQTT attempt', __startAttempts, 'forceFallback=', !!forceFallback);
    if (typeof mqtt === 'undefined') {
      logWarn('mqtt lib not loaded yet; retry in 2s');
      if (__startAttempts < 12) setTimeout(() => tryStartMQTT(forceFallback), 2000);
      return;
    }

    // If forceFallback true, connect to public test broker without auth
    if (forceFallback) {
      logDebug('Trying fallback public broker (no auth):', FALLBACK_BROKER);
      mqttClient = startMQTTWithOptions(FALLBACK_BROKER, null);
      return;
    }

    // Normal flow: try primary broker with credentials (global or prompt)
    const creds = getCredentialsOrPrompt();
    if (!creds) {
      // No creds provided -> try fallback public broker
      logDebug('No credentials provided; trying fallback public broker');
      __triedFallbackBroker = true;
      mqttClient = startMQTTWithOptions(FALLBACK_BROKER, null);
      return;
    }

    mqttClient = startMQTTWithOptions(PRIMARY_BROKER, creds);
    // If connection fails with Not authorized, error handler will trigger fallback
  }

  // Start after DOM ready
  document.addEventListener('DOMContentLoaded', () => tryStartMQTT(false));

  // ---------- Incoming message handler ----------
  function handleIncomingMessage(topic, d) {
    if (!d) return;
    if (topic === 'esp32/live') {
      // Update DOM safely
      ['co2', 'tvoc', 'pm25', 'aiq', 'temp', 'hum', 'press'].forEach(k => {
        const el = safeGetEl(k);
        if (el && d[k] !== undefined) el.innerText = d[k];
      });

      // Update gauges safely
      try { if (g_co2) g_co2.data.datasets[0].data = [d.co2 / 20, 100 - (d.co2 / 20)]; } catch (e) { }
      try { if (g_tvoc) g_tvoc.data.datasets[0].data = [d.tvoc / 10, 100 - (d.tvoc / 10)]; } catch (e) { }
      try { if (g_pm25) g_pm25.data.datasets[0].data = [d.pm25, 100 - d.pm25]; } catch (e) { }
      try {
        if (g_aiq) {
          g_aiq.data.datasets[0].backgroundColor[0] = aiqColor(d.aiq);
          g_aiq.data.datasets[0].data = [Math.min(d.aiq, 500) / 5, 100 - Math.min(d.aiq, 500) / 5];
        }
      } catch (e) { }

      [g_co2, g_tvoc, g_pm25, g_aiq, g_temp, g_hum, g_press].forEach(g => { try { g && g.update(); } catch (e) { } });

      // Push live points
      const now = new Date();
      ['temp', 'hum', 'press', 'co2', 'tvoc', 'pm25'].forEach(label => {
        const ds = chart_history && chart_history.data.datasets.find(s => s.label === label);
        if (!ds) return;
        ds.data.push({ x: now, y: d[label] });
        if (ds.data.length > MAX_POINTS) ds.data.shift();
      });

      // Keep historyData arrays
      historyData.labels.push(now);
      historyData.temp.push(d.temp);
      historyData.hum.push(d.hum);
      historyData.press.push(d.press);
      historyData.co2.push(d.co2);
      historyData.tvoc.push(d.tvoc);
      historyData.pm25.push(d.pm25);
      if (historyData.labels.length > MAX_POINTS) Object.keys(historyData).forEach(k => historyData[k].shift());

      updateYAxisRange();
      updateZoomLimitsForChart(chart_history, 6);
      clampViewToDataIfNeeded(chart_history, 6);
      try { chart_history.update('none'); } catch (e) { }
      return;
    }

    if (topic === 'esp32/history_chunk') {
      handleHistoryPacket(d);
      if (!d.done) {
        const ack = { chunkId: d.chunkId || 0 };
        try { mqttClient && mqttClient.publish('esp32/history/ack', JSON.stringify(ack)); } catch (e) { }
      } else {
        updateZoomLimitsForChart(chart_history_custom, 6);
        updateYAxisRangeHistory();
      }
      return;
    }

    if (topic === 'esp32/relay_state') {
      ignoreToggleEvents = true;
      const r1 = safeGetEl('relay1_toggle'), r2 = safeGetEl('relay2_toggle');
      if (r1) r1.checked = !!d.r1;
      if (r2) r2.checked = !!d.r2;
      ignoreToggleEvents = false;
      return;
    }
  }

  // ---------- Relay commands ----------
  function sendRelayCommand(id, state) { if (!mqttClient) return; try { mqttClient.publish(`esp32/cmd/relay${id}`, state ? '1' : '0'); } catch (e) { } }
  safeGetEl('relay1_toggle') && safeGetEl('relay1_toggle').addEventListener('change', (e) => { if (ignoreToggleEvents) return; sendRelayCommand(1, e.target.checked); });
  safeGetEl('relay2_toggle') && safeGetEl('relay2_toggle').addEventListener('change', (e) => { if (ignoreToggleEvents) return; sendRelayCommand(2, e.target.checked); });

  // ---------- History request ----------
  function toEpochSecondsUTC(dtLocalStr) { const d = new Date(dtLocalStr); return Math.floor(d.getTime() / 1000); }
  safeGetEl('btn_load_history') && safeGetEl('btn_load_history').addEventListener('click', () => {
    let from = (safeGetEl('hist_from') && safeGetEl('hist_from').value) || '';
    let to = (safeGetEl('hist_to') && safeGetEl('hist_to').value) || '';
    let sensors = [...document.querySelectorAll('.histCheck:checked')].map(c => c.value);
    if (!from || !to || sensors.length === 0) { alert('Seleziona almeno un sensore e un intervallo valido'); return; }

    historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
    try { chart_history_custom.data.datasets.forEach(ds => ds.data = []); chart_history_custom.data.labels = []; chart_history_custom.update(); } catch (e) { }

    const req = { type: 'get_history', from: toEpochSecondsUTC(from), to: toEpochSecondsUTC(to), sensors: sensors };
    if (mqttClient) {
      try { mqttClient.publish('esp32/history/request', JSON.stringify(req)); } catch (e) { alert('Errore invio richiesta storico'); }
    } else {
      alert('MQTT non connesso');
    }
  });

  // ---------- History packet handler ----------
  function handleHistoryPacket(d) {
    if (!d || !d.timestamps) return;
    if (!d.done) {
      const newLabels = (d.timestamps || []).map(t => parseTimestampToDate(t));
      historyCustom.labels.push(...newLabels);
      const keys = ['temp', 'hum', 'press', 'co2', 'tvoc', 'pm25'];
      keys.forEach(key => {
        if (!historyCustom[key]) historyCustom[key] = [];
        if (d.data && d.data[key]) historyCustom[key].push(...d.data[key]);
        else for (let i = 0; i < newLabels.length; i++) historyCustom[key].push(null);
      });
      return;
    }

    const keys = ['temp', 'hum', 'press', 'co2', 'tvoc', 'pm25'];
    keys.forEach(key => { while (historyCustom[key].length < historyCustom.labels.length) historyCustom[key].push(null); });

    try {
      chart_history_custom.data.datasets.forEach(ds => {
        const key = ds.label;
        ds.data = historyCustom.labels.map((t, i) => {
          const v = historyCustom[key][i];
          return v === null ? { x: t, y: null } : { x: t, y: v };
        });
      });
    } catch (e) { logWarn('populate history chart failed', e); }

    updateYAxisRangeHistory();
    updateZoomLimitsForChart(chart_history_custom, 6);

    const bounds = getChartTimeBounds(chart_history_custom);
    if (bounds) {
      try { if (chart_history_custom.resetZoom) chart_history_custom.resetZoom(); chart_history_custom.options.scales.x.min = new Date(bounds.min); chart_history_custom.options.scales.x.max = new Date(bounds.max); } catch (e) { }
    }

    try { chart_history_custom.update(); } catch (e) { }
  }

  // ---------- UI helpers ----------
  function updateWSStatus(connected) {
    const el = safeGetEl('ws_status');
    if (!el) return;
    if (connected) { el.textContent = '🟢 Connesso'; el.classList.remove('ws_disconnected'); el.classList.add('ws_connected'); }
    else { el.textContent = '🔴 Disconnesso — riconnessione…'; el.classList.remove('ws_connected'); el.classList.add('ws_disconnected'); }
  }

  // ---------- Zoom helpers ----------
  function getChartTimeBounds(chart) {
    try {
      let min = Infinity, max = -Infinity;
      chart.data.datasets.forEach(ds => {
        ds.data.forEach(pt => {
          const t = (pt && typeof pt === 'object') ? pt.x : pt;
          if (!t) return;
          const ts = (t instanceof Date) ? t.getTime() : new Date(t).getTime();
          if (!isNaN(ts)) { min = Math.min(min, ts); max = Math.max(max, ts); }
        });
      });
      if (min === Infinity) return null;
      return { min, max };
    } catch (e) { return null; }
  }

  function updateZoomLimitsForChart(chart, maxZoomOutFactor = 6) {
    try {
      const bounds = getChartTimeBounds(chart);
      if (!bounds) {
        chart.options.plugins.zoom.zoom.limits.x.maxRange = Number.MAX_SAFE_INTEGER;
        chart.options.plugins.zoom.zoom.limits.x.minRange = 1000 * 10;
        return;
      }
      const dataRange = bounds.max - bounds.min;
      const maxRange = Math.max(dataRange * maxZoomOutFactor, 1000 * 60);
      chart.options.plugins.zoom.zoom.limits.x.maxRange = maxRange;
      chart.options.plugins.zoom.zoom.limits.x.minRange = 1000 * 10;
    } catch (e) { }
  }

  function clampViewToDataIfNeeded(chart, maxZoomOutFactor = 6) {
    try {
      const bounds = getChartTimeBounds(chart);
      if (!bounds) return;
      if (!chart.scales || !chart.scales.x) return;
      const visibleMin = chart.scales.x.min instanceof Date ? chart.scales.x.min.getTime() : new Date(chart.scales.x.min).getTime();
      const visibleMax = chart.scales.x.max instanceof Date ? chart.scales.x.max.getTime() : new Date(chart.scales.x.max).getTime();
      const visibleRange = visibleMax - visibleMin;
      const dataRange = bounds.max - bounds.min;
      const maxAllowed = Math.max(dataRange * maxZoomOutFactor, 1000 * 60);
      if (visibleRange > maxAllowed) {
        chart.options.scales.x.min = new Date(bounds.min);
        chart.options.scales.x.max = new Date(bounds.max);
        chart.update();
      }
    } catch (e) { }
  }

  // ---------- Simulation helper ----------
  window.__simulateLive = function () {
    const sample = { temp: 22.5, hum: 45.2, press: 1012.3, co2: 420, tvoc: 12, pm25: 3, aiq: 42 };
    logDebug('simulate live', sample);
    ['co2', 'tvoc', 'pm25', 'aiq', 'temp', 'hum', 'press'].forEach(k => { const el = safeGetEl(k); if (el) el.innerText = sample[k]; });
    try { if (g_co2) { g_co2.data.datasets[0].data = [sample.co2 / 20, 100 - (sample.co2 / 20)]; g_co2.update(); } } catch (e) { }
    try { if (g_tvoc) { g_tvoc.data.datasets[0].data = [sample.tvoc / 10, 100 - (sample.tvoc / 10)]; g_tvoc.update(); } } catch (e) { }
    try { if (g_pm25) { g_pm25.data.datasets[0].data = [sample.pm25, 100 - sample.pm25]; g_pm25.update(); } } catch (e) { }
    try { if (g_aiq) { g_aiq.data.datasets[0].backgroundColor[0] = aiqColor(sample.aiq); g_aiq.data.datasets[0].data = [Math.min(sample.aiq, 500) / 5, 100 - Math.min(sample.aiq, 500) / 5]; g_aiq.update(); } } catch (e) { }
    const now = new Date();
    ['temp', 'hum', 'press', 'co2', 'tvoc', 'pm25'].forEach(label => {
      const ds = chart_history && chart_history.data.datasets.find(s => s.label === label);
      if (!ds) return;
      ds.data.push({ x: now, y: sample[label] });
      if (ds.data.length > MAX_POINTS) ds.data.shift();
    });
    updateYAxisRange(); updateZoomLimitsForChart(chart_history, 6); try { chart_history.update('none'); } catch (e) { }
    logDebug('simulation applied');
  };

  // ---------- AIQ color helper ----------
  function aiqColor(v) {
    if (v <= 50) return '#00e676';
    if (v <= 100) return '#cddc39';
    if (v <= 150) return '#ffb300';
    if (v <= 200) return '#ff7043';
    return '#d32f2f';
  }

  // ---------- Initialize gauges (after DOM ready) ----------
  document.addEventListener('DOMContentLoaded', () => {
    try {
      g_co2 = createGauge(safeGetEl('g_co2'), '#ff5252');
      g_tvoc = createGauge(safeGetEl('g_tvoc'), '#ffa726');
      g_pm25 = createGauge(safeGetEl('g_pm25'), '#ab47bc');
      g_aiq = createGauge(safeGetEl('g_aiq'), '#00e676');
      g_temp = createGauge(safeGetEl('g_temp'), '#29b6f6');
      g_hum = createGauge(safeGetEl('g_hum'), '#fdd835');
      g_press = createGauge(safeGetEl('g_press'), '#66bb6a');
    } catch (e) { logWarn('init gauges failed', e); }
  });

  // ---------- Expose some internals for debugging in console ----------
  window.__dashboard_debug = {
    tryStartMQTT: tryStartMQTT,
    getClient: () => mqttClient,
    simulate: window.__simulateLive
  };

})();
