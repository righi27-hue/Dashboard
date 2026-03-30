// Forza locale 24h per Chart.js e formatter riutilizzabili
Chart.defaults.locale = 'it-IT';
const fmtTime24 = new Intl.DateTimeFormat('it-IT', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false
});
const fmtTimeOnly24 = new Intl.DateTimeFormat('it-IT', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

// -------------------- Formatter cache e mappe --------------------
const NF_CACHE = {};
function getNumberFormatter(decimals = 1, locale = 'it-IT') {
  const key = `${locale}|${decimals}`;
  if (!NF_CACHE[key]) {
    NF_CACHE[key] = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  return NF_CACHE[key];
}

function formatValue(value, unit = '', decimals = 1, locale = 'it-IT') {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const nf = getNumberFormatter(decimals, locale);
  return `${nf.format(Number(value))}${unit ? ' ' + unit : ''}`;
}

const sensorUnits = {
  temp: '°C', hum: '% RH', press: 'hPa',
  co2: 'ppm', tvoc: 'ppb', pm25: 'µg/m³',
  aiq: '', energy: 'W'
};
const sensorDecimals = {
  temp:1, hum:1, press:1, co2:0, tvoc:0, pm25:1, aiq:0, energy:1
};

// -------------------- GAUGE CREATOR + GLOBALS --------------------
function createGauge(ctx, color) {
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Actual','Remain'],
      datasets: [{
        data:[0,100],
        backgroundColor:[color,'#333'],
        borderWidth:0
      }]
    },
    options: {
      cutout:'70%',
      animation:{duration:120},
      plugins:{
        legend:{display:false},
        tooltip:{
          padding: 16,
          bodyFont: { size: 14 },
          callbacks:{
            label: function(context){
              const label = context.label;
              const value = context.raw;
              return label + ': ' + value.toFixed(1) + '%';
            }
          }
        }
      },
      maintainAspectRatio: false
    }
  });
}

let g_co2, g_tvoc, g_pm25, g_aiq, g_temp, g_hum, g_press;
g_co2  = createGauge(document.getElementById("g_co2"),  "#ff5252");
g_tvoc = createGauge(document.getElementById("g_tvoc"), "#ffa726");
g_pm25 = createGauge(document.getElementById("g_pm25"), "#ab47bc");
g_aiq  = createGauge(document.getElementById("g_aiq"),  "#00e676");
g_temp = createGauge(document.getElementById("g_temp"), "#29b6f6");
g_hum  = createGauge(document.getElementById("g_hum"),  "#fdd835");
g_press= createGauge(document.getElementById("g_press"),"#66bb6a");

const ALL_GAUGES = { co2: g_co2, tvoc: g_tvoc, pm25: g_pm25, aiq: g_aiq, temp: g_temp, hum: g_hum, press: g_press };

let MAX_POINTS = 300;
let historyData = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
let historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };

let sensorColors = { temp:"#29b6f6", hum:"#fdd835", press:"#66bb6a", co2:"#ff5252", tvoc:"#ffa726", pm25:"#ab47bc" };

const sensorRanges = {
  temp:  { min: 0,   max: 50 },
  hum:   { min: 0,   max: 100 },
  press: { min: 870, max: 1084 },
  co2:   { min: 400, max: 2000 },
  tvoc:  { min: 0,   max: 600 },
  pm25:  { min: 0,   max: 150 }
};

function aiqColor(v) {
  if (v <= 50)  return "#00e676";
  if (v <= 100) return "#cddc39";
  if (v <= 150) return "#ffb300";
  if (v <= 200) return "#ff7043";
  return "#d32f2f";
}

