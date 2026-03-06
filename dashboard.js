// dashboard.js - ripartenza pulita (patch essenziali + debug)
// - evita wrap-around (segment hide su gap)
// - parsing timestamp robusto (epoch sec/ms, ISO senza timezone -> UTC)
// - storico richieste in epoch UTC
// - zoom wheel on-focus, molto dolce
// - retry avvio MQTT con log DEBUG
// - protezioni minime DOM/Chart

Chart.defaults.locale = 'it-IT';

const fmtTime24 = new Intl.DateTimeFormat('it-IT', {
  year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
});
const fmtTimeOnly24 = new Intl.DateTimeFormat('it-IT', {
  hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
});

function safeGetEl(id){ try { return document.getElementById(id) || null; } catch(e){ return null; } }

// ===================== GAUGES =====================
function createGauge(ctx, color){
  if(!ctx) return null;
  return new Chart(ctx, {
    type:'doughnut',
    data:{ labels:['Valore','Restante'], datasets:[{ data:[0,100], backgroundColor:[color,'#333'], borderWidth:0 }]},
    options:{ cutout:'70%', animation:{duration:200}, plugins:{legend:{display:false}}}
  });
}

let g_co2 = createGauge(safeGetEl('g_co2'), '#ff5252');
let g_tvoc = createGauge(safeGetEl('g_tvoc'), '#ffa726');
let g_pm25 = createGauge(safeGetEl('g_pm25'), '#ab47bc');
let g_aiq = createGauge(safeGetEl('g_aiq'), '#00e676');
let g_temp = createGauge(safeGetEl('g_temp'), '#29b6f6');
let g_hum = createGauge(safeGetEl('g_hum'), '#fdd835');
let g_press = createGauge(safeGetEl('g_press'), '#66bb6a');

let MAX_POINTS = 300;
let historyData = { labels:[], temp:[], hum:[], press:[], co2:[], tvoc:[], pm25:[] };
let historyCustom = { labels:[], temp:[], hum:[], press:[], co2:[], tvoc:[], pm25:[] };

const sensorColors = { temp:'#29b6f6', hum:'#fdd835', press:'#66bb6a', co2:'#ff5252', tvoc:'#ffa726', pm25:'#ab47bc' };
const GAP_THRESHOLD_MS = 1000 * 60 * 5; // 5 minuti

// ===================== ZOOM OPTIONS =====================
const commonZoomOptions = {
  zoom: {
    wheel: { enabled: false, speed: 0.008 },
    pinch: { enabled: true, speed: 0.02 },
    drag: { enabled: false },
    mode: 'x',
    limits: { x: { minRange: 1000*10, maxRange: Number.MAX_SAFE_INTEGER } }
  },
  pan: { enabled: true, mode: 'x', threshold: 10 }
};

// ===================== TIMESTAMP PARSER =====================
function parseTimestampToDate(t){
  if (typeof t === 'number'){
    if (t > 1e12) return new Date(t);
    if (t > 1e9) return new Date(t * 1000);
    return new Date(t * 1000);
  }
  if (typeof t === 'string'){
    if (/^\d+$/.test(t)) return parseTimestampToDate(Number(t));
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) return new Date(t + 'Z');
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d;
    return new Date(t.replace(' ', 'T'));
  }
  return null;
}

// ===================== GAP SEGMENT CALLBACK =====================
function segmentHideIfGap(ctx){
  if (!ctx || !ctx.dataset) return ctx && ctx.dataset ? ctx.dataset.borderColor || 'rgba(0,0,0,0)' : 'rgba(0,0,0,0)';
  if (!ctx.p0 || !ctx.p1) return ctx.dataset.borderColor || 'rgba(0,0,0,0)';
  const t0 = (ctx.p0.parsed && ctx.p0.parsed.x) ? new Date(ctx.p0.parsed.x).getTime() : NaN;
  const t1 = (ctx.p1.parsed && ctx.p1.parsed.x) ? new Date(ctx.p1.parsed.x).getTime() : NaN;
  if (isNaN(t0) || isNaN(t1)) return ctx.dataset.borderColor || 'rgba(0,0,0,0)';
  return (Math.abs(t1 - t0) > GAP_THRESHOLD_MS) ? 'rgba(0,0,0,0)' : (ctx.dataset.borderColor || 'rgba(0,0,0,0)');
}

