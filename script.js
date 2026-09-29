// ============================================================
// OBD-II Scanner - Complete Logic
// ============================================================

const OBD_UUIDS = {
    services: [
        '0000fff0-0000-1000-8000-00805f9b34fb',
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        '000018f0-0000-1000-8000-00805f9b34fb'
    ]
};

const LIVE_PIDS = [
    { pid: '010C', name: 'دورات المحرك', icon: '⚙️', unit: 'RPM', bytes: 2, decode: d => Math.round(((d[0] * 256) + d[1]) / 4), warn: 5000, danger: 6500 },
    { pid: '010D', name: 'السرعة', icon: '🏎️', unit: 'km/h', bytes: 1, decode: d => d[0], warn: 130, danger: 180 },
    { pid: '0105', name: 'حرارة المحرك', icon: '🌡️', unit: '°C', bytes: 1, decode: d => d[0] - 40, warn: 100, danger: 110 },
    { pid: '0104', name: 'حمل المحرك', icon: '📊', unit: '%', bytes: 1, decode: d => Math.round((d[0] * 100) / 255), warn: 80, danger: 95 },
    { pid: '0111', name: 'موضع الخانق', icon: '🎚️', unit: '%', bytes: 1, decode: d => Math.round((d[0] * 100) / 255), warn: 90, danger: 100 },
    { pid: '010F', name: 'حرارة الهواء', icon: '❄️', unit: '°C', bytes: 1, decode: d => d[0] - 40, warn: 60, danger: 75 },
    { pid: '010B', name: 'ضغط المشعب', icon: '💨', unit: 'kPa', bytes: 1, decode: d => d[0], warn: 200, danger: 240 },
    { pid: '0110', name: 'تدفق الهواء', icon: '🌬️', unit: 'g/s', bytes: 2, decode: d => ((d[0] * 256) + d[1]) / 100, warn: 100, danger: 150 },
    { pid: '0142', name: 'جهد الوحدة', icon: '🔋', unit: 'V', bytes: 2, decode: d => (((d[0] * 256) + d[1]) / 1000).toFixed(2), warn: 12.5, danger: 11.8, lowWarn: true },
    { pid: '0106', name: 'ضبط الوقود S1', icon: '⛽', unit: '%', bytes: 1, decode: d => (((d[0] - 128) * 100) / 128).toFixed(1), warn: 15, danger: 22 },
    { pid: '0107', name: 'ضبط الوقود L1', icon: '⛽', unit: '%', bytes: 1, decode: d => (((d[0] - 128) * 100) / 128).toFixed(1), warn: 15, danger: 22 },
    { pid: '010E', name: 'توقيت الإشعال', icon: '⏱️', unit: '°', bytes: 1, decode: d => (d[0] / 2) - 64, warn: 40, danger: 50 }
];

const EXTRA_SENSORS = [
    { pid: '0114', name: 'O2 Bank1 S1', decode: d => (d[0] / 200).toFixed(2) + ' V', bytes: 2 },
    { pid: '0115', name: 'O2 Bank1 S2', decode: d => (d[0] / 200).toFixed(2) + ' V', bytes: 2 },
    { pid: '0116', name: 'O2 Bank2 S1', decode: d => (d[0] / 200).toFixed(2) + ' V', bytes: 2 },
    { pid: '0121', name: 'مسافة MIL', decode: d => ((d[0] * 256) + d[1]) + ' km', bytes: 2 },
    { pid: '012F', name: 'مستوى الوقود', decode: d => Math.round((d[0] * 100) / 255) + '%', bytes: 1 },
    { pid: '0133', name: 'الضغط الجوي', decode: d => d[0] + ' kPa', bytes: 1 },
    { pid: '0146', name: 'حرارة الجو', decode: d => (d[0] - 40) + '°C', bytes: 1 },
    { pid: '015C', name: 'حرارة الزيت', decode: d => (d[0] - 40) + '°C', bytes: 1 },
    { pid: '015E', name: 'استهلاك الوقود', decode: d => (((d[0] * 256) + d[1]) / 20).toFixed(2) + ' L/h', bytes: 2 }
];