// -------------------- Gauge update batching --------------------
// updateGauge can skip immediate chart.update to batch multiple updates
const _gaugeDirty = new Set();
function updateGauge(gaugeChart, metricKey, rawValue, { skipUpdate = false } = {}) {
  const decimals = sensorDecimals[metricKey] !== undefined ? sensorDecimals[metricKey] : 1;
  const range = sensorRanges[metricKey] || { min: 0, max: 100 };
  const min = range.min, max = range.max;
  const pct = (max > min) ? Math.max(0, Math.min(1, (rawValue - min) / (max - min))) : 0;
  const fill = pct * 100;
  gaugeChart.data.datasets[0].data = [fill, 100 - fill];
  if (metricKey === 'aiq') gaugeChart.data.datasets[0].backgroundColor[0] = aiqColor(rawValue);
  const textEl = document.getElementById(`g_${metricKey}_value`);
  if (textEl) textEl.textContent = formatValue(rawValue, sensorUnits[metricKey] || '', decimals, 'it-IT');
  if (!skipUpdate) gaugeChart.update();
  else _gaugeDirty.add(gaugeChart);
}
function flushGaugeUpdates() {
  if (_gaugeDirty.size === 0) return;
  _gaugeDirty.forEach(g => {
    try { g.update(); } catch(e) {}
  });
  _gaugeDirty.clear();
}

// -------------------- ZOOM / PAN COMMON OPTIONS --------------------
const commonZoomOptions = {
  zoom: {
    wheel: { enabled: true, speed: 0.02 },
    pinch: { enabled: true, speed: 0.02 },
    drag: { enabled: false },
    mode: 'x',
    limits: { x: { minRange: 1000 * 10, maxRange: Number.MAX_SAFE_INTEGER } }
  },
  pan: { enabled: true, mode: 'x', threshold: 6 }
};

// -------------------- HELPERS PER ZOOM E BOUNDS --------------------
function getChartTimeBounds(chart) {
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
}
function updateZoomLimitsForChart(chart, maxZoomOutFactor = 6) {
  const bounds = getChartTimeBounds(chart);
  if (!bounds) {
    chart.options.plugins.zoom.zoom.limits.x.maxRange = Number.MAX_SAFE_INTEGER;
    chart.options.plugins.zoom.zoom.limits.x.minRange = 1000 * 10;
    delete chart.options.scales.x.min; delete chart.options.scales.x.max;
    return;
  }
  const dataRange = bounds.max - bounds.min;
  const maxRange = Math.max(dataRange * maxZoomOutFactor, 1000 * 60);
  chart.options.plugins.zoom.zoom.limits.x.maxRange = maxRange;
  chart.options.scales.x.min = new Date(bounds.min);
  chart.options.scales.x.max = new Date(bounds.max);
}
function clampViewToDataIfNeeded(chart, maxZoomOutFactor = 6) {
  const bounds = getChartTimeBounds(chart);
  if (!bounds) return;
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
}

// -------------------- LIVE CHART --------------------
let chart_history = new Chart(document.getElementById("chart_history"), {
  type: 'line',
  data: {
    datasets: [
      { label:"temp",  borderColor:sensorColors.temp,  data:[],  tension:0.3, hidden:false },
      { label:"hum",   borderColor:sensorColors.hum,   data:[],  tension:0.3, hidden:false },
      { label:"press", borderColor:sensorColors.press, data:[],  tension:0.3, hidden:true },
      { label:"co2",   borderColor:sensorColors.co2,   data:[],  tension:0.3, hidden:true },
      { label:"tvoc",  borderColor:sensorColors.tvoc,  data:[],  tension:0.3, hidden:true },
      { label:"pm25",  borderColor:sensorColors.pm25,  data:[],  tension:0.3, hidden:true }
    ]
  },
  options: {
    animation: { duration: 120 },
    scales: {
      x: {
        type: "time",
        time: { tooltipFormat: "yyyy-MM-dd HH:mm:ss", displayFormats: { second: "HH:mm:ss", minute: "HH:mm", hour: "HH:mm" } },
        ticks: { color: "#aaa", callback: function(value) {
          try { const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value)); return fmtTimeOnly24.format(t); } catch (e) { return value; }
        }}
      },
      y: { ticks: { color: "#aaa" } }
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => { const raw = items[0].parsed.x; const dt = raw instanceof Date ? raw : new Date(raw); return fmtTime24.format(dt); },
          label: (item) => {
            const key = item.dataset.label;
            const raw = item.parsed && item.parsed.y !== undefined ? item.parsed.y : item.parsed;
            const unit = sensorUnits[key] || '';
            const decimals = sensorDecimals[key] !== undefined ? sensorDecimals[key] : 1;
            return key.toUpperCase() + ": " + formatValue(raw, unit, decimals, 'it-IT');
          }
        }
      },
      zoom: commonZoomOptions,
      legend: { onClick: () => {} }
    }
  }
});

