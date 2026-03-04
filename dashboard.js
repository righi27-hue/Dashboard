// ===================== GAUGE CREATOR =====================
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

// ===================== CREAZIONE GAUGE =====================
let g_co2, g_tvoc, g_pm25, g_aiq, g_temp, g_hum, g_press;

// DOM già pronto (dashboard.js caricato normalmente)
g_co2  = createGauge(document.getElementById("g_co2"),  "#ff5252");
g_tvoc = createGauge(document.getElementById("g_tvoc"), "#ffa726");
g_pm25 = createGauge(document.getElementById("g_pm25"), "#ab47bc");
g_aiq  = createGauge(document.getElementById("g_aiq"),  "#00e676");
g_temp = createGauge(document.getElementById("g_temp"), "#29b6f6");
g_hum  = createGauge(document.getElementById("g_hum"),  "#fdd835");
g_press= createGauge(document.getElementById("g_press"),"#66bb6a");

// ===================== LIVE HISTORY DATA =====================
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

// ===================== LIVE CHART =====================
let chart_history = new Chart(document.getElementById("chart_history"), {
    type: 'line',
    data: {
        labels: historyData.labels,
        datasets: [
            { label:"temp",  borderColor:sensorColors.temp,  data:historyData.temp,  tension:0.3, hidden:false },
            { label:"hum",   borderColor:sensorColors.hum,   data:historyData.hum,   tension:0.3, hidden:false },
            { label:"press", borderColor:sensorColors.press, data:historyData.press, tension:0.3, hidden:true },
            { label:"co2",   borderColor:sensorColors.co2,   data:historyData.co2,   tension:0.3, hidden:true },
            { label:"tvoc",  borderColor:sensorColors.tvoc,  data:historyData.tvoc,  tension:0.3, hidden:true },
            { label:"pm25",  borderColor:sensorColors.pm25,  data:historyData.pm25,  tension:0.3, hidden:true }
        ]
    },
    options: {
        animation: { duration: 150 },
        scales: {
            x: { ticks: { color: "#aaa" } },
            y: { ticks: { color: "#aaa" } }
        },
        plugins: {
            tooltip: {
                callbacks: {
                    title: (items) => "Ora: " + items[0].label,
                    label: (item) => item.dataset.label.toUpperCase() + ": " + item.formattedValue
                }
            },
            zoom: {
                zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    mode: 'x',
                    limits: { x: { minRange: 20 } }
                },
                pan: { enabled: true, mode: 'x' }
            },
            legend: { onClick: () => {} }
        }
    }
});

// ===================== LIVE Y RANGE =====================
function updateYAxisRange() {
    let selected = [...document.querySelectorAll(".sensorCheck:checked")].map(c => c.value);
    if (selected.length === 0) return;

    let min = Infinity;
    let max = -Infinity;

    selected.forEach(s => {
        min = Math.min(min, sensorRanges[s].min);
        max = Math.max(max, sensorRanges[s].max);
    });

    chart_history.options.scales.y.min = min;
    chart_history.options.scales.y.max = max;
    chart_history.update('none');
}

// ===================== CHECKBOX LIVE =====================
document.querySelectorAll(".sensorCheck").forEach(chk => {
    chk.addEventListener("change", () => {
        chart_history.data.datasets.forEach(ds => {
            ds.hidden = !document.querySelector(`input[value="${ds.label}"]`).checked;
        });
        updateYAxisRange();
        chart_history.update();
    });
});

// ===================== STORICO CUSTOM DATA =====================
let historyCustom = {
    labels: [],
    temp: [],
    hum: [],
    press: [],
    co2: [],
    tvoc: [],
    pm25: []
};