let device = null;
let charNotify = null;
let charWrite = null;
let connected = false;
let polling = null;
let paused = false;
let rxBuffer = '';
let rxResolver = null;

const $ = id => document.getElementById(id);

function log(msg, type = 'info') {
    const box = $('logBox');
    if (!box) return;
    const line = document.createElement('div');
    line.className = 'log-line log-' + type;
    const time = new Date().toLocaleTimeString('en-GB');
    line.textContent = `[${time}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

function setStatus(state, text) {
    $('statusDot').className = 'dot ' + state;
    $('statusText').textContent = text;
}

async function connect() {
    if (!navigator.bluetooth) {
        alert('❌ متصفحك لا يدعم Bluetooth\nاستخدم Chrome على أندرويد أو الكمبيوتر');
        return;
    }

    try {
        setStatus('connecting', 'جاري الاتصال...');
        log('🔍 البحث عن أجهزة OBD-II...', 'info');

        device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [OBD_UUIDS.services[0]] },
                { services: [OBD_UUIDS.services[1]] },
                { namePrefix: 'OBD' },
                { namePrefix: 'ELM' },
                { namePrefix: 'Vgate' },
                { namePrefix: 'Vlink' },
                { namePrefix: 'KONNWEI' }
            ],
            optionalServices: OBD_UUIDS.services
        });

        log('✓ تم اختيار: ' + (device.name || 'غير معروف'), 'info');
        $('deviceName').textContent = device.name || 'ELM327';

        device.addEventListener('gattserverdisconnected', onDisconnect);

        const server = await device.gatt.connect();
        log('✓ تم الاتصال بـ GATT', 'info');

        let service = null;
        for (const uuid of OBD_UUIDS.services) {
            try {
                service = await server.getPrimaryService(uuid);
                log('✓ الخدمة: ' + uuid, 'info');
                break;
            } catch (e) {}
        }

        if (!service) throw new Error('لم يتم العثور على خدمة OBD');

        const chars = await service.getCharacteristics();
        log('✓ عدد الخصائص: ' + chars.length, 'info');

        for (const c of chars) {
            if (c.properties.notify && !charNotify) charNotify = c;
            if ((c.properties.write || c.properties.writeWithoutResponse) && !charWrite) charWrite = c;
        }

        if (!charNotify) charNotify = chars[0];
        if (!charWrite) charWrite = chars[0];

        await charNotify.startNotifications();
        charNotify.addEventListener('characteristicvaluechanged', onReceive);

        connected = true;
        setStatus('connected', 'متصل');
        $('connectBtn').style.display = 'none';
        $('disconnectBtn').style.display = 'inline-flex';
        $('infoBar').style.display = 'flex';
        $('mainTabs').style.display = 'flex';

        await initELM();

    } catch (err) {
        log('✗ خطأ: ' + err.message, 'err');
        setStatus('disconnected', 'غير متصل');
        alert('فشل الاتصال: ' + err.message);
    }
}

function onDisconnect() {
    connected = false;
    if (polling) clearInterval(polling);
    charNotify = null;
    charWrite = null;
    device = null;
    setStatus('disconnected', 'غير متصل');
    $('connectBtn').style.display = 'inline-flex';
    $('disconnectBtn').style.display = 'none';
    log('🔌 تم قطع الاتصال', 'warn');
}

function disconnect() {
    if (device && device.gatt.connected) device.gatt.disconnect();
}

function onReceive(event) {
    const chunk = new TextDecoder().decode(event.target.value);
    rxBuffer += chunk;

    if (rxBuffer.includes('>')) {
        const response = rxBuffer.replace(/>/g, '').trim();
        rxBuffer = '';
        if (rxResolver) {
            const resolve = rxResolver;
            rxResolver = null;
            resolve(response);
        }
    }
}

function send(cmd, timeout = 3000) {
    return new Promise((resolve, reject) => {
        if (!connected || !charWrite) {
            reject(new Error('غير متصل'));
            return;
        }

        rxBuffer = '';
        log('TX → ' + cmd, 'tx');

        const timer = setTimeout(() => {
            rxResolver = null;
            reject(new Error('انتهت المهلة'));
        }, timeout);

        rxResolver = (data) => {
            clearTimeout(timer);
            log('RX ← ' + data, 'rx');
            resolve(data);
        };

        const enc = new TextEncoder();
        charWrite.writeValue(enc.encode(cmd + '\r')).catch(err => {
            clearTimeout(timer);
            rxResolver = null;
            reject(err);
        });
    });
}

async function initELM() {
    log('⚙️ تهيئة ELM327...', 'info');
    const cmds = [
        ['ATZ', 'إعادة تعيين', 3000],
        ['ATE0', 'إيقاف الصدى', 1000],
        ['ATL0', 'إيقاف الأسطر', 1000],
        ['ATS0', 'إيقاف المسافات', 1000],
        ['ATH0', 'إيقاف الرؤوس', 1000],
        ['ATSP0', 'اختيار البروتوكول', 3000]
    ];

    for (const [cmd, desc, to] of cmds) {
        try {
            await send(cmd, to);
            log('✓ ' + desc, 'info');
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            log('✗ ' + desc + ': ' + e.message, 'warn');
        }
    }

    try {
        const proto = await send('ATDPN', 2000);
        const map = {
            '0': 'Auto', '1': 'J1850 PWM', '2': 'J1850 VPW', '3': 'ISO 9141-2',
            '4': 'ISO 14230-4 KWP', '5': 'ISO 14230-4 KWP', '6': 'ISO 15765-4 CAN',
            '7': 'ISO 15765-4 CAN', '8': 'ISO 15765-4 CAN', '9': 'ISO 15765-4 CAN',
            'A': 'ISO 15765-4 CAN', 'B': 'ISO 15765-4 CAN', 'C': 'ISO 15765-4 CAN'
        };
        const key = proto.replace('A', '').trim();
        $('protocolName').textContent = map[key] || proto;
    } catch (e) {
        $('protocolName').textContent = 'غير معروف';
    }

    try {
        const vinResp = await send('0902', 5000);
        const vin = parseVIN(vinResp);
        if (vin) {
            $('vinCode').textContent = vin;
            log('✓ VIN: ' + vin, 'info');
        }
    } catch (e) {
        $('vinCode').textContent = 'غير متاح';
    }

    log('✅ جاهز! بدء القراءة...', 'info');
    buildLiveGrid();
    startPolling();
}

function parseVIN(response) {
    const hex = response.replace(/[\s\r\n]/g, '');
    const idx = hex.indexOf('4902');
    if (idx === -1) return null;
    const dataHex = hex.substring(idx + 6);
    let vin = '';
    for (let i = 0; i < dataHex.length - 1; i += 2) {
        const c = parseInt(dataHex.substring(i, i + 2), 16);
        if (c >= 32 && c <= 126) vin += String.fromCharCode(c);
    }
    return vin.length >= 17 ? vin.substring(0, 17) : (vin || null);
}

async function readPID(pid, byteCount) {
    try {
        const response = await send(pid, 2000);
        const hex = response.replace(/[\s\r\n]/g, '').toUpperCase();
        if (hex.includes('NODATA') || hex.includes('UNABLE') || hex.includes('ERROR') || hex.includes('?')) {
            return null;
        }
        const marker = '41' + pid.substring(2);
        const idx = hex.indexOf(marker);
        if (idx === -1) return null;
        const dataHex = hex.substring(idx + marker.length);
        const values = [];
        for (let i = 0; i < byteCount; i++) {
            const b = dataHex.substring(i * 2, i * 2 + 2);
            if (b.length < 2) return null;
            values.push(parseInt(b, 16));
        }
        return values;
    } catch (e) {
        return null;
    }
}

function buildLiveGrid() {
    const grid = $('liveGrid');
    grid.innerHTML = LIVE_PIDS.map((p, i) => `
        <div class="gauge" id="gauge_${i}">
            <div class="icon">${p.icon}</div>
            <div class="value" id="val_${i}">--</div>
            <div class="unit">${p.unit}</div>
            <div class="label">${p.name}</div>
        </div>
    `).join('');
}

function startPolling() {
    if (polling) clearInterval(polling);
    polling = setInterval(pollLive, 800);
    pollLive();
}

async function pollLive() {
    if (!connected || paused) return;

    for (let i = 0; i < LIVE_PIDS.length; i++) {
        if (!connected || paused) return;
        const p = LIVE_PIDS[i];
        const data = await readPID(p.pid, p.bytes);
        if (data) {
            const val = p.decode(data);
            updateGauge(i, val, p);
        }
    }
}

function updateGauge(idx, val, p) {
    const gauge = $('gauge_' + idx);
    const valEl = $('val_' + idx);
    if (!gauge || !valEl) return;

    valEl.textContent = val;

    gauge.classList.remove('warning', 'danger');
    const num = parseFloat(val);
    if (isNaN(num)) return;

    if (p.lowWarn) {
        if (num < p.danger) gauge.classList.add('danger');
        else if (num < p.warn) gauge.classList.add('warning');
    } else {
        if (num >= p.danger) gauge.classList.add('danger');
        else if (num >= p.warn) gauge.classList.add('warning');
    }
}

async function readDTCs(mode, label) {
    const result = $('dtcResult');
    result.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>جاري القراءة...</p></div>`;

    try {
        let response;
        if (mode === 'stored') response = await send('03', 5000);
        else if (mode === 'pending') response = await send('07', 5000);
        else if (mode === 'permanent') response = await send('0A', 5000);

        const codes = parseDTCs(response, mode);

        if (codes.length === 0) {
            result.innerHTML = `
                <div class="success-state">
                    <div class="icon">✅</div>
                    <strong>ممتاز! لا توجد أكواد أعطال (${label})</strong>
                    <p style="margin-top:8px; opacity:0.8">نظام السيارة يعمل بشكل سليم</p>
                </div>`;
            return;
        }

        result.innerHTML = codes.map(c => `
            <div class="dtc-item ${mode === 'pending' ? 'pending' : mode === 'permanent' ? 'permanent' : ''}">
                <div class="dtc-code">${c.code}</div>
                <div class="dtc-desc">${c.desc}</div>
                <div class="dtc-system">${c.system}</div>
            </div>
        `).join('');

    } catch (e) {
        result.innerHTML = `<div class="empty-state"><div class="icon">❌</div><p>فشل القراءة: ${e.message}</p></div>`;
    }
}