// ===================== BUILD CHARTS =====================
function buildCharts(){
  const cLive = safeGetEl('chart_history');
  const cHist = safeGetEl('chart_history_custom');

  window.chart_history = new Chart(cLive, {
    type:'line',
    data:{ datasets:[
      { label:'temp', borderColor:sensorColors.temp, data:[], tension:0.3, hidden:false, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'hum', borderColor:sensorColors.hum, data:[], tension:0.3, hidden:false, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'press', borderColor:sensorColors.press, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'co2', borderColor:sensorColors.co2, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'tvoc', borderColor:sensorColors.tvoc, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'pm25', borderColor:sensorColors.pm25, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} }
    ]},
    options:{
      animation:{duration:150},
      scales:{
        x:{ type:'time', time:{ tooltipFormat:'yyyy-MM-dd HH:mm:ss', displayFormats:{ second:'HH:mm:ss', minute:'HH:mm', hour:'HH:mm' } },
            ticks:{ color:'#aaa', callback:function(value){ try{ const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value)); return fmtTimeOnly24.format(t);}catch(e){return value;}} } },
        y:{ ticks:{ color:'#aaa' } }
      },
      plugins:{ tooltip:{ callbacks:{ title:(items)=>{ const raw = items[0].parsed.x; const dt = raw instanceof Date ? raw : new Date(raw); return fmtTime24.format(dt); }, label:(item)=> item.dataset.label.toUpperCase()+': '+item.formattedValue } }, zoom: commonZoomOptions, legend:{ onClick:()=>{} } }
    }
  });

  if (chart_history && chart_history.canvas){
    chart_history.canvas.addEventListener('mouseenter', ()=>{ chart_history.options.plugins.zoom.zoom.wheel.enabled = true; });
    chart_history.canvas.addEventListener('mouseleave', ()=>{ chart_history.options.plugins.zoom.zoom.wheel.enabled = false; });
  }

  window.chart_history_custom = new Chart(cHist, {
    type:'line',
    data:{ datasets:[
      { label:'temp', borderColor:sensorColors.temp, data:[], tension:0.3, hidden:false, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'hum', borderColor:sensorColors.hum, data:[], tension:0.3, hidden:false, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'press', borderColor:sensorColors.press, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'co2', borderColor:sensorColors.co2, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'tvoc', borderColor:sensorColors.tvoc, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} },
      { label:'pm25', borderColor:sensorColors.pm25, data:[], tension:0.3, hidden:true, spanGaps:false, segment:{borderColor:segmentHideIfGap} }
    ]},
    options:{
      animation:{duration:0},
      scales:{
        x:{ type:'time', time:{ unit:'minute', tooltipFormat:'yyyy-MM-dd HH:mm:ss', displayFormats:{ minute:'HH:mm', hour:'HH:mm' } },
            ticks:{ color:'#aaa', callback:function(value){ try{ const t = typeof value === 'number' ? new Date(value) : new Date(this.getLabelForValue(value)); return fmtTimeOnly24.format(t);}catch(e){return value;}} } },
        y:{ ticks:{ color:'#aaa' } }
      },
      plugins:{ tooltip:{ callbacks:{ title:(items)=>{ const raw = items[0].parsed.x; const dt = raw instanceof Date ? raw : new Date(raw); return fmtTime24.format(dt); }, label:(item)=> item.dataset.label.toUpperCase()+': '+item.formattedValue } }, zoom: commonZoomOptions, legend:{ onClick:()=>{} } }
    }
  });

  if (chart_history_custom && chart_history_custom.canvas){
    chart_history_custom.canvas.addEventListener('mouseenter', ()=>{ chart_history_custom.options.plugins.zoom.zoom.wheel.enabled = true; });
    chart_history_custom.canvas.addEventListener('mouseleave', ()=>{ chart_history_custom.options.plugins.zoom.zoom.wheel.enabled = false; });
  }

  try { updateZoomLimitsForChart(chart_history, 6); updateZoomLimitsForChart(chart_history_custom, 6); } catch(e){}
}

buildCharts();

