#pragma once

const char DASHBOARD_CSS[] PROGMEM = R"rawliteral(
body {
    background: #121212;
    color: #e0e0e0;
    font-family: "Segoe UI", sans-serif;
    margin: 0;
    padding: 10px;
}

#chart_history,
#chart_history_custom {
    max-height: 600px;
}

h2 {
    text-align: center;
    margin: 6px 0;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
}

.card {
    background: #1e1e1e;
    padding: 8px;
    border-radius: 10px;
    text-align: center;
}

.icon { font-size: 32px; margin-bottom: 4px; }
.value { font-size: 22px; font-weight: bold; }
.gauge { width: 90px; height: 90px; margin: auto; }

.selector {
    text-align:center;
    margin-bottom:8px;
}
.selector label {
    margin-right: 8px;
    cursor: pointer;
}
.selector label span {
    color: #e0e0e0;
}

.ws_status {
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: bold;
    color: #fff;
    z-index: 9999;
    opacity: 0.85;
}
.ws_connected { background: #2ecc71; }
.ws_disconnected { background: #e74c3c; }

/* RELAY */
.relay-row-dual {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    background: #1e1e1e;
    padding: 6px 10px;
    border-radius: 10px;
    margin-bottom: 10px;
}
.relay-item {
    display: flex;
    align-items: center;
    flex: 1;
    gap: 6px;
}
.relay-icon {
    font-size: 22px;
    color: #29b6f6;
}
.relay-label {
    font-size: 16px;
    font-weight: 500;
    flex-grow: 1;
}
.switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 26px;
}
.switch input { display: none; }
.slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0;
    right: 0; bottom: 0;
    background-color: #555;
    transition: .3s;
    border-radius: 26px;
}
.slider:before {
    position: absolute;
    content: "";
    height: 20px; width: 20px;
    left: 3px; bottom: 3px;
    background-color: white;
    transition: .3s;
    border-radius: 50%;
}
input:checked + .slider {
    background-color: #29b6f6;
}
input:checked + .slider:before {
    transform: translateX(24px);
}
)rawliteral";