function parseDTCs(response, mode) {
    const hex = response.replace(/[\s\r\n]/g, '').toUpperCase();
    const markers = { stored: '43', pending: '47', permanent: '4A' };
    const marker = markers[mode] || '43';
    const idx = hex.indexOf(marker);
    if (idx === -1) return [];

    const data = hex.substring(idx + 2);
    const codes = [];
    for (let i = 0; i < data.length; i += 4) {
        const chunk = data.substring(i, i + 4);
        if (chunk.length < 4) break;
        if (chunk === '0000' || chunk === 'FFFF') continue;
        const decoded = decodeDTC(chunk);
        if (decoded) codes.push(decoded);
    }
    return codes;
}

function decodeDTC(hex) {
    if (hex.length < 4) return null;
    const firstByte = parseInt(hex.substring(0, 2), 16);
    const prefixBits = (firstByte >> 6) & 0x03;

    const letterMap = ['P', 'C', 'B', 'U'];
    const letter = letterMap[prefixBits];
    const digit1 = (firstByte >> 4) & 0x03;
    const digit2 = firstByte & 0x0F;
    const digit3 = hex.substring(2, 3);
    const digit4 = hex.substring(3, 4);
    const code = letter + digit1 + digit2.toString(16).toUpperCase() + digit3 + digit4;

    return { code, desc: getDTCDesc(code), system: getSystemName(letter) };
}

