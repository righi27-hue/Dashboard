// dashboard.js - versione aggiornata: 24h, zoom live controllato, storico ISO timestamps

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
// Wheel speed molto dolce; limiti dinamici gestiti separatamente
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

// Applica solo limiti plugin (maxRange/minRange). Non impone scale.x.min/max qui.
function updateZoomLimitsForChart(chart, maxZoomOutFactor = 6) {
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
}

// Riporta la vista ai limiti dati solo se l'utente ha esagerato lo zoom-out
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
// Invia ISO 8601 con timezone per evitare ambiguità di fuso orario
function toISOStringLocal(dtLocalStr) {
    // dtLocalStr è "YYYY-MM-DDTHH:MM" (datetime-local). new Date(...) interpreta come locale.
    const d = new Date(dtLocalStr);
    return d.toISOString(); // formato UTC con timezone Z
}

document.getElementById("btn_load_history").addEventListener("click", () => {
    let from = document.getElementById("hist_from").value;
    let to   = document.getElementById("hist_to").value;
    let sensors = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);

    if (!from || !to || sensors.length === 0) {
        alert("Seleziona almeno un sensore e un intervallo valido");
        return;
    }

    // reset temporaneo
    historyCustom = { labels: [], temp: [], hum: [], press: [], co2: [], tvoc: [], pm25: [] };
    chart_history_custom.data.datasets.forEach(ds => ds.data = []);
    chart_history_custom.data.labels = [];
    chart_history_custom.update();

    let req = {
        type: "get_history",
        // invia ISO string con timezone (UTC) per evitare shift
        from: toISOStringLocal(from),
        to:   toISOStringLocal(to),
        sensors: sensors
    };

    if (window.mqttClient) {
        mqttClient.publish("esp32/history/request", JSON.stringify(req));
    } else {
        alert("MQTT non connesso");
    }
});

// ===================== STORICO PACKET HANDLER =====================
function handleHistoryPacket(d) {
    // d.timestamps = [epoch_seconds,...] OR d.timestamps may be ISO strings depending on server.
    // Support both: if numeric -> epoch seconds; if string -> Date parse.
    if (!d.done) {
        const newLabels = (d.timestamps || []).map(t => {
            if (typeof t === 'number') return new Date(t * 1000);
            return new Date(t);
        });
        historyCustom.labels.push(...newLabels);

        const keys = ["temp","hum","press","co2","tvoc","pm25"];
        keys.forEach(key => {
            if (!historyCustom[key]) historyCustom[key] = [];
            if (d.data && d.data[key]) {
                historyCustom[key].push(...d.data[key]);
            } else {
                for (let i = 0; i < newLabels.length; i++) historyCustom[key].push(null);
            }
        });
        return;
    }

    // finalize: ensure lengths match
    const keys = ["temp","hum","press","co2","tvoc","pm25"];
    keys.forEach(key => {
        while (historyCustom[key].length < historyCustom.labels.length) historyCustom[key].push(null);
    });

    // populate datasets as {x:Date, y:value}
    chart_history_custom.data.datasets.forEach(ds => {
        const key = ds.label;
        ds.data = historyCustom.labels.map((t, i) => {
            const v = historyCustom[key][i];
            return v === null ? { x: t, y: null } : { x: t, y: v };
        });
    });

    updateYAxisRangeHistory();
    updateZoomLimitsForChart(chart_history_custom, 6);

    if (historyCustom.labels.length > 0) {
        const minX = historyCustom.labels[0];
        const maxX = historyCustom.labels[historyCustom.labels.length - 1];
        if (chart_history_custom.resetZoom) chart_history_custom.resetZoom();
        // non forzare la vista se non necessario; impostiamo limiti plugin e poi clamp se serve
        chart_history_custom.options.scales.x.min = minX;
        chart_history_custom.options.scales.x.max = maxX;
    }

    chart_history_custom.update();
}