// ===================== Y AXIS HELPERS =====================
function updateYAxisRange(){
  try {
    const selected = [...document.querySelectorAll('.sensorCheck:checked')].map(c=>c.value);
    if (selected.length === 0){ delete chart_history.options.scales.y.min; delete chart_history.options.scales.y.max; chart_history.update('none'); return; }
    let allValues = [];
    chart_history.data.datasets.forEach(ds => {
      if (!selected.includes(ds.label)) return;
      ds.data.forEach(pt => { const v = (pt && typeof pt === 'object') ? pt.y : pt; if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v)); });
    });
    if (allValues.length === 0){ delete chart_history.options.scales.y.min; delete chart_history.options.scales.y.max; chart_history.update('none'); return; }
    let min = Math.min(...allValues), max = Math.max(...allValues);
    const range = Math.max((max-min), Math.abs(max)*0.05, 1), pad = range*0.06;
    chart_history.options.scales.y.min = Math.max(min - pad, 0); chart_history.options.scales.y.max = max + pad;
    chart_history.update('none');
  } catch(e){ console.warn('DEBUG updateYAxisRange failed', e); }
}

function updateYAxisRangeHistory(){
  try {
    const selected = [...document.querySelectorAll('.histCheck:checked')].map(c=>c.value);
    if (selected.length === 0){ delete chart_history_custom.options.scales.y.min; delete chart_history_custom.options.scales.y.max; chart_history_custom.update('none'); return; }
    let allValues = [];
    chart_history_custom.data.datasets.forEach(ds => {
      if (!selected.includes(ds.label)) return;
      ds.data.forEach(pt => { const v = (pt && typeof pt === 'object') ? pt.y : pt; if (v !== null && v !== undefined && !isNaN(v)) allValues.push(Number(v)); });
    });
    if (allValues.length === 0){ delete chart_history_custom.options.scales.y.min; delete chart_history_custom.options.scales.y.max; chart_history_custom.update('none'); return; }
    let min = Math.min(...allValues), max = Math.max(...allValues);
    const range = Math.max((max-min), Math.abs(max)*0.05, 1), pad = range*0.06;
    chart_history_custom.options.scales.y.min = Math.max(min - pad, 0); chart_history_custom.options.scales.y.max = max + pad;
    chart_history_custom.update('none');
  } catch(e){ console.warn('DEBUG updateYAxisRangeHistory failed', e); }
}

// ===================== MQTT + HANDLERS (DEBUG) =====================
let ignoreToggleEvents = false;