// ===================== STORICO CUSTOM CHART =====================
let chart_history_custom = new Chart(document.getElementById("chart_history_custom"), {
    type: 'line',
    data: {
        labels: historyCustom.labels,
        datasets: [
            { label:"temp",  borderColor:sensorColors.temp,  data:historyCustom.temp,  tension:0.3, hidden:false },
            { label:"hum",   borderColor:sensorColors.hum,   data:historyCustom.hum,   tension:0.3, hidden:false },
            { label:"press", borderColor:sensorColors.press, data:historyCustom.press, tension:0.3, hidden:true },
            { label:"co2",   borderColor:sensorColors.co2,   data:historyCustom.co2,   tension:0.3, hidden:true },
            { label:"tvoc",  borderColor:sensorColors.tvoc,  data:historyCustom.tvoc,  tension:0.3, hidden:true },
            { label:"pm25",  borderColor:sensorColors.pm25,  data:historyCustom.pm25,  tension:0.3, hidden:true }
        ]
    },
    options: {
        animation: { duration: 0 },
        scales: {
            x: {
                type: "time",
                time: { unit: "minute" },
                ticks: { color: "#aaa" }
            },
            y: { ticks: { color: "#aaa" } }
        },
        plugins: {
            tooltip: {
                callbacks: {
                    title: (items) => {
                        let d = items[0].raw;
                        return d instanceof Date ? d.toLocaleString() : items[0].label;
                    },
                    label: (item) => item.dataset.label.toUpperCase() + ": " + item.formattedValue
                }
            },
            legend: { onClick: () => {} },
            zoom: {
                zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    mode: 'x',
                    limits: { x: { minRange: 20 } }
                },
                pan: { enabled: true, mode: 'x' }
            }
        }
    }
});

// ===================== CHECKBOX STORICO =====================
document.querySelectorAll(".histCheck").forEach(chk => {
    chk.addEventListener("change", () => {
        chart_history_custom.data.datasets.forEach(ds => {
            ds.hidden = !document.querySelector(`.histCheck[value="${ds.label}"]`).checked;
        });
        chart_history_custom.update();
    });
});

// ===================== SMOOTH MODE =====================
document.getElementById("smooth_mode").addEventListener("change", (e) => {
    let smooth = e.target.checked;
    chart_history_custom.data.datasets.forEach(ds => {
        ds.spanGaps = smooth;
    });
    chart_history_custom.update();
});

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
// ===================== AIQ COLOR SCALE =====================
function aiqColor(v) {
    if (v <= 50)  return "#00e676";
    if (v <= 100) return "#cddc39";
    if (v <= 150) return "#ffb300";
    if (v <= 200) return "#ff7043";
    return "#d32f2f";
}

// ===================== MQTT CLOUD CONNECTION =====================
let ignoreToggleEvents = false;
let expectedChunkId = 0;

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
        try { d = JSON.parse(message.toString()); }
        catch { return; }

        // ===== LIVE DATA =====
        if (topic === "esp32/live") {

            document.getElementById("co2").innerText  = d.co2;
            document.getElementById("tvoc").innerText = d.tvoc;
            document.getElementById("pm25").innerText = d.pm25;
            document.getElementById("aiq").innerText  = d.aiq;
            document.getElementById("temp").innerText = d.temp;
            document.getElementById("hum").innerText  = d.hum;
            document.getElementById("press").innerText= d.press;

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

            let now = new Date();
            let timeStr = now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            historyData.labels.push(timeStr);
            historyData.temp.push(d.temp);
            historyData.hum.push(d.hum);
            historyData.press.push(d.press);
            historyData.co2.push(d.co2);
            historyData.tvoc.push(d.tvoc);
            historyData.pm25.push(d.pm25);

            if (historyData.labels.length > MAX_POINTS) {
                Object.keys(historyData).forEach(k => historyData[k].shift());
            }

            updateYAxisRange();
            chart_history.update();
            return;
        }

        // ===== STORICO CHUNK =====
        if (topic === "esp32/history_chunk") {

            handleHistoryPacket(d);

            if (!d.done) {
                const ack = { chunkId: d.chunkId || 0 };
                mqttClient.publish("esp32/history/ack", JSON.stringify(ack));
            }

            return;
        }

        // ===== RELAY STATE =====
        if (topic === "esp32/relay_state") {

            ignoreToggleEvents = true;

            document.getElementById("relay1_toggle").checked = d.r1;
            document.getElementById("relay2_toggle").checked = d.r2;

            ignoreToggleEvents = false;
            return;
        }
    });
}