function getSystemName(letter) {
    return {
        'P': '🔧 نظام نقل الحركة',
        'C': '🛞 نظام الهيكل / الفرامل',
        'B': '💺 نظام الجسم / الوسائد',
        'U': '📡 شبكة الاتصال'
    }[letter] || 'غير معروف';
}

function getDTCDesc(code) {
    const common = {
        'P0100': 'خلل في حساس تدفق الهواء MAF',
        'P0101': 'نطاق/أداء حساس MAF',
        'P0102': 'تدفق منخفض في حساس MAF',
        'P0103': 'تدفق مرتفع في حساس MAF',
        'P0110': 'خلل في حساس حرارة الهواء',
        'P0113': 'حرارة مرتفعة في حساس IAT',
        'P0115': 'خلل في حساس حرارة المحرك',
        'P0117': 'حرارة المحرك منخفضة جداً',
        'P0118': 'حرارة المحرك مرتفعة جداً',
        'P0120': 'خلل في حساس موضع الخانق TPS',
        'P0121': 'نطاق/أداء حساس TPS',
        'P0125': 'حرارة غير كافية لحلقة الوقود المغلقة',
        'P0130': 'خلل في حساس الأوكسجين (Bank 1 Sensor 1)',
        'P0133': 'استجابة بطيئة من حساس O2',
        'P0135': 'خلل في سخان حساس O2',
        'P0136': 'خلل في حساس الأوكسجين (Bank 1 Sensor 2)',
        'P0141': 'خلل في سخان حساس O2 خلفي',
        'P0150': 'خلل في حساس الأوكسجين (Bank 2 Sensor 1)',
        'P0171': 'خليط هواء/وقود فقير (Bank 1)',
        'P0172': 'خليط هواء/وقود غني (Bank 1)',
        'P0174': 'خليط هواء/وقود فقير (Bank 2)',
        'P0175': 'خليط هواء/وقود غني (Bank 2)',
        'P0201': 'خلل في حاقن البخاخ رقم 1',
        'P0202': 'خلل في حاقن البخاخ رقم 2',
        'P0203': 'خلل في حاقن البخاخ رقم 3',
        'P0204': 'خلل في حاقن البخاخ رقم 4',
        'P0230': 'خلل في دائرة مضخة الوقود',
        'P0300': '⚠️ احتراق متقطع في عدة أسطوانات',
        'P0301': '⚠️ احتراق متقطع في الأسطوانة 1',
        'P0302': '⚠️ احتراق متقطع في الأسطوانة 2',
        'P0303': '⚠️ احتراق متقطع في الأسطوانة 3',
        'P0304': '⚠️ احتراق متقطع في الأسطوانة 4',
        'P0305': '⚠️ احتراق متقطع في الأسطوانة 5',
        'P0306': '⚠️ احتراق متقطع في الأسطوانة 6',
        'P0325': 'خلل في حساس طرق المحرك',
        'P0335': 'خلل في حساس موضع عمود المرفق',
        'P0340': 'خلل في حساس موضع عمود الكامات',
        'P0401': 'تدفق غير كافٍ في نظام EGR',
        'P0420': 'كفاءة محول الحفاز منخفضة (Bank 1)',
        'P0430': 'كفاءة محول الحفاز منخفضة (Bank 2)',
        'P0440': 'خلل في نظام تنفيس الوقود',
        'P0442': 'تسرب صغير في نظام EVAP',
        'P0446': 'خلل في دائرة التحكم بتنفيس البخار',
        'P0455': 'تسرب كبير في نظام EVAP',
        'P0500': 'خلل في حساس السرعة',
        'P0505': 'خلل في نظام التحكم بسرعة الخمول',
        'P0560': 'جهد البطارية غير طبيعي',
        'P0600': 'خلل في شبكة الاتصال التسلسلي',
        'P0601': 'خلل في ذاكرة وحدة التحكم',
        'P0700': 'خلل في نظام ناقل الحركة',
        'P0705': 'خلل في حساس نطاق ناقل الحركة',
        'P0715': 'خلل في حساس سرعة الدخل',
        'P0720': 'خلل في حساس سرعة الخرج',
        'P0730': 'نسبة تروس غير صحيحة',
        'P0740': 'خلل في قابض محول العزم',
        'P0750': 'خلل في صمام التحويل A',
        'P0755': 'خلل في صمام التحويل B',
        'P1000': 'اختبار OBD غير مكتمل',
        'U0100': 'فقدان الاتصال مع ECU المحرك',
        'U0101': 'فقدان الاتصال مع وحدة ناقل الحركة',
        'U0121': 'فقدان الاتصال مع ABS',
        'B0001': 'خلل في نظام الوسائد الهوائية'
    };
    return common[code] || 'كود عطل - راجع دليل السيارة للتفاصيل';
}