function startMQTT(){
  console.log('DEBUG: startMQTT called');
  if (typeof mqtt === 'undefined' || !mqtt) { console.warn('DEBUG: mqtt lib not found'); return; }
  try {
    window.mqttClient = mqtt.connect('wss://02164e543aa54cedb0d1c41246e8c43b.s1.eu.hivemq.cloud:8884/mqtt', {
      username: typeof MQTT_USERNAME !== 'undefined' ? MQTT_USERNAME : undefined,
      password: typeof MQTT_PASSWORD !== 'undefined' ? MQTT_PASSWORD : undefined,
      clean: true,
      reconnectPeriod: 2000
    });
  } catch(e){ console.error('DEBUG: mqtt.connect threw', e); return; }

  mqttClient.on('connect', (connack) => {
    console.log('DEBUG: mqtt connected', connack);
    updateWSStatus(true);
    mqttClient.subscribe('esp32/live', (err, granted) => console.log('DEBUG: subscribe esp32/live', err, granted));
    mqttClient.subscribe('esp32/history_chunk', (err, granted) => console.log('DEBUG: subscribe esp32/history_chunk', err, granted));
    mqttClient.subscribe('esp32/relay_state', (err, granted) => console.log('DEBUG: subscribe esp32/relay_state', err, granted));
  });

  mqttClient.on('reconnect', () => console.log('DEBUG: mqtt reconnecting'));
  mqttClient.on('close', () => { console.log('DEBUG: mqtt closed'); updateWSStatus(false); });
  mqttClient.on('offline', () => console.log('DEBUG: mqtt offline'));
  mqttClient.on('error', (err) => { console.error('DEBUG: mqtt error', err); updateWSStatus(false); });

  mqttClient.on('message', (topic, message) => {
    try {
      console.log('DEBUG: mqtt message', topic, message.toString().slice(0,200));
      const d = JSON.parse(message.toString());
      if (topic === 'esp32/live') {
        ['co2','tvoc','pm25','aiq','temp','hum','press'].forEach(k => { const el = safeGetEl(k); if (el && d[k] !== undefined) el.innerText = d[k]; });
        try{ if (g_co2) g_co2.data.datasets[0].data = [d.co2/20, 100-(d.co2/20)]; }catch(e){}
        try{ if (g_tvoc) g_tvoc.data.datasets[0].data = [d.tvoc/10, 100-(d.tvoc/10)]; }catch(e){}
        try{ if (g_pm25) g_pm25.data.datasets[0].data = [d.pm25, 100-d.pm25]; }catch(e){}
        try{ if (g_aiq){ g_aiq.data.datasets[0].backgroundColor[0] = aiqColor(d.aiq); g_aiq.data.datasets[0].data = [Math.min(d.aiq,500)/5, 100-Math.min(d.aiq,500)/5]; } }catch(e){}
        [g_co2,g_tvoc,g_pm25,g_aiq,g_temp,g_hum,g_press].forEach(g=>{ try{ g && g.update(); }catch(e){} });

        const now = new Date();
        ['temp','hum','press','co2','tvoc','pm25'].forEach(label => {
          const ds = chart_history.data.datasets.find(s => s.label === label);
          if (!ds) return;
          ds.data.push({ x: now, y: d[label] });
          if (ds.data.length > MAX_POINTS) ds.data.shift();
        });

        historyData.labels.push(now); historyData.temp.push(d.temp); historyData.hum.push(d.hum);
        historyData.press.push(d.press); historyData.co2.push(d.co2); historyData.tvoc.push(d.tvoc); historyData.pm25.push(d.pm25);
        if (historyData.labels.length > MAX_POINTS) Object.keys(historyData).forEach(k => historyData[k].shift());

        updateYAxisRange();
        updateZoomLimitsForChart(chart_history, 6);
        clampViewToDataIfNeeded(chart_history, 6);
        chart_history.update('none');
      }

      if (topic === 'esp32/history_chunk') {
        handleHistoryPacket(d);
        if (!d.done) { const ack = { chunkId: d.chunkId || 0 }; mqttClient.publish('esp32/history/ack', JSON.stringify(ack)); }
        else {
          updateZoomLimitsForChart(chart_history_custom, 6);
          updateYAxisRangeHistory();
          const bounds = getChartTimeBounds(chart_history_custom);
          if (bounds) { chart_history_custom.options.scales.x.min = new Date(bounds.min); chart_history_custom.options.scales.x.max = new Date(bounds.max); }
        }
      }

      if (topic === 'esp32/relay_state') {
        ignoreToggleEvents = true;
        const r1 = safeGetEl('relay1_toggle'), r2 = safeGetEl('relay2_toggle');
        if (r1) r1.checked = !!d.r1; if (r2) r2.checked = !!d.r2;
        ignoreToggleEvents = false;
      }
    } catch(e){ console.error('DEBUG: error handling mqtt message', e); }
  });
}

function sendRelayCommand(id, state){ if (!window.mqttClient) return; mqttClient.publish(`esp32/cmd/relay${id}`, state ? '1' : '0'); }

safeGetEl('relay1_toggle') && safeGetEl('relay1_toggle').addEventListener('change', (e)=>{ if (ignoreToggleEvents) return; sendRelayCommand(1, e.target.checked); });
safeGetEl('relay2_toggle') && safeGetEl('relay2_toggle').addEventListener('change', (e)=>{ if (ignoreToggleEvents) return; sendRelayCommand(2, e.target.checked); });

// storico request (epoch UTC)
function toEpochSecondsUTC(dtLocalStr){ const d = new Date(dtLocalStr); return Math.floor(d.getTime()/1000); }
safeGetEl('btn_load_history') && safeGetEl('btn_load_history').addEventListener('click', ()=>{
  let from = (safeGetEl('hist_from') && safeGetEl('hist_from').value) || '';
  let to = (safeGetEl('hist_to') && safeGetEl('hist_to').value) || '';
  let sensors = [...document.querySelectorAll('.histCheck:checked')].map(c=>c.value);
  if (!from || !to || sensors.length === 0){ alert('Seleziona almeno un sensore e un intervallo valido'); return; }
  historyCustom = { labels:[], temp:[], hum:[], press:[], co2:[], tvoc:[], pm25:[] };
  chart_history_custom.data.datasets.forEach(ds=>ds.data=[]); chart_history_custom.data.labels=[]; chart_history_custom.update();
  let req = { type:'get_history', from: toEpochSecondsUTC(from), to: toEpochSecondsUTC(to), sensors: sensors };
  if (window.mqttClient) mqttClient.publish('esp32/history/request', JSON.stringify(req));
  else alert('MQTT non connesso');
});