// -------------------- STORICO CUSTOM CHART --------------------
let chart_history_custom = new Chart(document.getElementById("chart_history_custom"), {
  type: 'line',
  data: {
    datasets: [
      { label:"temp",  borderColor:sensorColors.temp,  data:[],  tension:0.3, hidden:false },
      { label:"hum",   borderColor:sensorColors.hum,   data:[],  tension:0.3, hidden:false },
      { label:"press", borderColor:sensorColors.press, data:[],  tension:0.3, hidden:true },
      { label:"co2",   borderColor:sensorColors.co2,   data:[],  tension:0.3, hidden:true },
      { label:"tvoc",  borderColor:sensorColors.tvoc,  data:[],  tension:0.3, hidden:true },
      { label:"pm25",  borderColor:sensorColors.pm25,  data:[],  tension:0.3, hidden:true }
    ]
  },
  options: {
    animation: { duration: 0 },
    scales: {
      x: {
        type: "time",
        time: { unit: "minute", tooltipFormat: "yyyy-MM-dd HH:mm:ss", displayFormats: { minute: "HH:mm", hour: "HH:mm" } },
        ticks: { color: "#aaa", callback: function(value) {
          try { const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value)); return fmtTimeOnly24.format(t); } catch (e) { return value; }
        }}
      },
      y: { ticks: { color: "#aaa" } }
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => { const raw = items[0].parsed.x; const dt = raw instanceof Date ? raw : new Date(raw); return fmtTime24.format(dt); },
          label: (item) => {
            const key = item.dataset.label;
            const raw = item.parsed && item.parsed.y !== undefined ? item.parsed.y : item.parsed;
            const unit = sensorUnits[key] || '';
            const decimals = sensorDecimals[key] !== undefined ? sensorDecimals[key] : 1;
            return key.toUpperCase() + ": " + formatValue(raw, unit, decimals, 'it-IT');
          }
        }
      },
      zoom: commonZoomOptions,
      legend: { onClick: () => {} }
    }
  }
});

// inizializza limiti zoom basici
updateZoomLimitsForChart(chart_history, 6);
updateZoomLimitsForChart(chart_history_custom, 6);

// -------------------- UI HANDLERS --------------------
document.querySelectorAll(".sensorCheck").forEach(chk => {
  chk.addEventListener("change", () => {
    chart_history.data.datasets.forEach(ds => {
      const el = document.querySelector(`input.sensorCheck[value="${ds.label}"]`);
      ds.hidden = !el || !el.checked;
    });
    updateYAxisRange();
    chart_history.update('none');
  });
});
document.querySelectorAll(".histCheck").forEach(chk => {
  chk.addEventListener("change", () => {
    chart_history_custom.data.datasets.forEach(ds => {
      const el = document.querySelector(`.histCheck[value="${ds.label}"]`);
      ds.hidden = !el || !el.checked;
    });
    updateYAxisRangeHistory();
    chart_history_custom.update('none');
  });
});
document.getElementById("smooth_mode").addEventListener("change", (e) => {
  const smooth = e.target.checked;
  chart_history_custom.data.datasets.forEach(ds => ds.spanGaps = smooth);
  chart_history_custom.update('none');
});

