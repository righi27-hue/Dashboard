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

// ===================== GAUGE CREATOR + GLOBALS =====================
function createGauge(ctx, color) {
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Valore','Restante'],
      datasets: [{
        data:[0,100],
        backgroundColor:[color,'#333'],
        borderWidth:0
      }]
    },
    options: {
      cutout:'70%',
      animation:{duration:200},
      plugins:{legend:{display:false}}
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

let MAX_POINTS = 300;

let historyData = {
  labels: [],
  temp: [],
  hum: [],
  press: [],
  co2: [],
  tvoc: [],
  pm25: []
};

let historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };

let sensorColors = {
  temp:"#29b6f6",
  hum:"#fdd835",
  press:"#66bb6a",
  co2:"#ff5252",
  tvoc:"#ffa726",
  pm25:"#ab47bc"
};

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

// ===================== ZOOM / PAN COMMON OPTIONS =====================
// Sensibilità molto dolce, limiti dinamici gestiti separatamente
const commonZoomOptions = {
  zoom: {
    wheel: { enabled: true, speed: 0.02 },
    pinch: { enabled: true, speed: 0.02 },
    drag: { enabled: false },
    mode: 'x',
    limits: {
      x: {
        minRange: 1000 * 10,
        maxRange: Number.MAX_SAFE_INTEGER
      }
    }
  },
  pan: {
    enabled: true,
    mode: 'x',
    threshold: 6
  }
};

// ===================== HELPERS PER ZOOM E BOUNDS =====================
function getChartTimeBounds(chart) {
  let min = Infinity, max = -Infinity;
  chart.data.datasets.forEach(ds => {
    ds.data.forEach(pt => {
      const t = (pt && typeof pt === 'object') ? pt.x : pt;
      if (!t) return;
      const ts = (t instanceof Date) ? t.getTime() : new Date(t).getTime();
      if (!isNaN(ts)) {
        min = Math.min(min, ts);
        max = Math.max(max, ts);
      }
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
    delete chart.options.scales.x.min;
    delete chart.options.scales.x.max;
    return;
  }
  const dataRange = bounds.max - bounds.min;
  const maxRange = Math.max(dataRange * maxZoomOutFactor, 1000 * 60);
  chart.options.plugins.zoom.zoom.limits.x.maxRange = maxRange;
  // Mantieni i limiti dell'asse per evitare pan oltre i dati
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

// ===================== LIVE CHART =====================
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
    animation: { duration: 150 },
    scales: {
      x: {
        type: "time",
        time: {
          tooltipFormat: "yyyy-MM-dd HH:mm:ss",
          displayFormats: { second: "HH:mm:ss", minute: "HH:mm", hour: "HH:mm" }
        },
        ticks: {
          color: "#aaa",
          callback: function(value) {
            try {
              const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value));
              return fmtTimeOnly24.format(t);
            } catch (e) { return value; }
          }
        }
      },
      y: { ticks: { color: "#aaa" } }
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => {
            const raw = items[0].parsed.x;
            const dt = raw instanceof Date ? raw : new Date(raw);
            return fmtTime24.format(dt);
          },
          label: (item) => item.dataset.label.toUpperCase() + ": " + item.formattedValue
        }
      },
      zoom: commonZoomOptions,
      legend: { onClick: () => {} }
    }
  }
});

// ===================== STORICO CUSTOM CHART =====================
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
        time: {
          unit: "minute",
          tooltipFormat: "yyyy-MM-dd HH:mm:ss",
          displayFormats: { minute: "HH:mm", hour: "HH:mm" }
        },
        ticks: {
          color: "#aaa",
          callback: function(value) {
            try {
              const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value));
              return fmtTimeOnly24.format(t);
            } catch (e) { return value; }
          }
        }
      },
      y: { ticks: { color: "#aaa" } }
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => {
            const raw = items[0].parsed.x;
            const dt = raw instanceof Date ? raw : new Date(raw);
            return fmtTime24.format(dt);
          },
          label: (item) => item.dataset.label.toUpperCase() + ": " + item.formattedValue
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