async function clearDTCs() {
    if (!confirm('⚠️ هل أنت متأكد من مسح جميع أكواد الأعطال؟\n\nملاحظة: يجب أن يكون المحرك متوقفاً والمفتاح على ON.')) return;
    try {
        await send('04', 5000);
        $('dtcResult').innerHTML = `
            <div class="success-state">
                <div class="icon">✅</div>
                <strong>تم مسح أكواد الأعطال بنجاح</strong>
                <p style="margin-top:8px; opacity:0.8">أضواء التحذير يجب أن تنطفئ الآن</p>
            </div>`;
    } catch (e) {
        alert('فشل المسح: ' + e.message);
    }
}

async function readExtraSensors() {
    const grid = $('sensorsGrid');
    grid.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>جاري القراءة...</p></div>';

    const results = [];
    for (const s of EXTRA_SENSORS) {
        const data = await readPID(s.pid, s.bytes);
        if (data) results.push({ name: s.name, value: s.decode(data) });
    }

    if (results.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>لم يتم الحصول على بيانات</p></div>';
        return;
    }

    grid.innerHTML = results.map(r => `
        <div class="sensor-item">
            <span class="sensor-name">${r.name}</span>
            <span class="sensor-value">${r.value}</span>
        </div>
    `).join('');
}

