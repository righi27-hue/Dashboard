// worker.js
function downsampleArray(values, targetLen) {
  if (!Array.isArray(values)) return [];
  const n = values.length;
  if (n <= targetLen) return values.slice();
  const out = new Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.floor(i * n / targetLen);
    out[i] = values[idx] === null ? null : values[idx];
  }
  return out;
}

self.onmessage = function(e) {
  const { payloadStr, targetSamples } = e.data;
  try {
    console.time('worker_parse');
    const obj = JSON.parse(payloadStr);
    console.timeEnd('worker_parse');

    const ts = obj.timestamps || [];
    const data = obj.data || {};
    const target = Math.max(1, targetSamples || 1500);

    const result = {
      timestamps: downsampleArray(ts, target),
      temp: downsampleArray(data.temp || [], target),
      hum:  downsampleArray(data.hum  || [], target),
      press:downsampleArray(data.press|| [], target),
      co2:  downsampleArray(data.co2  || [], target),
      tvoc: downsampleArray(data.tvoc || [], target),
      pm25: downsampleArray(data.pm25 || [], target),
      chunkId: obj.chunkId || 0,
      done: !!obj.done
    };

    self.postMessage({ ok: true, data: result });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};