// ===================== CHECKBOX HANDLERS =====================
document.querySelectorAll(".sensorCheck").forEach(chk => {
  chk.addEventListener("change", () => {
    chart_history.data.datasets.forEach(ds => {
      const el = document.querySelector(`input.sensorCheck[value="${ds.label}"]`);
      ds.hidden = !el || !el.checked;
    });
    updateYAxisRange();
    chart_history.update();
  });
});

document.querySelectorAll(".histCheck").forEach(chk => {
  chk.addEventListener("change", () => {
    chart_history_custom.data.datasets.forEach(ds => {
      const el = document.querySelector(`.histCheck[value="${ds.label}"]`);
      ds.hidden = !el || !el.checked;
    });
    updateYAxisRangeHistory();
    chart_history_custom.update();
  });
});

document.getElementById("smooth_mode").addEventListener("change", (e) => {
  let smooth = e.target.checked;
  chart_history_custom.data.datasets.forEach(ds => ds.spanGaps = smooth);
  chart_history_custom.update();
});

// ===================== Y-AXIS RANGE (LIVE) =====================
function updateYAxisRange() {
  const selected = [...document.querySelectorAll(".sensorCheck:checked")].map(c => c.value);
  if (selected.length === 0) {
    delete chart_history.options.scales.y.min;
    delete chart_history.options.scales.y.max;
    chart_history.update('none');
    return;
  }

  let allValues = [];
  chart_history.data.datasets.forEach(ds => {
    if (!selected.includes(ds.label)) return;
    ds.data.forEach(pt => {
      const v = (pt && typeof pt === 'object') ? pt.y : pt;
      if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v));
    });
  });

  if (allValues.length === 0) {
    delete chart_history.options.scales.y.min;
    delete chart_history.options.scales.y.max;
    chart_history.update('none');
    return;
  }

  let min = Math.min(...allValues);
  let max = Math.max(...allValues);
  const range = Math.max((max - min), Math.abs(max) * 0.05, 1);
  const pad = range * 0.06;

  chart_history.options.scales.y.min = Math.max(min - pad, 0);
  chart_history.options.scales.y.max = max + pad;
  chart_history.update('none');
}

// ===================== Y-AXIS RANGE (HISTORIC) =====================
function updateYAxisRangeHistory() {
  const selected = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);
  if (selected.length === 0) {
    delete chart_history_custom.options.scales.y.min;
    delete chart_history_custom.options.scales.y.max;
    chart_history_custom.update('none');
    return;
  }

  let allValues = [];
  chart_history_custom.data.datasets.forEach(ds => {
    if (!selected.includes(ds.label)) return;
    ds.data.forEach(pt => {
      const v = (pt && typeof pt === 'object') ? pt.y : pt;
      if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v));
    });
  });

  if (allValues.length === 0) {
    delete chart_history_custom.options.scales.y.min;
    delete chart_history_custom.options.scales.y.max;
    chart_history_custom.update('none');
    return;
  }

  let min = Math.min(...allValues);
  let max = Math.max(...allValues);
  const range = Math.max((max - min), Math.abs(max) * 0.05, 1);
  const pad = range * 0.06;

  chart_history_custom.options.scales.y.min = Math.max(min - pad, 0);
  chart_history_custom.options.scales.y.max = max + pad;
  chart_history_custom.update('none');
}

// ===================== WEBSOCKET STATUS =====================
function updateWSStatus(connected) {
  let el = document.getElementById("ws_status");
  if (!el) return;
  if (connected) {
    el.textContent = "🟢 Connesso";
    el.classList.remove("ws_disconnected");
    el.classList.add("ws_connected");
  } else {
    el.textContent = "🔴 Disconnesso — riconnessione…";
    el.classList.remove("ws_connected");
    el.classList.add("ws_disconnected");
  }
}

// ===================== MQTT + LIVE HANDLING + RELAY =====================
let ignoreToggleEvents = false;

// assicurati che la variabile globale per l'offset esista UNA SOLA VOLTA
if (typeof window.tzOffsetMinLastRequest === 'undefined') window.tzOffsetMinLastRequest = null;

