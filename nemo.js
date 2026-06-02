'use strict';
/* ============================================================
   NEMO: DEEP OCEAN BREAKOUT — Full Game Logic
   nemo.js  |  건국대학교 웹 프로그래밍 팀 프로젝트
============================================================ */

// ── Canvas & DOM ──────────────────────────────────────────────
const canvas     = document.getElementById('gameCanvas');
const ctx        = canvas.getContext('2d');
const CW         = canvas.width;   // 1100
const CH         = canvas.height;  // 650

const hudStageEl = document.getElementById('hudStageNum');
const hudScoreEl = document.getElementById('hudScoreNum');
const hudTimerEl = document.getElementById('hudTimerNum');
const heartsEls  = document.querySelectorAll('.heart');

const screenEls = {
    lobby:  document.getElementById('screenLobby'),
    stages: document.getElementById('screenStages'),
    dialog: document.getElementById('screenDialog'),
    game:   document.getElementById('screenGame'),
};
function showScreen(name) {
    Object.values(screenEls).forEach(s => s.classList.remove('active'));
    if (screenEls[name]) screenEls[name].classList.add('active');
}

const modalSettings = document.getElementById('modalSettings');
const modalCredits  = document.getElementById('modalCredits');
function openModal(el)  { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

// ── LocalStorage ──────────────────────────────────────────────
const LS_KEY = 'nemo_breakout_v1';
function loadSave()      { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function writeSave(data) { localStorage.setItem(LS_KEY, JSON.stringify({ ...loadSave(), ...data })); }

// ── Stage config ──────────────────────────────────────────────
const STAGE_CFG = {
    1: { speed: 4.2, timerSec: null, rows: 6,  cols: 13, blackout: 0, shark: false, vortex: false, dorisAI: true  },
    2: { speed: 5.8, timerSec: 90,   rows: 8,  cols: 13, blackout: 2, shark: true,  vortex: false, dorisAI: false },
    3: { speed: 7.5, timerSec: 60,   rows: 10, cols: 13, blackout: 1, shark: false, vortex: true,  dorisAI: false },
};

// ── Dialogue scripts ──────────────────────────────────────────
const DIALOGUE = {
    1: [
        { speaker: '도 리',  side: 'left',  text: '어... 여기가 어딘지 기억이 안 나요. 벽돌들을 부숴서 저를 구해주세요!' },
        { speaker: '말 린',  side: 'right', text: '도리! 걱정 마, 내가 반드시 찾아갈게. 조금만 기다려!' },
        { speaker: '도 리',  side: 'left',  text: '감사해요! 참, 제 이름이 뭐였더라... 아무튼 빨리 와주세요!' },
    ],
    '1_out': [
        { speaker: '도 리',  side: 'left',  text: '고마워요! 그런데... 제가 왜 여기 있었죠? 기억이 안 나네요.' },
        { speaker: '말 린',  side: 'right', text: '(한숨) 됐어, 다음 단계로 가자!' },
    ],
    2: [
        { speaker: '브루스', side: 'right', text: '물고기는 친구다... 그래도 조금 배고프긴 한데.' },
        { speaker: '말 린',  side: 'left',  text: '상어가 공을 건드리면 패들 방향이 반대로 뒤집혀! 조심해!' },
    ],
    '2_out': [
        { speaker: '말 린',  side: 'right', text: '브루스를 따돌렸어! 니모가 가까워지고 있어!' },
    ],
    3: [
        { speaker: '말 린',  side: 'left',  text: '드디어 여기까지 왔어, 니모. 아빠가 왔다!' },
        { speaker: '니 모',  side: 'right', text: '아빠!! 마지막 벽을 부숴주세요! 소용돌이 벽돌엔 주의해요!' },
    ],
    '3_out': [
        { speaker: '니 모',  side: 'right', text: '아빠, 해냈어요! 집으로 돌아가요!' },
        { speaker: '말 린',  side: 'left',  text: '니모... 드디어 찾았다. 다시는 놓치지 않을게.' },
    ],
};

/* ============================================================
   AudioManager — Web Audio API, 외부 파일 없이 순수 JS 합성
   BiquadFilterNode(lowpass) 로 물속 먹먹한 공간감 구현
============================================================ */
class AudioManager {
    constructor() {
        this.enabled = true;
        this._ac     = null;   // AudioContext (첫 인터랙션 후 생성)
        this._master = null;
        this._lpf    = null;   // lowpass filter
    }

    _boot() {
        if (this._ac) return;
        this._ac     = new (window.AudioContext || window.webkitAudioContext)();
        this._master = this._ac.createGain();
        this._master.gain.value = 0.55;

        // BiquadFilterNode — lowpass: 물속 고주파 차단 (1.2 kHz 이하만 통과)
        this._lpf               = this._ac.createBiquadFilter();
        this._lpf.type          = 'lowpass';
        this._lpf.frequency.value = 1200;
        this._lpf.Q.value       = 0.9;

        this._lpf.connect(this._master);
        this._master.connect(this._ac.destination);
    }

    setEnabled(on) {
        this.enabled = on;
        if (this._master) this._master.gain.value = on ? 0.55 : 0;
    }

    // 단순 톤 합성 헬퍼
    _tone(freq, type, dur, vol0, vol1) {
        this._boot();
        if (!this.enabled) return;
        const now  = this._ac.currentTime;
        const osc  = this._ac.createOscillator();
        const gain = this._ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(vol0, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(vol1, 0.0001), now + dur);
        osc.connect(gain);
        gain.connect(this._lpf);
        osc.start(now);
        osc.stop(now + dur);
    }

    // 노이즈 버스트 헬퍼
    _noise(dur, vol) {
        this._boot();
        if (!this.enabled) return;
        const len  = Math.floor(this._ac.sampleRate * dur);
        const buf  = this._ac.createBuffer(1, len, this._ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src  = this._ac.createBufferSource();
        src.buffer = buf;
        const gain = this._ac.createGain();
        gain.gain.setValueAtTime(vol, this._ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this._ac.currentTime + dur);
        src.connect(gain);
        gain.connect(this._lpf);
        src.start();
    }

    // 일반 벽돌 파괴: 물방울 팝 + 노이즈
    playBlockBreak() {
        this._noise(0.09, 0.6);
        this._tone(320, 'sine', 0.07, 0.4, 0.001);
    }

    // 단단한 벽돌 타격: 둔탁한 저음 충돌음
    playHardHit() {
        this._tone(80,  'sawtooth', 0.15, 0.7, 0.001);
        this._tone(120, 'sine',     0.10, 0.3, 0.001);
    }

    // 아이템 획득: 상승 아르페지오
    playItemGet() {
        [440, 550, 660].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.18, 0.5, 0.001), i * 60)
        );
    }

    // 상어 등장: 긴장감 저음 신디사이저
    playSharkAlert() {
        this._tone(55,  'sawtooth', 0.6, 0.8, 0.001);
        this._tone(110, 'square',   0.3, 0.3, 0.001);
    }

    // 패들 반사음
    playPaddleHit() { this._tone(280, 'sine', 0.06, 0.4, 0.001); }

    // 라이프 손실: 하강 3음
    playLifeLost() {
        [400, 300, 200].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.2, 0.6, 0.001), i * 100)
        );
    }

    // 스테이지 클리어: 상승 4음
    playStageClear() {
        [523, 659, 784, 1047].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.25, 0.5, 0.001), i * 80)
        );
    }

    // 타이핑 틱음 (DialogueManager용)
    playTyping() { this._tone(600 + Math.random() * 200, 'sine', 0.03, 0.12, 0.001); }
}