// -------------------- Y-AXIS RANGE HELPERS --------------------
function updateYAxisRange() {
  const selected = [...document.querySelectorAll(".sensorCheck:checked")].map(c => c.value);
  if (selected.length === 0) { delete chart_history.options.scales.y.min; delete chart_history.options.scales.y.max; chart_history.update('none'); return; }
  let allValues = [];
  chart_history.data.datasets.forEach(ds => {
    if (!selected.includes(ds.label)) return;
    ds.data.forEach(pt => {
      const v = (pt && typeof pt === 'object') ? pt.y : pt;
      if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v));
    });
  });
  if (allValues.length === 0) { delete chart_history.options.scales.y.min; delete chart_history.options.scales.y.max; chart_history.update('none'); return; }
  let min = Math.min(...allValues), max = Math.max(...allValues);
  const range = Math.max((max - min), Math.abs(max) * 0.05, 1), pad = range * 0.06;
  chart_history.options.scales.y.min = Math.max(min - pad, 0);
  chart_history.options.scales.y.max = max + pad;
  chart_history.update('none');
}
function updateYAxisRangeHistory() {
  const selected = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);
  if (selected.length === 0) { delete chart_history_custom.options.scales.y.min; delete chart_history_custom.options.scales.y.max; chart_history_custom.update('none'); return; }
  let allValues = [];
  chart_history_custom.data.datasets.forEach(ds => {
    if (!selected.includes(ds.label)) return;
    ds.data.forEach(pt => {
      const v = (pt && typeof pt === 'object') ? pt.y : pt;
      if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v));
    });
  });
  if (allValues.length === 0) { delete chart_history_custom.options.scales.y.min; delete chart_history_custom.options.scales.y.max; chart_history_custom.update('none'); return; }
  let min = Math.min(...allValues), max = Math.max(...allValues);
  const range = Math.max((max - min), Math.abs(max) * 0.05, 1), pad = range * 0.06;
  chart_history_custom.options.scales.y.min = Math.max(min - pad, 0);
  chart_history_custom.options.scales.y.max = max + pad;
  chart_history_custom.update('none');
}

// -------------------- MQTT + LIVE HANDLING + RELAY (ottimizzato) --------------------
let ignoreToggleEvents = false;
if (typeof window.tzOffsetMinLastRequest === 'undefined') window.tzOffsetMinLastRequest = null;

