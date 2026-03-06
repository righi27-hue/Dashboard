// dashboard.js - versione ripartita dalla tua originale e corretta
// Correzioni principali:
// - parsing timestamp robusto (supporta epoch sec/ms e ISO, tratta ISO senza timezone come UTC)
// - storico richieste inviate come epoch seconds UTC (evita shift di 6 ore)
// - segment callback robusto per evitare "wrap-around" (non unisce parti distanti)
// - zoom wheel molto meno sensibile e attivo solo on-focus
// - startMQTT() invocato automaticamente all'avvio
// - protezioni sui DOM element mancanti per evitare silent fail

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

// Protezione: se gli elementi non esistono, non crashare
function safeGetEl(id) { return document.getElementById(id) || null; }

g_co2  = createGauge(safeGetEl("g_co2"),  "#ff5252");
g_tvoc = createGauge(safeGetEl("g_tvoc"), "#ffa726");
g_pm25 = createGauge(safeGetEl("g_pm25"), "#ab47bc");
g_aiq  = createGauge(safeGetEl("g_aiq"),  "#00e676");
g_temp = createGauge(safeGetEl("g_temp"), "#29b6f6");
g_hum  = createGauge(safeGetEl("g_hum"),  "#fdd835");
g_press= createGauge(safeGetEl("g_press"),"#66bb6a");

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
// Wheel speed molto dolce; wheel abilitato solo on-focus
const commonZoomOptions = {
    zoom: {
        wheel: { enabled: false, speed: 0.008 },
        pinch: { enabled: true, speed: 0.02 },
        drag: { enabled: false },
        mode: 'x',
        limits: { x: { minRange: 1000 * 10, maxRange: Number.MAX_SAFE_INTEGER } }
    },
    pan: { enabled: true, mode: 'x', threshold: 10 }
};

// ===================== HELPERS TIMESTAMP / ZOOM / SEGMENT =====================
// Parsing robusto dei timestamp: supporta epoch seconds, epoch ms, ISO con/ senza timezone
function parseTimestampToDate(t) {
    if (typeof t === 'number') {
        if (t > 1e12) return new Date(t);        // ms
        if (t > 1e9)  return new Date(t * 1000); // seconds -> ms
        return new Date(t * 1000);
    }
    if (typeof t === 'string') {
        if (/^\d+$/.test(t)) return parseTimestampToDate(Number(t));
        // Se la stringa ISO non contiene timezone (es. "2026-03-05T12:00:00"), trattala come UTC
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) return new Date(t + 'Z');
        const d = new Date(t);
        if (!isNaN(d.getTime())) return d;
        return new Date(t.replace(' ', 'T'));
    }
    return null;
}

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

// Applica limiti plugin senza forzare la vista utente
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
    // protezione: chart.scales.x potrebbe non essere ancora inizializzato
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
}

// Gap threshold: se due punti sono separati da più di gapMs, non disegnare il segmento
const GAP_THRESHOLD_MS = 1000 * 60 * 5; // 5 minuti

function segmentHideIfGap(ctx) {
    // Protezioni: ctx, dataset e punti potrebbero non essere definiti in alcuni momenti
    if (!ctx || !ctx.dataset) return (ctx && ctx.dataset) ? ctx.dataset.borderColor || 'rgba(0,0,0,0)' : 'rgba(0,0,0,0)';
    if (!ctx.p0 || !ctx.p1) return ctx.dataset.borderColor || 'rgba(0,0,0,0)';
    const t0 = (ctx.p0.parsed && ctx.p0.parsed.x) ? new Date(ctx.p0.parsed.x).getTime() : NaN;
    const t1 = (ctx.p1.parsed && ctx.p1.parsed.x) ? new Date(ctx.p1.parsed.x).getTime() : NaN;
    if (isNaN(t0) || isNaN(t1)) return ctx.dataset.borderColor || 'rgba(0,0,0,0)';
    return (Math.abs(t1 - t0) > GAP_THRESHOLD_MS) ? 'rgba(0,0,0,0)' : (ctx.dataset.borderColor || 'rgba(0,0,0,0)');
}