/* ============================================================
   DialogueManager — 글자 타이핑 효과 + VN 화면 제어
============================================================ */
class DialogueManager {
    constructor(audio) {
        this.audio      = audio;
        this._timer     = null;
        this._charIdx   = 0;
        this._fullText  = '';
        this._lineIdx   = 0;
        this._script    = [];
        this._onDone    = null;
        this._speed     = 38; // ms/char

        this.nameTag  = document.getElementById('vnNameTag');
        this.textEl   = document.getElementById('vnText');
        this.stageTag = document.querySelector('.vn-stage-tag');
        this.charL    = document.getElementById('vnCharLeft');
        this.charR    = document.getElementById('vnCharRight');

        document.getElementById('btnVnNext').addEventListener('click', () => this._next());
        document.getElementById('btnVnSkip').addEventListener('click', () => {
            this._stop(); this._onDone?.();
        });
        document.addEventListener('keydown', e => {
            if (!screenEls.dialog.classList.contains('active')) return;
            if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); this._next(); }
        });
    }

    play(key, onDone) {
        this._script  = DIALOGUE[key] ?? DIALOGUE[1];
        this._lineIdx = 0;
        this._onDone  = onDone;
        this._showLine();
    }

    _showLine() {
        const line = this._script[this._lineIdx];
        if (!line) { this._onDone?.(); return; }
        this.nameTag.textContent = line.speaker;
        this.charL.classList.toggle('active', line.side === 'left');
        this.charR.classList.toggle('active', line.side === 'right');
        this._stop();
        this._fullText = line.text;
        this._charIdx  = 0;
        this.textEl.textContent = '';
        this._type();
    }

    _type() {
        if (this._charIdx >= this._fullText.length) return;
        this._timer = setTimeout(() => {
            this.textEl.textContent += this._fullText[this._charIdx++];
            if (this._charIdx % 3 === 0) this.audio.playTyping();
            this._type();
        }, this._speed);
    }

    _stop() { clearTimeout(this._timer); }

    _next() {
        // 타이핑 중이면 전체 텍스트 즉시 표시
        if (this._charIdx < this._fullText.length) {
            this._stop();
            this.textEl.textContent = this._fullText;
            this._charIdx = this._fullText.length;
            return;
        }
        this._lineIdx++;
        if (this._lineIdx < this._script.length) this._showLine();
        else this._onDone?.();
    }
}

/* ============================================================
   Particle — 기포(bubble) 위로 솟구침 + 파편(debris) 아래 가라앉음
============================================================ */
class Particle {
    constructor(x, y, kind, color = '#fff') {
        this.x    = x + (Math.random() - 0.5) * 14;
        this.y    = y + (Math.random() - 0.5) * 14;
        this.kind = kind;
        this.life = 1.0;

        if (kind === 'bubble') {
            this.r     = Math.random() * 4 + 2;
            this.dx    = (Math.random() - 0.5) * 1.5;
            this.dy    = -(Math.random() * 3.5 + 2.5);   // 위 방향
            this.decay = 0.025 + Math.random() * 0.02;
        } else {
            this.r     = Math.random() * 3 + 1.5;
            this.dx    = (Math.random() - 0.5) * 3.5;
            this.dy    = Math.random() * 1.5 + 0.5;       // 아래 방향
            this.decay = 0.018 + Math.random() * 0.015;
            this.color = color;
        }
    }