function startMQTT() {
  window.mqttClient = mqtt.connect("wss://02164e543aa54cedb0d1c41246e8c43b.s1.eu.hivemq.cloud:8884/mqtt", {
    username: MQTT_USERNAME, password: MQTT_PASSWORD, clean: true, reconnectPeriod: 2000
  });

  mqttClient.on("connect", () => {
    updateWSStatus(true);
    mqttClient.subscribe("esp32/live");
    mqttClient.subscribe("esp32/history_chunk");
    mqttClient.subscribe("esp32/relay_state");
  });
  mqttClient.on("close", () => updateWSStatus(false));
  mqttClient.on("error", () => updateWSStatus(false));

  mqttClient.on("message", (topic, message) => {
    let d;
    try { d = JSON.parse(message.toString()); } catch { return; }

    if (topic === "esp32/live") {
      // BATCH: aggiorniamo DOM e gauge senza chiamare update per ogni gauge
      // Aggiorna DOM (batch via requestAnimationFrame)
      const domUpdates = [
        { id: "co2",  text: formatValue(d.co2, sensorUnits.co2, sensorDecimals.co2) },
        { id: "tvoc", text: formatValue(d.tvoc, sensorUnits.tvoc, sensorDecimals.tvoc) },
        { id: "pm25", text: formatValue(d.pm25, sensorUnits.pm25, sensorDecimals.pm25) },
        { id: "aiq",  text: formatValue(d.aiq, sensorUnits.aiq, sensorDecimals.aiq) },
        { id: "temp", text: formatValue(d.temp, sensorUnits.temp, sensorDecimals.temp) },
        { id: "hum",  text: formatValue(d.hum, sensorUnits.hum, sensorDecimals.hum) },
        { id: "press",text: formatValue(d.press, sensorUnits.press, sensorDecimals.press) }
      ];
      requestAnimationFrame(() => {
        domUpdates.forEach(u => {
          const el = document.getElementById(u.id);
          if (el) el.innerText = u.text;
        });
      });

      // aggiorna gauge in modalità skipUpdate per batch
      updateGauge(g_co2,  'co2',  d.co2,  { skipUpdate: true });
      updateGauge(g_tvoc, 'tvoc', d.tvoc, { skipUpdate: true });
      updateGauge(g_pm25, 'pm25', d.pm25, { skipUpdate: true });
      updateGauge(g_aiq,  'aiq',  d.aiq,  { skipUpdate: true });
      updateGauge(g_temp, 'temp', d.temp, { skipUpdate: true });
      updateGauge(g_hum,  'hum',  d.hum,  { skipUpdate: true });
      updateGauge(g_press,'press',d.press,{ skipUpdate: true });
      // flush tutte le gauge in un'unica passata
      requestAnimationFrame(flushGaugeUpdates);

      // push live points (numerici) e aggiorna chart una sola volta
      const now = new Date();
      const pushPoint = (label, value) => {
        const ds = chart_history.data.datasets.find(s => s.label === label);
        if (!ds) return;
        ds.data.push({ x: now, y: value });
        if (ds.data.length > MAX_POINTS) ds.data.shift();
      };
      pushPoint("temp", d.temp);
      pushPoint("hum", d.hum);
      pushPoint("press", d.press);
      pushPoint("co2", d.co2);
      pushPoint("tvoc", d.tvoc);
      pushPoint("pm25", d.pm25);

      // historyData (circular buffer)
      historyData.labels.push(now);
      historyData.temp.push(d.temp);
      historyData.hum.push(d.hum);
      historyData.press.push(d.press);
      historyData.co2.push(d.co2);
      historyData.tvoc.push(d.tvoc);
      historyData.pm25.push(d.pm25);
      if (historyData.labels.length > MAX_POINTS) {
        Object.keys(historyData).forEach(k => historyData[k].shift());
      }

      // aggiorna scala Y e limiti zoom, poi un singolo update del chart
      updateYAxisRange();
      updateZoomLimitsForChart(chart_history, 6);
      clampViewToDataIfNeeded(chart_history, 6);
      chart_history.update('none');
      return;
    }

    if (topic === "esp32/history_chunk") {
      // ACK IMMEDIATO per ridurre latenza percepita
      if (d && d.chunkId != null && window.mqttClient) {
        try { mqttClient.publish("esp32/history/ack", JSON.stringify({ chunkId: d.chunkId })); } catch(e) {}
      }
      // Salva chunk raw e processalo asincrono per non bloccare il thread UI
      if (!window._historyRawChunks) window._historyRawChunks = [];
      window._historyRawChunks.push(d);
      // Se il chunk è finale (done), schedula la ricostruzione pesante in background
      if (d && d.done) {
        // lascia un tick per permettere al broker di ricevere l'ack
        setTimeout(() => {
          try {
            // processa tutti i chunk salvati con la funzione esistente handleHistoryPacketBatch
            // implementiamo una versione ottimizzata che riusa il codice di prima ma in un unico posto
            processSavedHistoryChunks(window._historyRawChunks);
          } finally {
            window._historyRawChunks = null;
          }
        }, 10);
      }
      return;
    }

    if (topic === "esp32/relay_state") {
      ignoreToggleEvents = true;
      const r1 = !!d.r1, r2 = !!d.r2;
      requestAnimationFrame(() => {
        const el1 = document.getElementById("relay1_toggle");
        const el2 = document.getElementById("relay2_toggle");
        if (el1) el1.checked = r1;
        if (el2) el2.checked = r2;
        ignoreToggleEvents = false;
      });
      return;
    }
  });
}