function startMQTT() {
  window.mqttClient = mqtt.connect("wss://02164e543aa54cedb0d1c41246e8c43b.s1.eu.hivemq.cloud:8884/mqtt", {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clean: true,
    reconnectPeriod: 2000
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
      // update DOM
      document.getElementById("co2").innerText  = d.co2;
      document.getElementById("tvoc").innerText = d.tvoc;
      document.getElementById("pm25").innerText = d.pm25;
      document.getElementById("aiq").innerText  = d.aiq;
      document.getElementById("temp").innerText = d.temp;
      document.getElementById("hum").innerText  = d.hum;
      document.getElementById("press").innerText= d.press;

      // gauges
      g_co2.data.datasets[0].data  = [d.co2/20, 100-(d.co2/20)];
      g_tvoc.data.datasets[0].data = [d.tvoc/10, 100-(d.tvoc/10)];
      g_pm25.data.datasets[0].data = [d.pm25, 100-d.pm25];

      let aiqVal = Math.min(d.aiq, 500) / 5;
      let aiqCol = aiqColor(d.aiq);
      g_aiq.data.datasets[0].backgroundColor[0] = aiqCol;
      g_aiq.data.datasets[0].data = [aiqVal, 100 - aiqVal];

      g_temp.data.datasets[0].data = [d.temp, 100-d.temp];
      g_hum.data.datasets[0].data  = [d.hum, 100-d.hum];
      g_press.data.datasets[0].data= [(d.press-980)/0.4, 100-((d.press-980)/0.4)];

      g_co2.update();
      g_tvoc.update();
      g_pm25.update();
      g_aiq.update();
      g_temp.update();
      g_hum.update();
      g_press.update();

      // push live points as {x: Date, y: value}
      let now = new Date();
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

      // keep historyData arrays (optional)
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

      // aggiorna scala Y e limiti zoom basati sui dati
      updateYAxisRange();
      updateZoomLimitsForChart(chart_history, 6);
      // se la vista è già fuori controllo, la riportiamo (opzionale)
      clampViewToDataIfNeeded(chart_history, 6);

      chart_history.update('none');
      return;
    }

    if (topic === "esp32/history_chunk") {
      handleHistoryPacket(d);
      if (!d.done) {
        const ack = { chunkId: d.chunkId || 0 };
        mqttClient.publish("esp32/history/ack", JSON.stringify(ack));
      } else {
        // quando lo storico è completo, aggiorna limiti zoom e scala Y
        updateZoomLimitsForChart(chart_history_custom, 6);
        updateYAxisRangeHistory();
      }
      return;
    }

    if (topic === "esp32/relay_state") {
      ignoreToggleEvents = true;
      document.getElementById("relay1_toggle").checked = !!d.r1;
      document.getElementById("relay2_toggle").checked = !!d.r2;
      ignoreToggleEvents = false;
      return;
    }
  });
}

function sendRelayCommand(id, state) {
  if (!window.mqttClient) return;
  mqttClient.publish(`esp32/cmd/relay${id}`, state ? "1" : "0");
}

document.getElementById("relay1_toggle").addEventListener("change", (e) => {
  if (ignoreToggleEvents) return;
  sendRelayCommand(1, e.target.checked);
});
document.getElementById("relay2_toggle").addEventListener("change", (e) => {
  if (ignoreToggleEvents) return;
  sendRelayCommand(2, e.target.checked);
});

// ===================== STORICO REQUEST / HELPERS =====================
// Parser robusto per stringhe locali "YYYY-MM-DDTHH:MM[:SS]" o "YYYY-MM-DD HH:MM[:SS]"
function parseLocalDateTimeString(dtLocalStr) {
  if (!dtLocalStr || typeof dtLocalStr !== 'string') return null;
  const m = dtLocalStr.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  const d = new Date(year, month - 1, day, hour, minute, second);
  return isNaN(d.getTime()) ? null : d;
}

function toEpochSecondsUTCFromLocal(dtLocalStr) {
  const d = parseLocalDateTimeString(dtLocalStr);
  if (!d) return null;
  return Math.floor(d.getTime() / 1000);
}