// ===================== CHARTS CONFIG =====================
// LIVE CHART
let chart_history = new Chart(document.getElementById("chart_history"), {
    type: 'line',
    data: {
        datasets: [
            { label:"temp",  borderColor:sensorColors.temp,  data:[],  tension:0.3, hidden:false, spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"hum",   borderColor:sensorColors.hum,   data:[],  tension:0.3, hidden:false, spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"press", borderColor:sensorColors.press, data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"co2",   borderColor:sensorColors.co2,   data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"tvoc",  borderColor:sensorColors.tvoc,  data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"pm25",  borderColor:sensorColors.pm25,  data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} }
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

// Attiva/disattiva zoom wheel solo quando il mouse è sopra il canvas (comportamento "on focus")
if (chart_history && chart_history.canvas) {
    chart_history.canvas.addEventListener('mouseenter', () => { chart_history.options.plugins.zoom.zoom.wheel.enabled = true; });
    chart_history.canvas.addEventListener('mouseleave', () => { chart_history.options.plugins.zoom.zoom.wheel.enabled = false; });
}

// STORICO CUSTOM CHART
let chart_history_custom = new Chart(document.getElementById("chart_history_custom"), {
    type: 'line',
    data: {
        datasets: [
            { label:"temp",  borderColor:sensorColors.temp,  data:[],  tension:0.3, hidden:false, spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"hum",   borderColor:sensorColors.hum,   data:[],  tension:0.3, hidden:false, spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"press", borderColor:sensorColors.press, data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"co2",   borderColor:sensorColors.co2,   data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"tvoc",  borderColor:sensorColors.tvoc,  data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} },
            { label:"pm25",  borderColor:sensorColors.pm25,  data:[],  tension:0.3, hidden:true,  spanGaps:false, segment:{borderColor: segmentHideIfGap} }
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

// Attiva/disattiva zoom wheel solo quando il mouse è sopra il canvas (comportamento "on focus")
if (chart_history_custom && chart_history_custom.canvas) {
    chart_history_custom.canvas.addEventListener('mouseenter', () => { chart_history_custom.options.plugins.zoom.zoom.wheel.enabled = true; });
    chart_history_custom.canvas.addEventListener('mouseleave', () => { chart_history_custom.options.plugins.zoom.zoom.wheel.enabled = false; });
}

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

document.getElementById("smooth_mode") && document.getElementById("smooth_mode").addEventListener("change", (e) => {
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
    // Protezione: verifica che mqtt sia disponibile
    if (typeof mqtt === 'undefined' || !mqtt) {
        console.warn("MQTT library non trovata. Assicurati che mqtt.min.js sia caricato prima di dashboard.js");
        return;
    }

    window.mqttClient = mqtt.connect("wss://02164e543aa54cedb0d1c41246e8c43b.s1.eu.hivemq.cloud:8884/mqtt", {
        username: typeof MQTT_USERNAME !== 'undefined' ? MQTT_USERNAME : undefined,
        password: typeof MQTT_PASSWORD !== 'undefined' ? MQTT_PASSWORD : undefined,
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
    mqttClient.on("error", (err) => {
        console.error("MQTT error:", err);
        updateWSStatus(false);
    });

    mqttClient.on("message", (topic, message) => {
        let d;
        try { d = JSON.parse(message.toString()); } catch { return; }

        if (topic === "esp32/live") {
            // update DOM (con protezione)
            const elMap = { co2: 'co2', tvoc: 'tvoc', pm25: 'pm25', aiq: 'aiq', temp: 'temp', hum: 'hum', press: 'press' };
            Object.keys(elMap).forEach(k => {
                const el = document.getElementById(elMap[k]);
                if (el && d[k] !== undefined) el.innerText = d[k];
            });

            // gauges (protezione: verifica esistenza)
            if (g_co2 && g_co2.data && g_co2.data.datasets) g_co2.data.datasets[0].data  = [d.co2/20, 100-(d.co2/20)];
            if (g_tvoc && g_tvoc.data && g_tvoc.data.datasets) g_tvoc.data.datasets[0].data = [d.tvoc/10, 100-(d.tvoc/10)];
            if (g_pm25 && g_pm25.data && g_pm25.data.datasets) g_pm25.data.datasets[0].data = [d.pm25, 100-d.pm25];

            let aiqVal = Math.min(d.aiq, 500) / 5;
            let aiqCol = aiqColor(d.aiq);
            if (g_aiq && g_aiq.data && g_aiq.data.datasets) {
                g_aiq.data.datasets[0].backgroundColor[0] = aiqCol;
                g_aiq.data.datasets[0].data = [aiqVal, 100 - aiqVal];
            }

            if (g_temp && g_temp.data && g_temp.data.datasets) g_temp.data.datasets[0].data = [d.temp, 100-d.temp];
            if (g_hum && g_hum.data && g_hum.data.datasets) g_hum.data.datasets[0].data  = [d.hum, 100-d.hum];
            if (g_press && g_press.data && g_press.data.datasets) g_press.data.datasets[0].data= [(d.press-980)/0.4, 100-((d.press-980)/0.4)];

            // aggiorna gauges (protezione)
            [g_co2,g_tvoc,g_pm25,g_aiq,g_temp,g_hum,g_press].forEach(g => { try { g && g.update(); } catch(e){} });

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

            // aggiorna scala Y e limiti zoom plugin (non forzare vista)
            updateYAxisRange();
            updateZoomLimitsForChart(chart_history, 6);
            // clamp solo se la vista è davvero fuori controllo
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
                // quando lo storico è completo, aggiorna limiti plugin e scala Y e fissa la vista sui dati
                updateZoomLimitsForChart(chart_history_custom, 6);
                updateYAxisRangeHistory();
                const bounds = getChartTimeBounds(chart_history_custom);
                if (bounds) {
                    chart_history_custom.options.scales.x.min = new Date(bounds.min);
                    chart_history_custom.options.scales.x.max = new Date(bounds.max);
                }
            }
            return;
        }

        if (topic === "esp32/relay_state") {
            ignoreToggleEvents = true;
            const r1 = safeGetEl("relay1_toggle");
            const r2 = safeGetEl("relay2_toggle");
            if (r1) r1.checked = !!d.r1;
            if (r2) r2.checked = !!d.r2;
            ignoreToggleEvents = false;
            return;
        }
    });
}

function sendRelayCommand(id, state) {
    if (!window.mqttClient) return;
    mqttClient.publish(`esp32/cmd/relay${id}`, state ? "1" : "0");
}

safeGetEl("relay1_toggle") && safeGetEl("relay1_toggle").addEventListener("change", (e) => {
    if (ignoreToggleEvents) return;
    sendRelayCommand(1, e.target.checked);
});
safeGetEl("relay2_toggle") && safeGetEl("relay2_toggle").addEventListener("change", (e) => {
    if (ignoreToggleEvents) return;
    sendRelayCommand(2, e.target.checked);
});

// ===================== STORICO REQUEST / HELPERS =====================
// Invia epoch seconds UTC per evitare ambiguità di fuso orario
function toEpochSecondsUTC(dtLocalStr) {
    const d = new Date(dtLocalStr);
    return Math.floor(d.getTime() / 1000);
}

safeGetEl("btn_load_history") && safeGetEl("btn_load_history").addEventListener("click", () => {
    let from = (safeGetEl("hist_from") && safeGetEl("hist_from").value) || '';
    let to   = (safeGetEl("hist_to") && safeGetEl("hist_to").value) || '';
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
        from: toEpochSecondsUTC(from),
        to:   toEpochSecondsUTC(to),
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
    // protezione: se payload non valido, esci
    if (!d || !d.timestamps) return;

    // d.timestamps può essere epoch seconds, ms o ISO strings
    if (!d.done) {
        const newLabels = (d.timestamps || []).map(t => parseTimestampToDate(t));
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

    // fissa la vista ai limiti dati (solo dopo che lo storico è completo)
    const bounds = getChartTimeBounds(chart_history_custom);
    if (bounds) {
        if (chart_history_custom.resetZoom) chart_history_custom.resetZoom();
        chart_history_custom.options.scales.x.min = new Date(bounds.min);
        chart_history_custom.options.scales.x.max = new Date(bounds.max);
    }

    chart_history_custom.update();
}

// ===================== Avvio automatico MQTT (se possibile) =====================
try {
    // Chiamiamo startMQTT se la funzione è definita e la libreria mqtt è disponibile
    if (typeof startMQTT === 'function') {
        startMQTT();
    }
} catch (e) {
    console.warn("Impossibile avviare startMQTT automaticamente:", e);
}
