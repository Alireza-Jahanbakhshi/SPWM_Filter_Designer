(function() {
    'use strict';

    let chart = null;
    let zoomLevel = 1;
    let currentResults = null;

    const pwmInput = document.getElementById('pwmFreq');
    const sineInput = document.getElementById('sineFreq');
    const vccInput = document.getElementById('vcc');
    const loadInput = document.getElementById('loadR');
    const filterSelect = document.getElementById('filterType');
    const attenInput = document.getElementById('attenuation');
    const calcBtn = document.getElementById('calculateBtn');

    const resultsDiv = document.getElementById('results');
    const circuitDiv = document.getElementById('circuit');
    const diagramPre = document.getElementById('diagram');
    const partsDiv = document.getElementById('parts');
    const partsList = document.getElementById('partsList');
    const compareDiv = document.getElementById('compareTable');

    // -------- Helpers --------

    function fmtCap(c) {
        if (c >= 1e-3) return (c * 1000).toFixed(1) + ' mF';
        if (c >= 1e-6) return (c * 1e6).toFixed(1) + ' µF';
        if (c >= 1e-9) return (c * 1e9).toFixed(1) + ' nF';
        return (c * 1e12).toFixed(1) + ' pF';
    }

    function fmtInd(l) {
        if (l >= 1) return l.toFixed(2) + ' H';
        if (l >= 1e-3) return (l * 1000).toFixed(1) + ' mH';
        if (l >= 1e-6) return (l * 1e6).toFixed(1) + ' µH';
        return (l * 1e9).toFixed(1) + ' nH';
    }

    function fmtRes(r) {
        if (r >= 1e6) return (r / 1e6).toFixed(1) + ' MΩ';
        if (r >= 1e3) return (r / 1e3).toFixed(1) + ' kΩ';
        return r.toFixed(0) + ' Ω';
    }

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function findClosest(val, arr) {
        let best = arr[0];
        let bestErr = Infinity;
        for (let a of arr) {
            let err = Math.abs(a - val) / val;
            if (err < bestErr) { bestErr = err; best = a; }
        }
        return best;
    }

    // -------- Filter Calculators --------

    function calcRC(pwm, sine, atten) {
        let fc = pwm / Math.pow(10, atten / 20);
        fc = Math.max(fc, sine * 10);

        const Rs = [100, 220, 330, 470, 680, 1000, 2200, 3300, 4700, 6800, 10000, 15000, 22000, 33000, 47000, 68000, 100000];
        let bestR = Rs[0];
        let bestC = 0;
        let bestErr = Infinity;

        for (let R of Rs) {
            let C = 1 / (2 * Math.PI * fc * R);
            if (C < 1e-12 || C > 1e-3) continue;
            let actual = 1 / (2 * Math.PI * R * C);
            let err = Math.abs(actual - fc) / fc;
            if (err < bestErr) {
                bestErr = err;
                bestR = R;
                bestC = C;
            }
        }

        let actualFc = 1 / (2 * Math.PI * bestR * bestC);
        let attenActual = 20 * Math.log10(1 / Math.sqrt(1 + Math.pow(pwm / actualFc, 2)));
        let phase = -Math.atan(pwm / actualFc) * 180 / Math.PI;

        return {
            type: 'RC',
            fc: actualFc,
            R: bestR,
            C: bestC,
            atten: attenActual,
            phase: phase,
            parts: { 'Resistor': fmtRes(bestR) + ' (1%)', 'Capacitor': fmtCap(bestC) }
        };
    }

    function calcLC(pwm, sine, load, atten) {
        let fc = pwm / Math.pow(10, atten / 40);
        fc = Math.max(fc, sine * 10);

        const Ls = [1e-6, 2.2e-6, 4.7e-6, 10e-6, 22e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1e-3, 2.2e-3, 4.7e-3, 10e-3];
        let bestL = Ls[0];
        let bestC = 0;
        let bestErr = Infinity;

        for (let L of Ls) {
            let C = 1 / (Math.pow(2 * Math.PI * fc, 2) * L);
            if (C < 1e-12 || C > 1e-3) continue;
            let actual = 1 / (2 * Math.PI * Math.sqrt(L * C));
            let err = Math.abs(actual - fc) / fc;
            if (err < bestErr) {
                bestErr = err;
                bestL = L;
                bestC = C;
            }
        }

        let actualFc = 1 / (2 * Math.PI * Math.sqrt(bestL * bestC));
        let attenActual = 40 * Math.log10(1 / Math.sqrt(1 + Math.pow(pwm / actualFc, 4)));
        let phase = -2 * Math.atan(pwm / actualFc) * 180 / Math.PI;

        return {
            type: 'LC',
            fc: actualFc,
            L: bestL,
            C: bestC,
            atten: attenActual,
            phase: phase,
            parts: { 'Inductor': fmtInd(bestL), 'Capacitor': fmtCap(bestC) }
        };
    }

    function calcRLC(pwm, sine, load, atten) {
        let lc = calcLC(pwm, sine, load, atten);
        let Rd = 2 * Math.sqrt(lc.L / lc.C);
        const Rs = [1, 2.2, 4.7, 10, 22, 47, 100, 220, 470, 1000, 2200];
        Rd = findClosest(Rd, Rs);
        return {
            ...lc,
            type: 'RLC',
            Rd: Rd,
            parts: { ...lc.parts, 'Damping Resistor': fmtRes(Rd) + ' (2W)' }
        };
    }

    // -------- Main Calculation --------

    function runCalc() {
        let pwm = parseFloat(pwmInput.value);
        let sine = parseFloat(sineInput.value);
        let vcc = parseFloat(vccInput.value);
        let load = parseFloat(loadInput.value);
        let filterType = filterSelect.value;
        let atten = parseFloat(attenInput.value);

        if (!pwm || !sine || !vcc || !load || !atten) {
            resultsDiv.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Please fill all fields</p></div>';
            return;
        }

        if (pwm < sine * 10) {
            resultsDiv.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>PWM must be ≥ 10× sine frequency</p></div>';
            return;
        }

        let res;
        switch(filterType) {
            case 'rc': res = calcRC(pwm, sine, atten); break;
            case 'lc': res = calcLC(pwm, sine, load, atten); break;
            case 'rlc': res = calcRLC(pwm, sine, load, atten); break;
            default: return;
        }

        currentResults = res;
        displayResults(res, vcc, pwm, sine);
        showCircuit(filterType, res);
        showParts(res);
        updateChart(res, pwm, sine);
        updateCompare(pwm, sine, atten);
    }

    // -------- Display --------

    function displayResults(res, vcc, pwm, sine) {
        let vRms = (vcc / 2) / Math.sqrt(2);
        let vPk = vcc / 2;

        let html = `
            <div class="result-item"><span class="label">Type</span><span class="value">${res.type}</span></div>
            <div class="result-item"><span class="label">Cutoff</span><span class="value">${(res.fc/1000).toFixed(2)} <span class="unit">kHz</span></span></div>
            <div class="result-item"><span class="label">Attenuation @ ${(pwm/1000).toFixed(0)}kHz</span><span class="value">${res.atten.toFixed(1)} <span class="unit">dB</span></span></div>
            <div class="result-item"><span class="label">Phase @ ${sine}Hz</span><span class="value">${res.phase.toFixed(2)} <span class="unit">°</span></span></div>
            <div class="result-item highlight"><span class="label">Output RMS</span><span class="value">${vRms.toFixed(2)} <span class="unit">V</span></span></div>
            <div class="result-item highlight"><span class="label">Output Vpp</span><span class="value">${(vPk*2).toFixed(2)} <span class="unit">V</span></span></div>
        `;

        resultsDiv.innerHTML = html;
        circuitDiv.style.display = 'block';
        partsDiv.style.display = 'block';
    }

    function showCircuit(type, res) {
        let diagram = '';
        if (type === 'rc') {
            diagram = `
    CH1 ──[ ${fmtRes(res.R)} ]──┬──► CH1 (scope)
                                │
                               [ ${fmtCap(res.C)} ]
                                │
                               GND

    CH1N ──[ ${fmtRes(res.R)} ]──┬──► CH2 (scope)
                                 │
                                [ ${fmtCap(res.C)} ]
                                 │
                                GND

    Use Math: CH1 − CH2 on oscilloscope`;
        } else if (type === 'lc') {
            diagram = `
    CH1 ──[ ${fmtInd(res.L)} ]──┬──► CH1 (scope)
                                │
                               [ ${fmtCap(res.C)} ]
                                │
                               GND

    CH1N ──[ ${fmtInd(res.L)} ]──┬──► CH2 (scope)
                                 │
                                [ ${fmtCap(res.C)} ]
                                 │
                                GND

    Use Math: CH1 − CH2 on oscilloscope`;
        } else {
            diagram = `
    CH1 ──[ ${fmtInd(res.L)} ]──┬──► CH1 (scope)
                                │
                               [ ${fmtCap(res.C)} ]
                                │
                               GND
                        │
                       [ ${fmtRes(res.Rd)} ]
                        │
    CH1N ──[ ${fmtInd(res.L)} ]──┬──► CH2 (scope)
                                 │
                                [ ${fmtCap(res.C)} ]
                                 │
                                GND

    Use Math: CH1 − CH2 on oscilloscope`;
        }
        diagramPre.textContent = diagram;
    }

    function showParts(res) {
        let html = '';
        for (let [name, val] of Object.entries(res.parts)) {
            html += `<span class="part-tag"><span class="name">${name}:</span> <span class="val">${val}</span></span>`;
        }
        partsList.innerHTML = html;
    }

    // -------- Chart (Bode Plot) --------

    function setupChart() {
        let ctx = document.getElementById('bodePlot').getContext('2d');
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Magnitude (dB)',
                        data: [],
                        borderColor: '#4a6fa5',
                        backgroundColor: 'rgba(74,111,165,0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Phase (°)',
                        data: [],
                        borderColor: '#48bb78',
                        backgroundColor: 'rgba(72,187,120,0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { usePointStyle: true, padding: 16 } }
                },
                scales: {
                    x: {
                        type: 'logarithmic',
                        title: { display: true, text: 'Frequency (Hz)' },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y: {
                        title: { display: true, text: 'dB' },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y1: {
                        position: 'right',
                        title: { display: true, text: '°' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function updateChart(res, pwm, sine) {
        if (!chart) return;

        let freqs = [];
        let mags = [];
        let phases = [];

        let minF = Math.max(1, sine / 10);
        let maxF = pwm * 10 * zoomLevel;
        let steps = 120;

        for (let i = 0; i <= steps; i++) {
            let logMin = Math.log10(minF);
            let logMax = Math.log10(maxF);
            let f = Math.pow(10, logMin + (logMax - logMin) * i / steps);
            freqs.push(f);

            let H, ph;
            let w = 2 * Math.PI * f;
            let wc = 2 * Math.PI * res.fc;

            if (res.type === 'RC') {
                H = 1 / Math.sqrt(1 + Math.pow(w / wc, 2));
                ph = -Math.atan(w / wc) * 180 / Math.PI;
            } else {
                H = 1 / Math.sqrt(Math.pow(1 - Math.pow(w / wc, 2), 2) + Math.pow(w / wc, 2));
                ph = -Math.atan2(w / wc, 1 - Math.pow(w / wc, 2)) * 180 / Math.PI;
            }

            mags.push(20 * Math.log10(H || 1e-12));
            phases.push(ph || 0);
        }

        chart.data.labels = freqs;
        chart.data.datasets[0].data = mags;
        chart.data.datasets[1].data = phases;
        chart.update();
    }

    // -------- Comparison Table --------

    function updateCompare(pwm, sine, atten) {
        let rc = calcRC(pwm, sine, atten);
        let lc = calcLC(pwm, sine, 100, atten);
        let rlc = calcRLC(pwm, sine, 100, atten);

        let html = `
            <table>
                <thead><tr>
                    <th>Parameter</th>
                    <th>RC</th>
                    <th>LC</th>
                    <th>RLC</th>
                </tr></thead>
                <tbody>
                    <tr><td>Cutoff</td>
                        <td>${(rc.fc/1000).toFixed(2)} kHz</td>
                        <td>${(lc.fc/1000).toFixed(2)} kHz</td>
                        <td>${(rlc.fc/1000).toFixed(2)} kHz</td>
                    </tr>
                    <tr><td>Attenuation @ PWM</td>
                        <td>${rc.atten.toFixed(1)} dB</td>
                        <td class="best">${lc.atten.toFixed(1)} dB</td>
                        <td>${rlc.atten.toFixed(1)} dB</td>
                    </tr>
                    <tr><td>Phase @ sine</td>
                        <td>${rc.phase.toFixed(2)}°</td>
                        <td>${lc.phase.toFixed(2)}°</td>
                        <td>${rlc.phase.toFixed(2)}°</td>
                    </tr>
                    <tr><td>Components</td>
                        <td>2</td>
                        <td>2</td>
                        <td>3</td>
                    </tr>
                    <tr><td>Best for</td>
                        <td>Testing</td>
                        <td class="best">Power</td>
                        <td>Precision</td>
                    </tr>
                </tbody>
            </table>
            <p style="margin-top:10px;color:#a0aec0;font-size:13px;">Best option highlighted in green</p>
        `;
        compareDiv.innerHTML = html;
    }

    // -------- Events --------

    calcBtn.addEventListener('click', runCalc);

    document.querySelectorAll('input').forEach(el => {
        el.addEventListener('keypress', e => { if (e.key === 'Enter') runCalc(); });
    });

    document.getElementById('zoomIn').addEventListener('click', () => { zoomLevel *= 1.3; if (currentResults) updateChart(currentResults, parseFloat(pwmInput.value), parseFloat(sineInput.value)); });
    document.getElementById('zoomOut').addEventListener('click', () => { zoomLevel /= 1.3; if (currentResults) updateChart(currentResults, parseFloat(pwmInput.value), parseFloat(sineInput.value)); });
    document.getElementById('resetZoom').addEventListener('click', () => { zoomLevel = 1; if (currentResults) updateChart(currentResults, parseFloat(pwmInput.value), parseFloat(sineInput.value)); });

    filterSelect.addEventListener('change', runCalc);

    // -------- Init --------

    setupChart();
    setTimeout(runCalc, 200);

})();