function isoUTCFromLocalString(dtLocalStr) {
  const d = parseLocalDateTimeString(dtLocalStr);
  if (!d) return null;
  return new Date(d.getTime()).toISOString();
}

function isoLocalWithOffset(dtLocalStr) {
  const d = parseLocalDateTimeString(dtLocalStr);
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const tzOffsetMin = -d.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const hh = pad(Math.floor(absMin / 60));
  const mm = pad(absMin % 60);
  const localDatePart = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${localDatePart}${sign}${hh}:${mm}`;
}

function tzOffsetMinutes(dtLocalStr) {
  const d = parseLocalDateTimeString(dtLocalStr);
  if (!d) return null;
  return -d.getTimezoneOffset();
}

function epochSecondsAsIfUTC(dtLocalStr) {
  const d = parseLocalDateTimeString(dtLocalStr);
  if (!d) return null;
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 1000);
}

// Assicuriamoci che le variabili globali esistano (una sola volta)
if (typeof window.tzOffsetMinLastRequest === 'undefined') window.tzOffsetMinLastRequest = null;
if (typeof window.lastHistoryRequest === 'undefined') window.lastHistoryRequest = null;

document.getElementById("btn_load_history").addEventListener("click", () => {
  const fromRaw = document.getElementById("hist_from").value;
  const toRaw   = document.getElementById("hist_to").value;
  const sensors = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);

  console.log("Picker raw values:", { fromRaw, toRaw });

  if (!fromRaw || !toRaw || sensors.length === 0) {
    alert("Seleziona almeno un sensore e un intervallo valido");
    return;
  }

  const fromEpochUtc = toEpochSecondsUTCFromLocal(fromRaw);
  const toEpochUtc   = toEpochSecondsUTCFromLocal(toRaw);
  const fromEpochNaive = epochSecondsAsIfUTC(fromRaw);
  const toEpochNaive   = epochSecondsAsIfUTC(toRaw);
  const fromIsoUtc   = isoUTCFromLocalString(fromRaw);
  const toIsoUtc     = isoUTCFromLocalString(toRaw);
  const fromIsoLocal = isoLocalWithOffset(fromRaw);
  const toIsoLocal   = isoLocalWithOffset(toRaw);
  const tzOffsetMin  = tzOffsetMinutes(fromRaw);

  console.log("Parsed history request values:", {
    fromEpochUtc, toEpochUtc,
    fromIsoUtc, toIsoUtc,
    fromIsoLocal, toIsoLocal,
    tzOffsetMin,
    fromEpochNaive, toEpochNaive
  });

  if (fromEpochUtc === null || toEpochUtc === null) {
    alert("Formato data non valido. Usa il picker o YYYY-MM-DDTHH:MM");
    return;
  }

  historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
  chart_history_custom.data.datasets.forEach(ds => ds.data = []);
  chart_history_custom.data.labels = [];
  chart_history_custom.update();

  const req = {
    type: "get_history",
    // Workaround compatibilità ESP32: invia 'from'/'to' come epoch naive
    from: fromEpochNaive,
    to:   toEpochNaive,
    from_epoch_utc: fromEpochUtc,
    to_epoch_utc:   toEpochUtc,
    from_epoch_naive: fromEpochNaive,
    to_epoch_naive:   toEpochNaive,
    from_iso_utc:    fromIsoUtc,
    to_iso_utc:      toIsoUtc,
    from_iso_local:  fromIsoLocal,
    to_iso_local:    toIsoLocal,
    tz_offset_min:   tzOffsetMin,
    sensors: sensors
  };

  // salva l'offset e i bound della richiesta per diagnostica e per la scelta automatica
  window.tzOffsetMinLastRequest = tzOffsetMin;
  window.lastHistoryRequest = {
    fromEpochUtc: fromEpochUtc,
    toEpochUtc: toEpochUtc,
    tzOffsetMin: tzOffsetMin
  };

  console.log("Publishing history request (workaround):", req);

  if (window.mqttClient) {
    mqttClient.publish("esp32/history/request", JSON.stringify(req));
  } else {
    alert("MQTT non connesso");
  }
});

// handleHistoryPacket: robusto, raccoglie chunk raw e decide globalmente 0/1/2 correzioni
function handleHistoryPacket(d) {
  console.log('HISTORY CHUNK payload:', d);
  if (!d || typeof d !== 'object') return;

  const chunkTz = (typeof d.tz_offset_min === 'number') ? d.tz_offset_min : null;
  const clientTz = (typeof window.tzOffsetMinLastRequest === 'number') ? window.tzOffsetMinLastRequest : null;
  const req = window.lastHistoryRequest || null;
  const reqFrom = req ? req.fromEpochUtc : null;
  const reqTo   = req ? req.toEpochUtc : null;

  if (!window._historyRawChunks) window._historyRawChunks = [];
  if (!window._historyChunkChoices) window._historyChunkChoices = [];

  const rawTs = Array.isArray(d.timestamps) ? d.timestamps : [];
  if (!rawTs.length && !d.done) return;

  const applyCorrectionToEpoch = (epochSec, tzMinToUse, times = 0) => {
    if (epochSec == null) return null;
    const e = Number(epochSec);
    if (isNaN(e)) return null;
    if (typeof tzMinToUse !== 'number' || times === 0) return Math.floor(e);
    return Math.floor(e - (times * tzMinToUse * 60));
  };

  const sampleRaw = rawTs.find(x => x != null);
  let localChoice = { chosenTimes: 0, tzUsed: null, sampleDates: {} };

  if (sampleRaw != null) {
    const candidates = [];
    candidates.push({ times: 0, tz: null, epoch: applyCorrectionToEpoch(sampleRaw, null, 0) });
    if (typeof chunkTz === 'number') {
      candidates.push({ times: 1, tz: chunkTz, epoch: applyCorrectionToEpoch(sampleRaw, chunkTz, 1) });
      candidates.push({ times: 2, tz: chunkTz, epoch: applyCorrectionToEpoch(sampleRaw, chunkTz, 2) });
    }
    if (typeof clientTz === 'number') {
      candidates.push({ times: 1, tz: clientTz, epoch: applyCorrectionToEpoch(sampleRaw, clientTz, 1) });
      candidates.push({ times: 2, tz: clientTz, epoch: applyCorrectionToEpoch(sampleRaw, clientTz, 2) });
    }

    const uniq = [];
    const seen = new Set();
    candidates.forEach(c => {
      if (c.epoch == null || isNaN(c.epoch)) return;
      const key = c.epoch + '|' + c.times + '|' + c.tz;
      if (!seen.has(key)) { seen.add(key); uniq.push(c); }
    });

    if (reqFrom !== null && reqTo !== null && uniq.length) {
      const inRange = uniq.filter(c => c.epoch >= reqFrom && c.epoch <= reqTo);
      if (inRange.length === 1) {
        localChoice.chosenTimes = inRange[0].times;
        localChoice.tzUsed = inRange[0].tz;
      } else if (inRange.length > 1) {
        const prefer = inRange.find(c => c.tz === chunkTz) || inRange.find(c => c.tz === clientTz) || inRange.find(c => c.times === 1);
        localChoice.chosenTimes = prefer.times;
        localChoice.tzUsed = prefer.tz;
      } else {
        const center = (reqFrom + reqTo) / 2;
        let best = null, bestDiff = Infinity;
        uniq.forEach(c => {
          const diff = Math.abs(c.epoch - center);
          if (diff < bestDiff) { bestDiff = diff; best = c; }
        });
        if (best) { localChoice.chosenTimes = best.times; localChoice.tzUsed = best.tz; }
      }
    } else {
      if (chunkTz !== null) { localChoice.chosenTimes = 1; localChoice.tzUsed = chunkTz; }
      else if (clientTz !== null) { localChoice.chosenTimes = 1; localChoice.tzUsed = clientTz; }
      else { localChoice.chosenTimes = 0; localChoice.tzUsed = null; }
    }

    localChoice.sampleDates.noCorr = new Date(applyCorrectionToEpoch(sampleRaw, null, 0) * 1000).toString();
    if (chunkTz !== null) localChoice.sampleDates.oneCorrChunk = new Date(applyCorrectionToEpoch(sampleRaw, chunkTz, 1) * 1000).toString();
    if (clientTz !== null) localChoice.sampleDates.oneCorrClient = new Date(applyCorrectionToEpoch(sampleRaw, clientTz, 1) * 1000).toString();
  }

  window._historyRawChunks.push({
    timestamps: rawTs.slice(),
    data: d.data ? JSON.parse(JSON.stringify(d.data)) : null,
    chunkId: d.chunkId || null,
    localChoice: localChoice,
    chunkTz: chunkTz
  });
  window._historyChunkChoices.push(localChoice);

  console.log('chunk saved; localChoice:', localChoice);

  if (!d.done) {
    if (window.mqttClient && d.chunkId != null) {
      try { mqttClient.publish("esp32/history/ack", JSON.stringify({ chunkId: d.chunkId })); } catch(e) {}
    }
    return;
  }

  const modes = [0,1,2];
  const modeScores = { 0:0, 1:0, 2:0 };

  window._historyRawChunks.forEach(chunk => {
    const tsArr = Array.isArray(chunk.timestamps) ? chunk.timestamps : [];
    tsArr.forEach(t => {
      if (t == null) return;
      modes.forEach(m => {
        const tzToUse = (typeof chunk.chunkTz === 'number') ? chunk.chunkTz : clientTz;
        const epochCandidate = applyCorrectionToEpoch(t, tzToUse, m);
        if (epochCandidate == null) return;
        if (reqFrom !== null && reqTo !== null) {
          if (epochCandidate >= reqFrom && epochCandidate <= reqTo) modeScores[m]++;
        } else {
          modeScores[m]++;
        }
      });
    });
  });

  let bestMode = 0;
  let bestScore = -1;
  [1,0,2].forEach(m => {
    if (modeScores[m] > bestScore) { bestScore = modeScores[m]; bestMode = m; }
  });

  console.log('history: modeScores', modeScores, 'bestMode', bestMode);

  const allLabels = [];
  const allSeries = { temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };

  window._historyRawChunks.forEach(chunk => {
    const tsArr = Array.isArray(chunk.timestamps) ? chunk.timestamps : [];
    const tzToUse = (typeof chunk.chunkTz === 'number') ? chunk.chunkTz : clientTz;
    tsArr.forEach((t, idx) => {
      if (t == null) {
        allLabels.push(null);
      } else {
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

  const combined = filteredLabels.map((dt, i) => ({ t: dt.getTime(), i }));
  combined.sort((a,b) => a.t - b.t);
  const unique = [];
  const seen = new Set();
  combined.forEach(c => { if (!seen.has(c.t)) { seen.add(c.t); unique.push(c); } });

  const sortedLabels = unique.map(u => new Date(u.t));
  const rebuilt = { temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
  unique.forEach(u => {
    const idx = u.i;
    rebuilt.temp.push(filteredSeries.temp[idx] !== undefined ? filteredSeries.temp[idx] : null);
    rebuilt.hum.push(filteredSeries.hum[idx] !== undefined ? filteredSeries.hum[idx] : null);
    rebuilt.press.push(filteredSeries.press[idx] !== undefined ? filteredSeries.press[idx] : null);
    rebuilt.co2.push(filteredSeries.co2[idx] !== undefined ? filteredSeries.co2[idx] : null);
    rebuilt.tvoc.push(filteredSeries.tvoc[idx] !== undefined ? filteredSeries.tvoc[idx] : null);
    rebuilt.pm25.push(filteredSeries.pm25[idx] !== undefined ? filteredSeries.pm25[idx] : null);
  });

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

  console.log('history: chunkChoicesSummary', window._historyChunkChoices);
  console.log('history: globalChoice bestMode', bestMode, 'modeScores', modeScores);

  window._historyRawChunks = null;
  window._historyChunkChoices = null;
}