async function readVehicleInfo() {
    const grid = $('infoGrid');
    grid.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>جاري القراءة...</p></div>';

    const infos = [];

    const queries = [
        { cmd: '0902', name: 'رقم الهيكل VIN', parse: parseVIN },
        { cmd: '0904', name: 'معايرة ECU', parse: parseHexString },
        { cmd: '0906', name: 'معايرة CVN', parse: parseHexString },
        { cmd: '090A', name: 'اسم ECU', parse: parseHexString }
    ];

    for (const q of queries) {
        try {
            const resp = await send(q.cmd, 4000);
            const val = q.parse(resp);
            if (val) infos.push({ name: q.name, value: val });
        } catch (e) {}
    }

    if (infos.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>المعلومات غير متاحة لهذه السيارة</p></div>';
        return;
    }

    grid.innerHTML = infos.map(i => `
        <div class="info-item">
            <div class="info-label">${i.name}</div>
            <div class="info-value">${i.value}</div>
        </div>
    `).join('');
}

function parseHexString(response) {
    const hex = response.replace(/[\s\r\n]/g, '');
    const m = hex.match(/49[0-9A-F]{2}/);
    if (!m) return null;
    const data = hex.substring(hex.indexOf(m[0]) + 6);
    let str = '';
    for (let i = 0; i < data.length - 1; i += 2) {
        const c = parseInt(data.substring(i, i + 2), 16);
        if (c >= 32 && c <= 126) str += String.fromCharCode(c);
    }
    return str || null;
}

document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.bluetooth) {
        $('browserWarning').style.display = 'block';
    }

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            $(tab.dataset.tab).classList.add('active');
        });
    });

    $('connectBtn').addEventListener('click', connect);
    $('disconnectBtn').addEventListener('click', disconnect);
    $('pauseBtn').addEventListener('click', () => {
        paused = !paused;
        $('pauseBtn').textContent = paused ? '▶️ استئناف' : '⏸️ إيقاف مؤقت';
    });

    $('readStoredDtc').addEventListener('click', () => readDTCs('stored', 'المخزنة'));
    $('readPendingDtc').addEventListener('click', () => readDTCs('pending', 'المعلقة'));
    $('readPermDtc').addEventListener('click', () => readDTCs('permanent', 'الدائمة'));
    $('clearDtc').addEventListener('click', clearDTCs);

    $('readSensors').addEventListener('click', readExtraSensors);
    $('readInfo').addEventListener('click', readVehicleInfo);

    $('clearLog').addEventListener('click', () => {
        $('logBox').innerHTML = '';
        log('تم مسح السجل', 'info');
    });
});
