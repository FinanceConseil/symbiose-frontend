// ── Microphone : Speech-to-Text + visualisation du volume ─────────────────────

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

let _recognition = null;
let _audioCtx    = null;
let _analyser    = null;
let _stream      = null;
let _rafId       = null;
let _active      = false;
let _elMicBtn    = null;

export function isActive() { return _active; }

export function stop() {
    if (_active && _recognition) _recognition.stop();
}

export function initMic({ elInput, autoResizeTextarea, updateSendBtn, isStreaming }) {
    _elMicBtn = document.getElementById('symbiose-mic-btn');
    if (!SpeechRecognitionAPI || !_elMicBtn) return;

    _elMicBtn.hidden = false;

    // ── Visualisation du volume via Web Audio API ─────────────────────────────

    function startVolumeMonitor() {
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then((stream) => {
                _stream   = stream;
                _audioCtx = new AudioContext();
                _analyser = _audioCtx.createAnalyser();
                _analyser.fftSize = 256;
                _audioCtx.createMediaStreamSource(stream).connect(_analyser);

                const data = new Uint8Array(_analyser.frequencyBinCount);

                function tick() {
                    if (!_active) return;
                    _analyser.getByteFrequencyData(data);
                    const avg   = data.reduce((s, v) => s + v, 0) / data.length;
                    const ratio = avg / 255;
                    _elMicBtn.style.setProperty('--mic-scale', 1 + ratio * 0.65);
                    _elMicBtn.style.setProperty('--mic-glow',  `${Math.round(ratio * 18)}px`);
                    _rafId = requestAnimationFrame(tick);
                }
                tick();
            })
            .catch(() => { /* permission refusée — animation CSS statique en fallback */ });
    }

    function stopVolumeMonitor() {
        if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
        if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
        if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
        _elMicBtn.style.removeProperty('--mic-scale');
        _elMicBtn.style.removeProperty('--mic-glow');
    }

    // ── SpeechRecognition ─────────────────────────────────────────────────────

    function startRecognition() {
        _recognition = new SpeechRecognitionAPI();
        _recognition.lang = 'fr-FR';
        _recognition.continuous = true;
        _recognition.interimResults = false;

        _recognition.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    const transcript = e.results[i][0].transcript;
                    const sep = elInput.value.trim() ? ' ' : '';
                    elInput.value += sep + transcript;
                    autoResizeTextarea();
                    updateSendBtn();
                }
            }
        };

        _recognition.onend = () => {
            _active = false;
            stopVolumeMonitor();
            _elMicBtn.classList.remove('symbiose-mic--recording');
        };

        _recognition.onerror = () => {
            _active = false;
            stopVolumeMonitor();
            _elMicBtn.classList.remove('symbiose-mic--recording');
        };

        _recognition.start();
        _active = true;
        _elMicBtn.classList.add('symbiose-mic--recording');
        startVolumeMonitor();
    }

    // ── Toggle ────────────────────────────────────────────────────────────────

    _elMicBtn.addEventListener('click', () => {
        if (isStreaming()) return;
        if (_active) {
            _recognition.stop();
        } else {
            startRecognition();
        }
    });
}