// ===================== RELAY COMMAND =====================
function sendRelayCommand(id, state) {
    mqttClient.publish(`esp32/cmd/relay${id}`, state ? "1" : "0");
}

// ===================== RELAY LISTENERS =====================
document.getElementById("relay1_toggle").addEventListener("change", (e) => {
    if (ignoreToggleEvents) return;
    sendRelayCommand(1, e.target.checked);
});

document.getElementById("relay2_toggle").addEventListener("change", (e) => {
    if (ignoreToggleEvents) return;
    sendRelayCommand(2, e.target.checked);
});

// ===================== RANGE Y STORICO =====================
function updateYAxisRangeHistory() {
    let selected = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);
    if (selected.length === 0) return;

    let min = Infinity;
    let max = -Infinity;

    selected.forEach(s => {
        min = Math.min(min, sensorRanges[s].min);
        max = Math.max(max, sensorRanges[s].max);
    });

    chart_history_custom.options.scales.y.min = min;
    chart_history_custom.options.scales.y.max = max;
}

// ===================== STORICO CUSTOM REQUEST =====================
function toEpochSecondsLocal(dtLocalStr) {
    return Math.floor(new Date(dtLocalStr).getTime() / 1000);
}

document.getElementById("btn_load_history").addEventListener("click", () => {
    let from = document.getElementById("hist_from").value;
    let to   = document.getElementById("hist_to").value;
    let sensors = [...document.querySelectorAll(".histCheck:checked")].map(c => c.value);

    if (!from || !to || sensors.length === 0) {
        alert("Seleziona almeno un sensore e un intervallo valido");
        return;
    }

    historyCustom = {
        labels: [],
        temp: [],
        hum: [],
        press: [],
        co2: [],
        tvoc: [],
        pm25: []
    };

    chart_history_custom.data.labels = [];
    chart_history_custom.data.datasets.forEach(ds => ds.data = []);
    chart_history_custom.update();

    let req = {
        type: "get_history",
        from: toEpochSecondsLocal(from),
        to:   toEpochSecondsLocal(to),
        sensors: sensors
    };

    mqttClient.publish("esp32/history/request", JSON.stringify(req));
});

// ===================== STORICO PACKET HANDLER =====================
function handleHistoryPacket(d) {

    if (!d.done) {

        const newLabels = d.timestamps.map(t => new Date(t * 1000));
        historyCustom.labels.push(...newLabels);

        const keys = ["temp","hum","press","co2","tvoc","pm25"];

        keys.forEach(key => {

            if (!historyCustom[key]) historyCustom[key] = [];

            if (d.data && d.data[key]) {
                historyCustom[key].push(...d.data[key]);
            } else {
                for (let i = 0; i < newLabels.length; i++) {
                    historyCustom[key].push(null);
                }
            }
        });

        return;
    }

    const keys = ["temp","hum","press","co2","tvoc","pm25"];

    keys.forEach(key => {
        while (historyCustom[key].length < historyCustom.labels.length) {
            historyCustom[key].push(null);
        }
    });

    chart_history_custom.data.labels = historyCustom.labels;

    chart_history_custom.data.datasets.forEach(ds => {
        ds.data = historyCustom[ds.label];
    });

    updateYAxisRangeHistory();

    if (historyCustom.labels.length > 0) {
        const minX = historyCustom.labels[0];
        const maxX = historyCustom.labels[historyCustom.labels.length - 1];

        if (chart_history_custom.resetZoom) {
            chart_history_custom.resetZoom();
        }

        chart_history_custom.options.scales.x.min = minX;
        chart_history_custom.options.scales.x.max = maxX;
    }

    chart_history_custom.update();
}