// storico packet handler
function handleHistoryPacket(d){
  if (!d || !d.timestamps) return;
  if (!d.done){
    const newLabels = (d.timestamps || []).map(t => parseTimestampToDate(t));
    historyCustom.labels.push(...newLabels);
    const keys = ['temp','hum','press','co2','tvoc','pm25'];
    keys.forEach(key => {
      if (!historyCustom[key]) historyCustom[key] = [];
      if (d.data && d.data[key]) historyCustom[key].push(...d.data[key]);
      else for (let i=0;i<newLabels.length;i++) historyCustom[key].push(null);
    });
    return;
  }
  const keys = ['temp','hum','press','co2','tvoc','pm25'];
  keys.forEach(key => { while (historyCustom[key].length < historyCustom.labels.length) historyCustom[key].push(null); });
  chart_history_custom.data.datasets.forEach(ds => {
    const key = ds.label;
    ds.data = historyCustom.labels.map((t,i) => { const v = historyCustom[key][i]; return v === null ? { x: t, y: null } : { x: t, y: v }; });
  });
  updateYAxisRangeHistory();
  updateZoomLimitsForChart(chart_history_custom, 6);
  const bounds = getChartTimeBounds(chart_history_custom);
  if (bounds) { if (chart_history_custom.resetZoom) chart_history_custom.resetZoom(); chart_history_custom.options.scales.x.min = new Date(bounds.min); chart_history_custom.options.scales.x.max = new Date(bounds.max); }
  chart_history_custom.update();
}

// websocket status
function updateWSStatus(connected){
  const el = safeGetEl('ws_status');
  if (!el) return;
  if (connected){ el.textContent = '🟢 Connesso'; el.classList.remove('ws_disconnected'); el.classList.add('ws_connected'); }
  else { el.textContent = '🔴 Disconnesso — riconnessione…'; el.classList.remove('ws_connected'); el.classList.add('ws_disconnected'); }
}

// auto start MQTT con retry
let __startAttempts = 0;
function __tryStartMQTT(){
  __startAttempts++;
  console.log('DEBUG: __tryStartMQTT attempt', __startAttempts);
  if (typeof mqtt === 'undefined'){ console.warn('DEBUG: mqtt lib not present yet. retry in 2s'); if (__startAttempts < 8) setTimeout(__tryStartMQTT, 2000); return; }
  try { startMQTT(); } catch(e){ console.error('DEBUG: startMQTT threw', e); }
}
__tryStartMQTT();

// simulation helper
window.__simulateLive = function(){
  const sample = { temp:22.5, hum:45.2, press:1012.3, co2:420, tvoc:12, pm25:3, aiq:42 };
  console.log('DEBUG: simulate live', sample);
  ['co2','tvoc','pm25','aiq','temp','hum','press'].forEach(k => { const el = safeGetEl(k); if (el) el.innerText = sample[k]; });
  try{ if (g_co2) { g_co2.data.datasets[0].data = [sample.co2/20, 100-(sample.co2/20)]; g_co2.update(); } }catch(e){}
  try{ if (g_tvoc) { g_tvoc.data.datasets[0].data = [sample.tvoc/10, 100-(sample.tvoc/10)]; g_tvoc.update(); } }catch(e){}
  try{ if (g_pm25) { g_pm25.data.datasets[0].data = [sample.pm25, 100-sample.pm25]; g_pm25.update(); } }catch(e){}
  try{ if (g_aiq) { g_aiq.data.datasets[0].backgroundColor[0] = aiqColor(sample.aiq); g_aiq.data.datasets[0].data = [Math.min(sample.aiq,500)/5, 100-Math.min(sample.aiq,500)/5]; g_aiq.update(); } }catch(e){}
  const now = new Date();
  ['temp','hum','press','co2','tvoc','pm25'].forEach(label => {
    const ds = chart_history.data.datasets.find(s => s.label === label);
    if (!ds) return;
    ds.data.push({ x: now, y: sample[label] });
    if (ds.data.length > MAX_POINTS) ds.data.shift();
  });
  updateYAxisRange(); updateZoomLimitsForChart(chart_history, 6); chart_history.update('none');
  console.log('DEBUG: simulation applied');
};