// send relay
function sendRelayCommand(id, state) {
  if (!window.mqttClient) return;
  mqttClient.publish(`esp32/cmd/relay${id}`, state ? "1" : "0");
}
document.getElementById("relay1_toggle").addEventListener("change", (e) => { if (ignoreToggleEvents) return; sendRelayCommand(1, e.target.checked); });
document.getElementById("relay2_toggle").addEventListener("change", (e) => { if (ignoreToggleEvents) return; sendRelayCommand(2, e.target.checked); });

// -------------------- STORICO REQUEST / HELPERS --------------------
function parseLocalDateTimeString(dtLocalStr) {
  if (!dtLocalStr || typeof dtLocalStr !== 'string') return null;
  const m = dtLocalStr.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = m[6] ? Number(m[6]) : 0;
  const d = new Date(year, month - 1, day, hour, minute, second);
  return isNaN(d.getTime()) ? null : d;
}
function toEpochSecondsUTCFromLocal(dtLocalStr) { const d = parseLocalDateTimeString(dtLocalStr); if (!d) return null; return Math.floor(d.getTime() / 1000); }
function isoUTCFromLocalString(dtLocalStr) { const d = parseLocalDateTimeString(dtLocalStr); if (!d) return null; return new Date(d.getTime()).toISOString(); }
function isoLocalWithOffset(dtLocalStr) {
  const d = parseLocalDateTimeString(dtLocalStr); if (!d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const tzOffsetMin = -d.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const hh = pad(Math.floor(absMin / 60)), mm = pad(absMin % 60);
  const localDatePart = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${localDatePart}${sign}${hh}:${mm}`;
}
function tzOffsetMinutes(dtLocalStr) { const d = parseLocalDateTimeString(dtLocalStr); if (!d) return null; return -d.getTimezoneOffset(); }
function epochSecondsAsIfUTC(dtLocalStr) { const d = parseLocalDateTimeString(dtLocalStr); if (!d) return null; return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 1000); }

if (typeof window.tzOffsetMinLastRequest === 'undefined') window.tzOffsetMinLastRequest = null;
if (typeof window.lastHistoryRequest === 'undefined') window.lastHistoryRequest = null;

document.getElementById("btn_load_history").addEventListener("click", () => {
  const fromRaw = document.getElementById("hist_from").value;
  const toRaw   = document.getElementById("hist_to").value;
  const sensors = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);
  if (!fromRaw || !toRaw || sensors.length === 0) { alert("Seleziona almeno un sensore e un intervallo valido"); return; }

  const fromEpochUtc = toEpochSecondsUTCFromLocal(fromRaw);
  const toEpochUtc   = toEpochSecondsUTCFromLocal(toRaw);
  const fromEpochNaive = epochSecondsAsIfUTC(fromRaw);
  const toEpochNaive   = epochSecondsAsIfUTC(toRaw);
  const fromIsoUtc   = isoUTCFromLocalString(fromRaw);
  const toIsoUtc     = isoUTCFromLocalString(toRaw);
  const fromIsoLocal = isoLocalWithOffset(fromRaw);
  const toIsoLocal   = isoLocalWithOffset(toRaw);
  const tzOffsetMin  = tzOffsetMinutes(fromRaw);

  if (fromEpochUtc === null || toEpochUtc === null) { alert("Formato data non valido. Usa il picker o YYYY-MM-DDTHH:MM"); return; }

  historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
  chart_history_custom.data.datasets.forEach(ds => ds.data = []);
  chart_history_custom.data.labels = [];
  chart_history_custom.update();

  const req = {
    type: "get_history",
    from: fromEpochNaive, to: toEpochNaive,
    from_epoch_utc: fromEpochUtc, to_epoch_utc: toEpochUtc,
    from_epoch_naive: fromEpochNaive, to_epoch_naive: toEpochNaive,
    from_iso_utc: fromIsoUtc, to_iso_utc: toIsoUtc,
    from_iso_local: fromIsoLocal, to_iso_local: toIsoLocal,
    tz_offset_min: tzOffsetMin, sensors: sensors
  };

  window.tzOffsetMinLastRequest = tzOffsetMin;
  window.lastHistoryRequest = { fromEpochUtc: fromEpochUtc, toEpochUtc: toEpochUtc, tzOffsetMin: tzOffsetMin };

  if (window.mqttClient) mqttClient.publish("esp32/history/request", JSON.stringify(req));
  else alert("MQTT non connesso");
});

// -------------------- PROCESS HISTORY CHUNKS (ottimizzato, asincrono) --------------------
function processSavedHistoryChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return;
  // Esegui la ricostruzione in un timeout per non bloccare UI
  setTimeout(() => {
    try {
      // ricostruzione simile a handleHistoryPacket ma operando su tutti i chunk
      const clientTz = (typeof window.tzOffsetMinLastRequest === 'number') ? window.tzOffsetMinLastRequest : null;
      const req = window.lastHistoryRequest || null;
      const reqFrom = req ? req.fromEpochUtc : null;
      const reqTo   = req ? req.toEpochUtc : null;

      // raccogli raw chunks in struttura compatta
      const rawChunks = chunks.map(d => ({
        timestamps: Array.isArray(d.timestamps) ? d.timestamps : [],
        data: d.data || null,
        chunkTz: (typeof d.tz_offset_min === 'number') ? d.tz_offset_min : null,
        chunkId: d.chunkId || null
      }));

      // helper per correzione
      const applyCorrectionToEpoch = (epochSec, tzMinToUse, times = 0) => {
        if (epochSec == null) return null;
        const e = Number(epochSec);
        if (isNaN(e)) return null;
        if (typeof tzMinToUse !== 'number' || times === 0) return Math.floor(e);
        return Math.floor(e - (times * tzMinToUse * 60));
      };

      // scoring per scegliere bestMode (0/1/2)
      const modes = [0,1,2];
      const modeScores = {0:0,1:0,2:0};
      rawChunks.forEach(chunk => {
        const tsArr = chunk.timestamps;
        tsArr.forEach(t => {
          if (t == null) return;
          modes.forEach(m => {
            const tzToUse = (typeof chunk.chunkTz === 'number') ? chunk.chunkTz : clientTz;
            const epochCandidate = applyCorrectionToEpoch(t, tzToUse, m);
            if (epochCandidate == null) return;
            if (reqFrom !== null && reqTo !== null) {
              if (epochCandidate >= reqFrom && epochCandidate <= reqTo) modeScores[m]++;
            } else modeScores[m]++;
          });
        });
      });

      // preferenza: 1,0,2
      let bestMode = 0, bestScore = -1;
      [1,0,2].forEach(m => { if (modeScores[m] > bestScore) { bestScore = modeScores[m]; bestMode = m; } });

      // ricostruzione etichette e serie
      const allLabels = [];
      const allSeries = { temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
      rawChunks.forEach(chunk => {
        const tsArr = chunk.timestamps;
        const tzToUse = (typeof chunk.chunkTz === 'number') ? chunk.chunkTz : clientTz;
        tsArr.forEach((t, idx) => {
          if (t == null) { allLabels.push(null); }
          else {
            const epochSec = applyCorrectionToEpoch(t, tzToUse, bestMode);
            allLabels.push(new Date(epochSec * 1000));
          }
          if (chunk.data) {
            allSeries.temp.push(chunk.data.temp && chunk.data.temp[idx] !== undefined ? chunk.data.temp[idx] : null);
            allSeries.hum.push(chunk.data.hum && chunk.data.hum[idx] !== undefined ? chunk.data.hum[idx] : null);
            allSeries.press.push(chunk.data.press && chunk.data.press[idx] !== undefined ? chunk.data.press[idx] : null);
            allSeries.co2.push(chunk.data.co2 && chunk.data.co2[idx] !== undefined ? chunk.data.co2[idx] : null);
            allSeries.tvoc.push(chunk.data.tvoc && chunk.data.tvoc[idx] !== undefined ? chunk.data.tvoc[idx] : null);
            allSeries.pm25.push(chunk.data.pm25 && chunk.data.pm25[idx] !== undefined ? chunk.data.pm25[idx] : null);
          } else {
            allSeries.temp.push(null); allSeries.hum.push(null); allSeries.press.push(null);
            allSeries.co2.push(null); allSeries.tvoc.push(null); allSeries.pm25.push(null);
          }
        });
      });

      // filtra null e dedup/ordina in modo efficiente
      const filteredLabels = [];
      const filteredSeries = { temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
      for (let i = 0; i < allLabels.length; i++) {
        if (!allLabels[i]) continue;
        filteredLabels.push(allLabels[i]);
        filteredSeries.temp.push(allSeries.temp[i]);
        filteredSeries.hum.push(allSeries.hum[i]);
        filteredSeries.press.push(allSeries.press[i]);
        filteredSeries.co2.push(allSeries.co2[i]);
        filteredSeries.tvoc.push(allSeries.tvoc[i]);
        filteredSeries.pm25.push(allSeries.pm25[i]);
      }

      // sort + unique by timestamp (map-based to be faster on large arrays)
      const mapByTs = new Map();
      for (let i = 0; i < filteredLabels.length; i++) {
        const ts = filteredLabels[i].getTime();
        if (!mapByTs.has(ts)) {
          mapByTs.set(ts, { idx: i, ts });
        }
      }
      const sortedTs = Array.from(mapByTs.keys()).sort((a,b) => a - b);
      const sortedLabels = sortedTs.map(t => new Date(t));
      const rebuilt = { temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
      sortedTs.forEach(t => {
        const i = mapByTs.get(t).idx;
        rebuilt.temp.push(filteredSeries.temp[i] !== undefined ? filteredSeries.temp[i] : null);
        rebuilt.hum.push(filteredSeries.hum[i] !== undefined ? filteredSeries.hum[i] : null);
        rebuilt.press.push(filteredSeries.press[i] !== undefined ? filteredSeries.press[i] : null);
        rebuilt.co2.push(filteredSeries.co2[i] !== undefined ? filteredSeries.co2[i] : null);
        rebuilt.tvoc.push(filteredSeries.tvoc[i] !== undefined ? filteredSeries.tvoc[i] : null);
        rebuilt.pm25.push(filteredSeries.pm25[i] !== undefined ? filteredSeries.pm25[i] : null);
      });

      // assegna a historyCustom e popola chart in batch
      historyCustom.labels = sortedLabels;
      historyCustom.temp = rebuilt.temp;
      historyCustom.hum = rebuilt.hum;
      historyCustom.press = rebuilt.press;
      historyCustom.co2 = rebuilt.co2;
      historyCustom.tvoc = rebuilt.tvoc;
      historyCustom.pm25 = rebuilt.pm25;

      chart_history_custom.data.datasets.forEach(ds => {
        const key = ds.label;
        ds.data = historyCustom.labels.map((t, i) => {
          const v = historyCustom[key][i];
          return v === null ? { x: t, y: null } : { x: t, y: v };
        });
      });

      updateYAxisRangeHistory();
      updateZoomLimitsForChart(chart_history_custom, 6);
      if (historyCustom.labels.length) {
        chart_history_custom.options.scales.x.min = historyCustom.labels[0];
        chart_history_custom.options.scales.x.max = historyCustom.labels[historyCustom.labels.length - 1];
        if (chart_history_custom.resetZoom) chart_history_custom.resetZoom();
      }
      chart_history_custom.update();
    } catch (err) {
      // log leggero per debug
      console.warn('processSavedHistoryChunks error', err && err.message ? err.message : err);
    }
  }, 0);
}

// -------------------- WEBSOCKET STATUS --------------------
function updateWSStatus(connected) {
  let el = document.getElementById("ws_status");
  if (!el) return;
  if (connected) {
    el.textContent = "🟢 Connesso";
    el.classList.remove("ws_disconnected"); el.classList.add("ws_connected");
  } else {
    el.textContent = "🔴 Disconnesso — riconnessione…";
    el.classList.remove("ws_connected"); el.classList.add("ws_disconnected");
  }
}