    update() {
        this.x    += this.dx;
        this.y    += this.dy;
        this.life -= this.decay;
        if (this.kind === 'bubble') {
            // 기포: 약한 지그재그 부력
            this.dx += (Math.random() - 0.5) * 0.15;
            this.dx  = Math.max(-1.2, Math.min(1.2, this.dx));
        } else {
            this.dy += 0.08; // 파편: 중력 가속
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        if (this.kind === 'bubble') {
            const g = ctx.createRadialGradient(
                this.x - this.r * 0.3, this.y - this.r * 0.3, 0,
                this.x, this.y, this.r
            );
            g.addColorStop(0, 'rgba(255,255,255,0.8)');
            g.addColorStop(1, 'rgba(150,230,255,0.1)');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        } else {
            ctx.fillStyle = this.color;
            ctx.fill();
        }
        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

// 벽돌 파괴 시 10~15개 파티클 생성
function spawnParticles(x, y, color) {
    const n   = 10 + Math.floor(Math.random() * 6);
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(new Particle(x, y, i < n * 0.45 ? 'bubble' : 'debris', color));
    }
    return out;
}

/* ============================================================
   Ball — 상하 반전 물리
   패들: 상단 / 탈락: 상단 밖으로 벗어남
============================================================ */
class Ball {
    constructor(x, y, color = '#ff6b35') {
        this.x         = x;
        this.y         = y;
        this.r         = 9;
        this.dx        = 0;
        this.dy        = 0;
        this.color     = color;
        this.stuck     = true;   // 패들 부착 중
        this.stuckDx   = 0;      // 패들 위 상대 오프셋
        this.slowTimer = 0;      // 소용돌이 디버프 잔여 프레임
        this.trail     = [];
    }

    // 패들에서 발사 (아래 방향)
    launch(speed) {
        this.stuck = false;
        const angle = (Math.random() - 0.5) * Math.PI * 0.65; // ±58.5° from straight down
        this.dx = Math.sin(angle) * speed;
        this.dy = Math.cos(angle) * speed;  // 항상 양수(아래)
    }

    update(paddle, cw, ch) {
        if (this.stuck) {
            this.x = paddle.cx + this.stuckDx;
            this.y = paddle.y + paddle.h + this.r + 1;
            return 'ok';
        }

        const s = this.slowTimer > 0 ? 0.45 : 1.0;
        if (this.slowTimer > 0) this.slowTimer--;

        // 잔상 저장
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 8) this.trail.shift();

        this.x += this.dx * s;
        this.y += this.dy * s;

        // 좌·우 벽
        if (this.x - this.r < 0)  { this.x = this.r;      this.dx =  Math.abs(this.dx); }
        if (this.x + this.r > cw) { this.x = cw - this.r; this.dx = -Math.abs(this.dx); }

        // 하단 벽 반사
        if (this.y + this.r >= ch) { this.y = ch - this.r; this.dy = -Math.abs(this.dy); }

        // 상단 탈락
        if (this.y + this.r < 0) return 'lost';

        // 상단 패들 충돌 (공이 위로 갈 때만)
        if (this.dy < 0 && this._testPaddle(paddle)) {
            const offset   = (this.x - paddle.cx) / (paddle.w / 2); // -1 ~ 1
            const maxAng   = 60 * (Math.PI / 180);
            const ang      = offset * maxAng;
            const spd      = Math.hypot(this.dx, this.dy);
            this.dx = Math.sin(ang) * spd;
            this.dy = Math.abs(Math.cos(ang) * spd); // 다시 아래로
            this.y  = paddle.y + paddle.h + this.r + 1;
            return 'paddle';
        }

        return 'ok';
    }

    _testPaddle(p) {
        return (
            this.y - this.r <= p.y + p.h &&
            this.y + this.r >= p.y &&
            this.x + this.r >= p.x &&
            this.x - this.r <= p.x + p.w
        );
    }

    draw(ctx) {
        // 잔상
        this.trail.forEach((pt, i) => {
            const a = (i / this.trail.length) * 0.28;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, this.r * 0.6 * (i / this.trail.length), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,107,53,${a})`;
            ctx.fill();
        });

        ctx.save();
        ctx.shadowColor = this.color;
        ctx.shadowBlur  = 18;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(
            this.x - this.r * 0.35, this.y - this.r * 0.35, 0,
            this.x, this.y, this.r
        );
        g.addColorStop(0, '#fff');
        g.addColorStop(0.4, this.color);
        g.addColorStop(1, '#803010');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
    }
}

/* ============================================================
   Paddle — 캔버스 상단, 마우스 동기화, 2프레임 지느러미 토글
============================================================ */
class Paddle {
    constructor(cw) {
        this._baseW    = 130;
        this.w         = this._baseW;
        this.h         = 12;
        this.x         = (cw - this.w) / 2;
        this.y         = 16;
        this.CW        = cw;
        this._targetX  = this.x;
        this._fin      = 0;    // 프레임 카운터 (지느러미 토글용)
        this.reversed  = false;
        this.shield    = false;
        this._shieldT  = 0;
        this._expandT  = 0;
    }

    get cx() { return this.x + this.w / 2; }

    moveTo(mouseX) {
        const tx = this.reversed ? this.CW - mouseX : mouseX;
        this._targetX = Math.max(0, Math.min(this.CW - this.w, tx - this.w / 2));
    }

    update() {
        this.x += (this._targetX - this.x) * 0.18; // lerp
        this._fin++;

        if (this._shieldT > 0) { this._shieldT--; } else { this.shield = false; }
        if (this._expandT > 0) { this._expandT--; this.w = this._baseW * 1.55; }
        else                   { this.w = this._baseW; }
    }

    applyShield(f = 300) { this.shield = true; this._shieldT = f; }
    applyExpand(f = 400) { this._expandT = f; }

    draw(ctx) {
        const { x, y, w, h } = this;
        const cx = x + w / 2;

        ctx.save();
        ctx.shadowColor = this.shield ? '#f7d716' : '#ff6b35';
        ctx.shadowBlur  = this.shield ? 22 : 14;

        // 본체 (양끝 둥근 capsule)
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, this.shield ? '#ffe066' : '#ff8a50');
        g.addColorStop(1, this.shield ? '#ffd700' : '#c04010');
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, h / 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth   = 1;
        ctx.stroke();

        // 지느러미 — 2프레임 단위 각도 토글
        const finAng = (this._fin >> 1) % 2 === 0 ? -0.22 : 0.22;
        ctx.save();
        ctx.translate(cx, y);
        ctx.rotate(finAng);
        ctx.beginPath();
        ctx.moveTo(-6, 0); ctx.lineTo(0, -16); ctx.lineTo(6, 0);
        ctx.closePath();
        ctx.fillStyle = this.shield ? '#ffe066' : '#ff6b35';
        ctx.fill();
        ctx.restore();

        // 쉴드 반원
        if (this.shield) {
            ctx.beginPath();
            ctx.arc(cx, y + h / 2, w / 2 + 8, Math.PI, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,220,50,0.5)';
            ctx.lineWidth   = 2.5;
            ctx.stroke();
        }

        ctx.restore();
    }
}

/* ============================================================
   Block — normal / hard(균열) / vortex(소용돌이)
============================================================ */
const BT = { normal: 'normal', hard: 'hard', vortex: 'vortex' };

const ROW_COLORS = [
    ['#1a6bb5','#2196f3'], ['#0d7a5f','#26c485'],
    ['#8e24aa','#ce93d8'], ['#c0392b','#e74c3c'],
    ['#e67e22','#f39c12'], ['#00838f','#26c6da'],
    ['#4a148c','#7b1fa2'], ['#1b5e20','#388e3c'],
];

class Block {
    constructor(x, y, w, h, type = BT.normal, row = 0) {
        this.x         = x; this.y = y; this.w = w; this.h = h;
        this.type      = type;
        this.alive     = true;
        this.row       = row;
        this._cp       = ROW_COLORS[row % ROW_COLORS.length];
        this.hp        = type === BT.hard ? 3 : 1;
        this.maxHp     = this.hp;
        this._vang     = Math.random() * Math.PI * 2; // vortex 회전각
        this._cracks   = [];  // 균열 선 목록
        this._itemType = null;
    }

    get color() { return this._cp[0]; }

    // 타격 처리. 반환값: 남은 hp (0이면 파괴)
    hit() {
        this.hp--;
        if (this.hp > 0) this._addCrack();
        else             this.alive = false;
        return this.hp;
    }

    _addCrack() {
        // 벽돌 표면에 무작위 균열 선 추가 (hard 벽돌 전용)
        const x1 = this.x + Math.random() * this.w * 0.3 + this.w * 0.1;
        const y1 = this.y + Math.random() * this.h * 0.3 + this.h * 0.1;
        const x2 = this.x + Math.random() * this.w * 0.5 + this.w * 0.2;
        const y2 = this.y + Math.random() * this.h * 0.5 + this.h * 0.1;
        this._cracks.push({ x1, y1, x2, y2 });
    }

    update() {
        if (this.type === BT.vortex) this._vang += 0.04;
    }

    draw(ctx) {
        if (!this.alive) return;
        const { x, y, w, h } = this;
        ctx.save();

        if (this.type === BT.normal) {
            // 그라데이션 + glow
            ctx.shadowColor = this._cp[0];
            ctx.shadowBlur  = 8;
            const g = ctx.createLinearGradient(x, y, x, y + h);
            g.addColorStop(0, this._cp[1]);
            g.addColorStop(1, this._cp[0]);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.fill();

        } else if (this.type === BT.hard) {
            // 바위 질감 그라데이션
            ctx.shadowColor = '#666';
            ctx.shadowBlur  = 6;
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, '#6b7280');
            g.addColorStop(0.5, '#374151');
            g.addColorStop(1, '#1f2937');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.fill();

            // 타격마다 추가된 균열 선 (흰색)
            ctx.strokeStyle = 'rgba(255,255,255,0.65)';
            ctx.lineWidth   = 1.2;
            this._cracks.forEach(c => {
                ctx.beginPath();
                ctx.moveTo(c.x1, c.y1);
                ctx.lineTo(c.x2, c.y2);
                ctx.stroke();
            });

            // 잔여 HP 표시 (흰 점)
            for (let i = 0; i < this.maxHp; i++) {
                ctx.beginPath();
                ctx.arc(x + 6 + i * 8, y + h / 2, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = i < this.hp ? '#fff' : 'rgba(255,255,255,0.2)';
                ctx.fill();
            }

        } else { // vortex
            ctx.shadowColor = '#00b4d8';
            ctx.shadowBlur  = 12;
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, '#0077b6');
            g.addColorStop(1, '#023e8a');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.fill();

            // 회전하는 소용돌이 호 아이콘
            ctx.save();
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(this._vang);
            ctx.strokeStyle = 'rgba(0,220,255,0.75)';
            ctx.lineWidth   = 2;
            for (let a = 0; a < 3; a++) {
                ctx.beginPath();
                ctx.arc(0, 0, 6, (a / 3) * Math.PI * 2, (a / 3 + 0.55) * Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }

        // 공통 테두리
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth   = 0.8;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
        ctx.stroke();

        ctx.restore();
    }
}

/* ============================================================
   Item — 부력으로 위 방향 이동 (dy = -2.2)
============================================================ */
const ITEM_INFO = {
    extraBall:  { label: '+B', color: '#f7d716' },
    shield:     { label: 'SH', color: '#00b4d8' },
    paddleWide: { label: 'PW', color: '#ff6b35' },
};

class Item {
    constructor(x, y, type) {
        this.x     = x; this.y = y; this.type = type;
        this.r     = 12;
        this.dy    = -2.2;  // 위 방향 부력
        this.dx    = (Math.random() - 0.5) * 0.8;
        this.alive = true;
        this._wob  = 0;
    }

    update(cw) {
        this._wob += 0.08;
        this.dx   += Math.sin(this._wob) * 0.04;
        this.dx    = Math.max(-1.5, Math.min(1.5, this.dx));
        this.x    += this.dx;
        this.y    += this.dy;
        if (this.x - this.r < 0 || this.x + this.r > cw) this.dx *= -1;
        if (this.y + this.r < 0) this.alive = false;
    }

    hits(paddle) {
        return (
            this.y - this.r <= paddle.y + paddle.h &&
            this.y + this.r >= paddle.y &&
            this.x + this.r >= paddle.x &&
            this.x - this.r <= paddle.x + paddle.w
        );
    }

    draw(ctx) {
        if (!this.alive) return;
        const info = ITEM_INFO[this.type];
        ctx.save();
        ctx.shadowColor = info.color;
        ctx.shadowBlur  = 16;
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.5, info.color);
        g.addColorStop(1, info.color + '88');
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.fillStyle    = '#fff';
        ctx.font         = 'bold 9px Orbitron, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info.label, this.x, this.y);
        ctx.restore();
    }
}

/* ============================================================
   Shark — Stage 2: 좌우 횡단, 공 충돌 시 패들 방향 역전
============================================================ */
class Shark {
    constructor(cw, ch) {
        this.CW = cw; this.CH = ch;
        this.w  = 80; this.h  = 40;
        this.x  = -this.w;
        this.y  = ch * 0.3 + (Math.random() - 0.5) * 60;
        this.dx = 2.8;
    }

    update() {
        this.x += this.dx;
        if (this.dx > 0 && this.x > this.CW + this.w) {
            this.x = -this.w;
            this.y = this.CH * 0.2 + Math.random() * this.CH * 0.35;
        }
        if (this.dx < 0 && this.x < -this.w) {
            this.x = this.CW + this.w;
            this.y = this.CH * 0.2 + Math.random() * this.CH * 0.35;
        }
    }

    hitsBall(ball) {
        const dx = Math.abs(ball.x - (this.x + this.w / 2));
        const dy = Math.abs(ball.y - (this.y + this.h / 2));
        return dx < this.w / 2 + ball.r && dy < this.h / 2 + ball.r;
    }

    draw(ctx) {
        const { x, y, w, h } = this;
        const flip = this.dx < 0;
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        if (flip) ctx.scale(-1, 1);
        ctx.shadowColor = '#ef233c';
        ctx.shadowBlur  = 16;

        // 몸체 타원
        ctx.fillStyle = '#4a90d9';
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // 등지느러미
        ctx.fillStyle = '#357abd';
        ctx.beginPath();
        ctx.moveTo(-5, -h / 2); ctx.lineTo(5, -h / 2 - 18); ctx.lineTo(14, -h / 2);
        ctx.closePath(); ctx.fill();

        // 꼬리
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(-w / 2 - 18, -12);
        ctx.lineTo(-w / 2 - 18,  12);
        ctx.closePath(); ctx.fill();

        // 눈
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(w / 2 - 10, -5, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(w / 2 - 9, -5, 2.5, 0, Math.PI * 2); ctx.fill();

        // 이빨
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(w / 2 - 8 + i * 5, h / 2 - 2);
            ctx.lineTo(w / 2 - 5 + i * 5, h / 2 + 8);
            ctx.lineTo(w / 2 - 2 + i * 5, h / 2 - 2);
            ctx.closePath(); ctx.fill();
        }

        ctx.restore();
    }
}

/* ============================================================
   A* Pathfinding — Manhattan 휴리스틱, 4방향 그리드 탐색
   Dory가 장애물(블록)을 우회하여 패들 위치로 이동하는 경로 계산
============================================================ */
class AStarGrid {
    constructor(cw, ch, cell = 44) {
        this.cell = cell;
        this.cols = Math.floor(cw / cell);
        this.rows = Math.floor(ch / cell);
        this.grid = this._empty();
    }

    _empty() {
        return Array.from({ length: this.rows }, () => new Array(this.cols).fill(0));
    }

    // 살아있는 블록들의 셀을 장애물(1)로 마킹
    markBlocks(blocks) {
        this.grid = this._empty();
        for (const b of blocks) {
            if (!b.alive) continue;
            const c0 = Math.max(0, Math.floor(b.x / this.cell));
            const c1 = Math.min(this.cols - 1, Math.floor((b.x + b.w) / this.cell));
            const r0 = Math.max(0, Math.floor(b.y / this.cell));
            const r1 = Math.min(this.rows - 1, Math.floor((b.y + b.h) / this.cell));
            for (let r = r0; r <= r1; r++)
                for (let c = c0; c <= c1; c++)
                    this.grid[r][c] = 1;
        }
    }

    /**
     * A* 경로 탐색
     * @param {{col,row}} start 출발 그리드 좌표
     * @param {{col,row}} end   목표 그리드 좌표
     * @returns {Array<{col,row}>} 경로 배열 (없으면 빈 배열)
     */
    findPath(start, end) {
        const key = (c, r) => c * 1000 + r;
        // Manhattan 거리 휴리스틱
        const h   = (c, r) => Math.abs(c - end.col) + Math.abs(r - end.row);

        // 우선순위 큐 역할을 하는 배열 (f값 기준 정렬)
        const open   = [{ col: start.col, row: start.row, g: 0, f: h(start.col, start.row), prev: null }];
        const closed = new Set();
        const gMap   = new Map([[key(start.col, start.row), 0]]);

        while (open.length) {
            // f 최솟값 노드 선택
            open.sort((a, b) => a.f - b.f);
            const cur = open.shift();
            const ck  = key(cur.col, cur.row);

            if (cur.col === end.col && cur.row === end.row) {
                // 역추적으로 경로 복원
                const path = [];
                let node   = cur;
                while (node) { path.unshift({ col: node.col, row: node.row }); node = node.prev; }
                return path;
            }

            if (closed.has(ck)) continue;
            closed.add(ck);

            // 상·하·좌·우 4방향 이웃 탐색
            const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
            for (const [dc, dr] of dirs) {
                const nc = cur.col + dc;
                const nr = cur.row + dr;
                if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
                if (this.grid[nr][nc] === 1) continue;    // 장애물 건너뜀
                const nk   = key(nc, nr);
                if (closed.has(nk)) continue;
                const newG = cur.g + 1;
                if (newG >= (gMap.get(nk) ?? Infinity)) continue;
                gMap.set(nk, newG);
                open.push({ col: nc, row: nr, g: newG, f: newG + h(nc, nr), prev: cur });
            }
        }
        return []; // 경로 없음
    }

    // 픽셀 → 그리드 좌표
    toGrid(px, py) {
        return { col: Math.floor(px / this.cell), row: Math.floor(py / this.cell) };
    }

    // 그리드 → 픽셀 (셀 중심)
    toPixel(col, row) {
        return { x: col * this.cell + this.cell / 2, y: row * this.cell + this.cell / 2 };
    }
}

/* ============================================================
   Dory — Stage 1: A* 경로 탐색 + 캔버스 시각화
============================================================ */
class Dory {
    constructor(cw, ch) {
        this.x    = cw / 2;
        this.y    = ch - 60;
        this.r    = 18;
        this.spd  = 1.6;
        this.grid = new AStarGrid(cw, ch);
        this.path = [];      // 그리드 좌표 경로
        this.pathPx = [];    // 픽셀 좌표 경로
        this.pathIdx   = 0;
        this._recalcT  = 0;
        this._wob      = 0;
    }

    recalcPath(blocks, paddle) {
        this.grid.markBlocks(blocks);
        const start = this.grid.toGrid(this.x, this.y);
        const end   = this.grid.toGrid(paddle.cx, paddle.y + 20);
        this.path   = this.grid.findPath(start, end);
        this.pathPx = this.path.map(p => this.grid.toPixel(p.col, p.row));
        this.pathIdx = 0;
    }

    update(blocks, paddle) {
        this._recalcT++;
        // 60프레임마다 경로 재계산 (블록 파괴 반영)
        if (this._recalcT % 60 === 0) this.recalcPath(blocks, paddle);

        this._wob += 0.07;
        if (!this.pathPx.length || this.pathIdx >= this.pathPx.length) return;

        const tgt  = this.pathPx[this.pathIdx];
        const dx   = tgt.x - this.x;
        const dy   = tgt.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < this.spd + 1) {
            this.pathIdx++;
        } else {
            this.x += (dx / dist) * this.spd;
            this.y += (dy / dist) * this.spd;
        }
    }

    // A* 경로 및 그리드 장애물 시각화
    drawPath(ctx) {
        // 장애물 셀 반투명 오버레이
        for (let r = 0; r < this.grid.rows; r++) {
            for (let c = 0; c < this.grid.cols; c++) {
                if (this.grid.grid[r][c] === 1) {
                    ctx.fillStyle = 'rgba(255,60,60,0.08)';
                    ctx.fillRect(c * this.grid.cell, r * this.grid.cell, this.grid.cell, this.grid.cell);
                }
            }
        }

        if (this.pathPx.length < 2) return;

        // 경로 점선
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(0,200,255,0.35)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        for (let i = this.pathIdx; i < this.pathPx.length; i++) {
            ctx.lineTo(this.pathPx[i].x, this.pathPx[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // 경유 노드 원
        for (let i = this.pathIdx; i < this.pathPx.length; i++) {
            const p = this.pathPx[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,200,255,${0.15 + (i / this.pathPx.length) * 0.4})`;
            ctx.fill();
        }
        ctx.restore();
    }

    draw(ctx) {
        const bobY = Math.sin(this._wob) * 3;
        ctx.save();
        ctx.shadowColor = '#00b4d8';
        ctx.shadowBlur  = 14;
        ctx.font        = `${this.r * 2}px serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐠', this.x, this.y + bobY);
        ctx.restore();
    }
}

/* ============================================================
   Game — 메인 게임 컨트롤러
============================================================ */
class Game {
    constructor() {
        this.audio    = new AudioManager();
        this.dialogue = new DialogueManager(this.audio);
        this._stage   = 1;
        this._score   = 0;
        this._lives   = 3;
        this._timer   = 0;
        this._timerMs = 0;
        this._running = false;
        this._paused  = false;
        this._raf     = null;
        this._lastTs  = 0;
        this._clearing = false;

        this._balls     = [];
        this._paddle    = null;
        this._blocks    = [];
        this._items     = [];
        this._particles = [];
        this._shark     = null;
        this._dory      = null;
        this._mouseX    = CW / 2;
        this._revTimer  = 0;

        const save = loadSave();
        this._highScore     = save.highScore     || 0;
        this._clearedStages = save.clearedStages || [];
        this._settings      = save.settings      || { bgm:'on', sfx:'on', speed:'1x', theme:'deep', tsize:'md' };

        this._initUI();
        this._loadSettingsUI();
        this._applyUnlocked();
        showScreen('lobby');
    }

    // ── UI 이벤트 연결 ─────────────────────────────────────────
    _initUI() {
        document.getElementById('btnStart').addEventListener('click',    () => { showScreen('stages'); this._applyUnlocked(); });
        document.getElementById('btnSettings').addEventListener('click', () => openModal(modalSettings));
        document.getElementById('btnCredits').addEventListener('click',  () => openModal(modalCredits));
        document.getElementById('btnBackLobby').addEventListener('click', () => showScreen('lobby'));

        // 스테이지 카드 버튼 (동적 재바인딩은 _applyUnlocked에서)
        document.querySelectorAll('.stage-card').forEach(card => {
            card.querySelector('.btn-stage')?.addEventListener('click', () => {
                const n = Number(card.dataset.stage);
                if (!card.classList.contains('stage-locked')) this._launchStage(n);
            });
        });

        document.getElementById('btnPause').addEventListener('click', () => this._togglePause());
        document.getElementById('btnHudSetting').addEventListener('click', () => {
            if (this._running) this._togglePause();
            openModal(modalSettings);
        });

        document.getElementById('btnCloseSettings').addEventListener('click', () => {
            this._applySettings(); closeModal(modalSettings);
            if (this._paused && this._running) this._togglePause();
        });
        document.getElementById('btnSaveSettings').addEventListener('click', () => {
            this._applySettings(); writeSave({ settings: this._settings }); closeModal(modalSettings);
            if (this._paused && this._running) this._togglePause();
        });
        document.getElementById('btnResetSettings').addEventListener('click', () => this._resetSettingsUI());
        document.getElementById('btnCloseCredits').addEventListener('click', () => closeModal(modalCredits));

        [modalSettings, modalCredits].forEach(m =>
            m.addEventListener('click', e => { if (e.target === m) closeModal(m); })
        );

        // 설정 토글
        document.querySelectorAll('.toggle-group').forEach(grp => {
            grp.addEventListener('click', e => {
                const b = e.target.closest('.toggle-btn');
                if (!b) return;
                grp.querySelectorAll('.toggle-btn').forEach(x => x.classList.remove('on'));
                b.classList.add('on');
            });
        });

        // 색상 스와치
        document.querySelectorAll('.color-swatches').forEach(c => {
            c.addEventListener('click', e => {
                const sw = e.target.closest('.swatch');
                if (!sw) return;
                c.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
            });
        });

        // 마우스 — canvas 기준 스케일 보정
        canvas.addEventListener('mousemove', e => {
            const rect = canvas.getBoundingClientRect();
            this._mouseX = (e.clientX - rect.left) * (CW / rect.width);
        });

        // 클릭 / Space → 공 발사
        canvas.addEventListener('click', () => { if (this._running && !this._paused) this._launchBalls(); });
        document.addEventListener('keydown', e => {
            if (e.code === 'Space' && screenEls.game.classList.contains('active')) {
                e.preventDefault();
                if (this._running && !this._paused) this._launchBalls();
            }
            if ((e.key === 'p' || e.key === 'P') && screenEls.game.classList.contains('active')) {
                this._togglePause();
            }
            if (e.key === 'Escape') {
                if (!modalSettings.classList.contains('hidden')) { closeModal(modalSettings); return; }
                if (!modalCredits.classList.contains('hidden'))  { closeModal(modalCredits);  return; }
            }
        });
    }

    _applyUnlocked() {
        const cleared = loadSave().clearedStages || [];
        document.querySelectorAll('.stage-card').forEach(card => {
            const n = Number(card.dataset.stage);
            const unlocked = n === 1 || cleared.includes(n - 1);
            card.classList.toggle('stage-locked', !unlocked);
            const btn = card.querySelector('.btn-stage');
            if (btn) {
                btn.disabled    = !unlocked;
                btn.textContent = unlocked ? '시작하기' : '잠금 해제 필요';
            }
        });
    }

    // ── 스테이지 실행 ─────────────────────────────────────────
    _launchStage(n) {
        this._stage = n;
        const stageNames = { 1:'조력자 구출', 2:'상어의 위협', 3:'니모 구하기' };
        document.querySelector('.vn-stage-tag').textContent = `STAGE ${n} — ${stageNames[n]}`;
        showScreen('dialog');
        this.dialogue.play(n, () => { showScreen('game'); this._initStage(n); });
    }

    _initStage(n) {
        const cfg    = STAGE_CFG[n];
        const spdMul = { '1x':1, '1.2x':1.2, '1.4x':1.4 }[this._settings.speed] ?? 1;
        this._baseSpeed = cfg.speed * spdMul;

        this._lives    = 3;
        this._score    = 0;
        this._timer    = cfg.timerSec ?? 0;
        this._timerMs  = 0;
        this._running  = true;
        this._paused   = false;
        this._clearing = false;
        this._revTimer = 0;
        this._particles = [];
        this._items     = [];

        hudStageEl.textContent = String(n).padStart(2, '0');
        this._syncHUD();

        this._paddle = new Paddle(CW);
        this._blocks = this._buildBlocks(cfg);
        this._balls  = [this._newBall()];

        this._shark = cfg.shark   ? new Shark(CW, CH) : null;
        this._dory  = cfg.dorisAI ? new Dory(CW, CH)  : null;
        if (this._dory) this._dory.recalcPath(this._blocks, this._paddle);
        if (this._shark) setTimeout(() => this.audio.playSharkAlert(), 600);

        document.getElementById('canvasPlaceholder').style.display = 'none';
        document.getElementById('btnPause').textContent = '⏸';

        if (this._raf) cancelAnimationFrame(this._raf);
        this._lastTs = 0;
        this._raf = requestAnimationFrame(ts => this._loop(ts));
    }

    _buildBlocks(cfg) {
        const margin = 24, gap = 5, bh = 22;
        const bw     = (CW - margin * 2 - gap * (cfg.cols - 1)) / cfg.cols;
        const totalH = cfg.rows * (bh + gap);
        const startY = CH - margin - totalH;
        const items  = ['extraBall', 'shield', 'paddleWide'];
        const blocks = [];

        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
                const x = margin + c * (bw + gap);
                const y = startY + r * (bh + gap);

                let type = BT.normal;
                if (r === 0)                             type = BT.hard;   // 최상단 행: 단단한 벽돌
                else if (cfg.vortex && (r + c) % 5 === 0) type = BT.vortex;

                const b = new Block(x, y, bw, bh, type, r);
                if (Math.random() < 0.25) b._itemType = items[Math.floor(Math.random() * items.length)];
                blocks.push(b);
            }
        }
        return blocks;
    }

    _newBall() {
        const b = new Ball(this._paddle.cx, this._paddle.y + this._paddle.h + 10, this._ballColor());
        b.stuck   = true;
        b.stuckDx = 0;
        return b;
    }

    _ballColor() {
        const sw = document.querySelector('.color-swatches .swatch.selected');
        return sw ? getComputedStyle(sw).getPropertyValue('--sc').trim() : '#ff6b35';
    }

    _launchBalls() {
        this._balls.forEach(b => { if (b.stuck) b.launch(this._baseSpeed); });
    }

    // ── 메인 루프 ─────────────────────────────────────────────
    _loop(ts) {
        if (!this._running) return;
        const dt = this._lastTs ? Math.min(ts - this._lastTs, 50) : 16;
        this._lastTs = ts;
        if (!this._paused) this._update(dt);
        this._draw();
        this._raf = requestAnimationFrame(t2 => this._loop(t2));
    }

    _update(dt) {
        const cfg = STAGE_CFG[this._stage];

        // ── 타이머 ──
        if (cfg.timerSec) {
            this._timerMs += dt;
            if (this._timerMs >= 1000) {
                this._timerMs -= 1000;
                this._timer = Math.max(0, this._timer - 1);
                this._syncHUD();
                if (this._timer === 0) { this._gameOver(false); return; }
            }
        }

        // ── 패들 ──
        this._paddle.moveTo(this._mouseX);
        this._paddle.update();

        // 패들 역전 타이머 (상어 충돌)
        if (this._revTimer > 0) {
            this._revTimer--;
            this._paddle.reversed = this._revTimer > 0;
        }

        // ── 상어 ──
        if (this._shark) {
            this._shark.update();
            for (const b of this._balls) {
                if (!b.stuck && this._shark.hitsBall(b)) {
                    b.dx *= -1;
                    if (this._revTimer === 0) this.audio.playSharkAlert();
                    this._revTimer = 240;
                }
            }
        }

        // ── 도리 A* ──
        if (this._dory) this._dory.update(this._blocks, this._paddle);

        // ── 공 물리 ──
        for (let i = this._balls.length - 1; i >= 0; i--) {
            const b   = this._balls[i];
            const res = b.update(this._paddle, CW, CH);
            if (res === 'paddle') { this.audio.playPaddleHit(); }
            else if (res === 'lost') {
                if (this._balls.length > 1) { this._balls.splice(i, 1); }
                else { this._loseLife(); return; }
            }
        }

        // ── 블록 충돌 ──
        for (const block of this._blocks) {
            if (!block.alive) continue;
            block.update();
            for (const ball of this._balls) {
                if (ball.stuck || !this._collide(ball, block)) continue;

                const hp = block.hit();
                if (hp > 0) {
                    this.audio.playHardHit();
                } else {
                    this.audio.playBlockBreak();
                    this._score += block.type === BT.hard ? 30 : block.type === BT.vortex ? 20 : 10;
                    this._syncHUD();
                    this._saveHigh();
                    this._particles.push(...spawnParticles(block.x + block.w / 2, block.y + block.h / 2, block.color));
                    if (block._itemType) this._items.push(new Item(block.x + block.w / 2, block.y + block.h / 2, block._itemType));
                }

                // 소용돌이 디버프: 공 속도 3초간 감소
                if (block.type === BT.vortex && block.alive) ball.slowTimer = 180;
            }
        }

        // ── 아이템 ──
        for (let i = this._items.length - 1; i >= 0; i--) {
            const it = this._items[i];
            it.update(CW);
            if (it.hits(this._paddle)) { this._applyItem(it.type); this._items.splice(i, 1); }
            else if (!it.alive) this._items.splice(i, 1);
        }

        // ── 파티클 ──
        for (let i = this._particles.length - 1; i >= 0; i--) {
            this._particles[i].update();
            if (this._particles[i].dead) this._particles.splice(i, 1);
        }

        // ── 클리어 판정 ──
        if (!this._clearing && this._blocks.every(b => !b.alive)) {
            this._clearing = true;
            this._stageClear();
        }
    }

    // 공-블록 AABB 충돌 + 반사 방향 결정
    _collide(ball, block) {
        const { x, y, r } = ball;
        const { x: bx, y: by, w: bw, h: bh } = block;
        const nearX = Math.max(bx, Math.min(x, bx + bw));
        const nearY = Math.max(by, Math.min(y, by + bh));
        if (Math.hypot(x - nearX, y - nearY) > r) return false;

        const ovX = Math.min(x + r - bx, bx + bw - (x - r));
        const ovY = Math.min(y + r - by, by + bh - (y - r));
        if (ovX < ovY) { ball.dx *= -1; }
        else           { ball.dy *= -1; }
        return true;
    }

    _applyItem(type) {
        this.audio.playItemGet();
        if (type === 'extraBall') {
            const nb = this._newBall();
            nb.stuckDx = (Math.random() - 0.5) * 30;
            this._balls.push(nb);
            setTimeout(() => nb.launch(this._baseSpeed), 300);
        } else if (type === 'shield') {
            this._paddle.applyShield(360);
        } else {
            this._paddle.applyExpand(480);
        }
    }

    _loseLife() {
        this._lives--;
        this.audio.playLifeLost();
        this._syncHUD();
        if (this._lives <= 0) { this._gameOver(false); }
        else { this._balls = [this._newBall()]; }
    }

    // ── 스테이지 클리어 ────────────────────────────────────────
    _stageClear() {
        this._running = false;
        cancelAnimationFrame(this._raf);
        this.audio.playStageClear();

        // 시간 보너스: (남은초)^2 × 2 가산
        const cfg   = STAGE_CFG[this._stage];
        const bonus = cfg.timerSec ? Math.pow(this._timer, 2) * 2 : 0;
        this._score += bonus;
        this._syncHUD();
        this._saveHigh();

        if (!this._clearedStages.includes(this._stage)) {
            this._clearedStages.push(this._stage);
            writeSave({ clearedStages: this._clearedStages });
        }

        const outKey = `${this._stage}_out`;
        const next   = () => {
            if (this._stage < 3) this._launchStage(this._stage + 1);
            else                 this._showEnding();
        };

        if (DIALOGUE[outKey]) {
            showScreen('dialog');
            this.dialogue.play(outKey, next);
        } else {
            setTimeout(next, 800);
        }
    }

    _gameOver(win) {
        this._running = false;
        cancelAnimationFrame(this._raf);
        this._drawOverlay(win ? 'STAGE CLEAR!' : 'GAME OVER', win ? '#f7d716' : '#ef233c');
        setTimeout(() => { showScreen('stages'); this._applyUnlocked(); }, 3500);
    }

    _showEnding() {
        this._drawOverlay('CONGRATULATIONS!', '#f7d716');
        setTimeout(() => showScreen('lobby'), 4500);
    }

    _drawOverlay(msg, color) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,5,20,0.75)';
        ctx.fillRect(0, 0, CW, CH);
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = color;
        ctx.shadowBlur   = 32;
        ctx.fillStyle    = color;
        ctx.font         = 'bold 60px Orbitron, sans-serif';
        ctx.fillText(msg, CW / 2, CH / 2 - 22);
        ctx.shadowBlur   = 0;
        ctx.fillStyle    = 'rgba(220,240,255,0.9)';
        ctx.font         = '22px Noto Sans KR, sans-serif';
        ctx.fillText(`SCORE: ${this._score}  |  BEST: ${this._highScore}`, CW / 2, CH / 2 + 34);
        ctx.restore();
    }

    // ── 렌더링 ────────────────────────────────────────────────
    _draw() {
        ctx.clearRect(0, 0, CW, CH);

        // 배경
        const bg = ctx.createLinearGradient(0, 0, 0, CH);
        bg.addColorStop(0, '#0a1e38');
        bg.addColorStop(1, '#050e1c');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CW, CH);

        // A* 경로 시각화 (Stage 1)
        if (this._dory) this._dory.drawPath(ctx);

        // 파티클
        this._particles.forEach(p => p.draw(ctx));

        // 블록
        this._blocks.forEach(b => b.draw(ctx));

        // 아이템
        this._items.forEach(it => it.draw(ctx));

        // 도리
        if (this._dory) this._dory.draw(ctx);

        // 상어
        if (this._shark) this._shark.draw(ctx);

        // 공
        this._balls.forEach(b => b.draw(ctx));

        // 패들
        this._paddle.draw(ctx);

        // 암전 레이어 (Stage 2, 3)
        this._drawBlackout();

        // 상태 알림 텍스트
        if (this._revTimer > 0) {
            const a = 0.6 + Math.sin(Date.now() * 0.01) * 0.35;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle   = '#ef233c';
            ctx.font        = 'bold 13px Orbitron, sans-serif';
            ctx.textAlign   = 'center';
            ctx.fillText('⚠ 조작 반전 중', CW / 2, 48);
            ctx.restore();
        }
        if (this._balls.some(b => b.slowTimer > 0)) {
            ctx.save();
            ctx.fillStyle = '#00b4d8';
            ctx.font      = 'bold 12px Orbitron, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('〜 속도 저하', CW / 2, 64);
            ctx.restore();
        }
    }

    _drawBlackout() {
        const cfg    = STAGE_CFG[this._stage];
        if (!cfg.blackout) return;

        const alive = this._blocks.filter(b => b.alive);
        if (!alive.length) return;

        const topY   = Math.min(...alive.map(b => b.y));
        const revealH = cfg.blackout * (22 + 5); // blockH + gap
        const darkY  = topY + revealH;

        ctx.save();

        // 블록 하단부 어둡게
        ctx.fillStyle = 'rgba(0,5,20,0.90)';
        ctx.fillRect(0, darkY, CW, CH - darkY);

        // Stage 3: 공 주변 원형 마스킹 (밝게 비추기)
        if (this._stage === 3) {
            this._balls.forEach(ball => {
                const grd = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, 88);
                grd.addColorStop(0, 'rgba(0,5,20,0)');
                grd.addColorStop(1, 'rgba(0,5,20,0.90)');
                ctx.fillStyle = grd;
                ctx.fillRect(0, darkY, CW, CH - darkY);
            });
        }

        ctx.restore();
    }

    // ── HUD ───────────────────────────────────────────────────
    _syncHUD() {
        hudScoreEl.textContent = String(this._score).padStart(6, '0');
        hudTimerEl.textContent = STAGE_CFG[this._stage].timerSec ? String(this._timer) : '∞';
        heartsEls.forEach((h, i) => h.classList.toggle('on', i < this._lives));
    }

    _togglePause() {
        this._paused = !this._paused;
        document.getElementById('btnPause').textContent = this._paused ? '▶' : '⏸';
    }

    _saveHigh() {
        if (this._score > this._highScore) {
            this._highScore = this._score;
            writeSave({ highScore: this._highScore });
        }
    }

    // ── 설정 ─────────────────────────────────────────────────
    _applySettings() {
        const g = k => document.querySelector(`[data-group="${k}"].on`)?.dataset.val;
        this._settings = { bgm: g('bgm'), sfx: g('sfx'), speed: g('speed'), theme: g('theme'), tsize: g('textsize') };
        this.audio.setEnabled(this._settings.sfx !== 'off');
    }

    _loadSettingsUI() {
        const s = this._settings;
        [['bgm', s.bgm], ['sfx', s.sfx], ['textsize', s.tsize ?? 'md'], ['theme', s.theme], ['speed', s.speed]].forEach(([grp, val]) => {
            if (!val) return;
            document.querySelectorAll(`[data-group="${grp}"]`).forEach(b => b.classList.toggle('on', b.dataset.val === val));
        });
    }

    _resetSettingsUI() {
        [['bgm','on'],['sfx','on'],['textsize','md'],['theme','deep'],['speed','1x']].forEach(([g,v]) => {
            document.querySelectorAll(`[data-group="${g}"]`).forEach(b => b.classList.toggle('on', b.dataset.val === v));
        });
        document.querySelectorAll('.color-swatches .swatch').forEach((s, i) => s.classList.toggle('selected', i === 0));
    }
}

/* ============================================================
   Bootstrap
============================================================ */
window.addEventListener('DOMContentLoaded', () => {
    window._game = new Game();
});

/* ============================================================
   에셋 대체 주석 체크리스트
   ──────────────────────────────────────────────────────────
   [ ] BGM: AudioManager에 _bgmLoop() 메서드를 추가하고
       OscillatorNode 기반 멜로디 루프를 구현하거나
       <audio src="bgm_stage1.mp3"> 요소를 연결하세요.

   [ ] 이미지 스프라이트: 이모지 대신 PNG를 사용하려면
       Dory.draw(), Shark.draw()에서
       ctx.drawImage(img, x, y, w, h) 로 교체하세요.

   [ ] 폰트: Orbitron / Noto Sans KR이 오프라인 환경이라면
       로컬 woff2 파일을 @font-face로 선언하거나
       fallback 폰트(monospace 등)를 지정하세요.

   [ ] HiDPI(Retina): 선명도 향상을 위해 부트스트랩에서
       canvas.width  = CW * devicePixelRatio;
       canvas.height = CH * devicePixelRatio;
       ctx.scale(devicePixelRatio, devicePixelRatio);
       를 적용하고 CSS로 실제 크기를 유지하세요.

   [ ] 터치 입력: 모바일 지원 시 canvas에 'touchmove' 이벤트를
       mousemove 핸들러와 동일하게 연결하세요.

   [ ] 게임오버/클리어 전용 모달: 현재 canvas 오버레이 방식이나,
       별도 #modalGameOver HTML 요소를 추가하면
       버튼(재시도, 메뉴로 등) 배치가 용이합니다.

   [ ] localStorage 보안: writeSave() 데이터는 클라이언트에
       평문 저장됩니다. 점수 검증이 필요하면 서버 연동을 추가하세요.
============================================================ */
