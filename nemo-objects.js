'use strict';
/* ============================================================
   nemo-objects.js — 구현 A 담당 파일
   역할: AudioManager, ScorePopup, Particle, Ball, Paddle, Block, Item

   파일별 역할 분담:
   · 이 파일     : 구현 담당자 A (코어 게임 오브젝트)
   · nemo-story.js  : 스토리 담당자 (대사 데이터)
   · nemo-game.js   : 구현 담당자 B (게임 제어 + 연출)
   · nemo.html / nemo.css : 디자인 담당자
============================================================ */

/* ============================================================
   AudioManager — Web Audio API 기반 효과음
   [구현 A 전담]
============================================================ */
class AudioManager {
    constructor() {
        this.enabled = true;
        this._ac     = null;
        this._master = null;
        this._lpf    = null;
    }

    _boot() {
        if (this._ac) return;
        this._ac     = new (window.AudioContext || window.webkitAudioContext)();
        this._master = this._ac.createGain();
        this._master.gain.value = 0.55;
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

    _tone(freq, type, dur, vol0, vol1 = 0.0001) {
        this._boot();
        if (!this.enabled) return;
        const now  = this._ac.currentTime;
        const osc  = this._ac.createOscillator();
        const gain = this._ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(vol0, now);
        gain.gain.exponentialRampToValueAtTime(vol1, now + dur);
        osc.connect(gain);
        gain.connect(this._lpf);
        osc.start(now);
        osc.stop(now + dur);
    }

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

    playBlockBreak()  { this._noise(0.09, 0.6); this._tone(320, 'sine', 0.07, 0.4); }
    playHardHit()     { this._tone(80, 'sawtooth', 0.15, 0.7); this._tone(120, 'sine', 0.10, 0.3); }
    playSharkAlert()  { this._tone(55, 'sawtooth', 0.6, 0.8);  this._tone(110, 'square', 0.3, 0.3); }
    playPaddleHit()   { this._tone(280, 'sine', 0.06, 0.4); }

    playPowerSwing() {
        this._tone(180, 'sawtooth', 0.08, 0.6);
        setTimeout(() => this._tone(360, 'sine',    0.14, 0.5), 40);
        setTimeout(() => this._tone(540, 'sine',    0.10, 0.35), 90);
    }

    playItemGet() {
        [440, 550, 660].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.18, 0.5), i * 60)
        );
    }

    playMultiball() {
        [330, 440, 550, 660, 770].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.20, 0.45), i * 45)
        );
    }

    playLifeLost() {
        [400, 300, 200].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.2, 0.6), i * 100)
        );
    }

    playStageClear() {
        [523, 659, 784, 1047].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.25, 0.5), i * 80)
        );
    }

    playTyping() { this._tone(600 + Math.random() * 200, 'sine', 0.03, 0.12); }
}

/* ============================================================
   ScorePopup — 벽돌 파괴 시 점수 팝업 (위로 떠오르며 페이드아웃)
============================================================ */
class ScorePopup {
    constructor(x, y, points) {
        this.x     = x;
        this.y     = y;
        this.vy    = -1.8;
        this.life  = 1.0;
        this.decay = 0.020;
        this.text  = `+${points}`;
    }

    update() {
        this.y    += this.vy;
        this.vy   *= 0.97;
        this.life -= this.decay;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha  = Math.max(0, this.life);
        ctx.font         = 'bold 16px Orbitron, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle    = '#FFD700';
        ctx.shadowColor  = '#FF8C00';
        ctx.shadowBlur   = 12;
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

/* ============================================================
   Particle — bubble / rect / debris
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
            this.dy    = -(Math.random() * 3.5 + 2.5);
            this.decay = 0.025 + Math.random() * 0.02;
        } else if (kind === 'rect') {
            this.pw     = Math.random() * 7 + 4;
            this.ph     = Math.random() * 5 + 3;
            const ang   = Math.random() * Math.PI * 2;
            const spd   = Math.random() * 5 + 2;
            this.dx     = Math.cos(ang) * spd;
            this.dy     = Math.sin(ang) * spd;
            this.decay  = 0.020 + Math.random() * 0.018;
            this.color  = color;
            this.rot    = Math.random() * Math.PI * 2;
            this.rotSpd = (Math.random() - 0.5) * 0.30;
        } else {
            this.r     = Math.random() * 3 + 1.5;
            this.dx    = (Math.random() - 0.5) * 3.5;
            this.dy    = Math.random() * 1.5 + 0.5;
            this.decay = 0.018 + Math.random() * 0.015;
            this.color = color;
        }
    }

    update() {
        this.x    += this.dx;
        this.y    += this.dy;
        this.life -= this.decay;

        if (this.kind === 'bubble') {
            this.dx += (Math.random() - 0.5) * 0.15;
            this.dx  = Math.max(-1.2, Math.min(1.2, this.dx));
        } else if (this.kind === 'rect') {
            this.dy  += 0.20;
            this.rot += this.rotSpd;
        } else {
            this.dy += 0.08;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);

        if (this.kind === 'bubble') {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            const g = ctx.createRadialGradient(
                this.x - this.r * 0.3, this.y - this.r * 0.3, 0,
                this.x, this.y, this.r
            );
            g.addColorStop(0, 'rgba(255,255,255,0.8)');
            g.addColorStop(1, 'rgba(150,230,255,0.1)');
            ctx.fillStyle   = g;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth   = 0.8;
            ctx.stroke();

        } else if (this.kind === 'rect') {
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rot);
            ctx.fillStyle = this.color;
            ctx.fillRect(-this.pw / 2, -this.ph / 2, this.pw, this.ph);

        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();
        }

        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

function spawnParticles(x, y, color) {
    const out = [];
    const nb  = 3 + Math.floor(Math.random() * 2);
    const nd  = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nb; i++) out.push(new Particle(x, y, 'bubble', color));
    for (let i = 0; i < nd; i++) out.push(new Particle(x, y, 'rect',   color));
    return out;
}


/* ============================================================
   🚨 CORE OBJECTS — 구현 개발자 외 수정 금지 🚨
   Ball · Paddle · Block · Item
   이 구획 아래 클래스 내부 로직은 구현 팀원만 수정합니다.
============================================================ */

/* ============================================================
   Ball — 반전 방향 물리 (패들 상단, 블록 하단)

   물리 규칙:
   · 공은 아래쪽(dy > 0)으로 발사, 하단 벽 반사, 상단으로 탈락
   · MIN_DY 클램프: Y속도가 일정 수치 이하로 떨어지지 않아
     공이 수평으로만 왕복하는 현상을 원천 차단
   · 패들 반사: pow(1.3) 커브 — 중앙=수직, 가장자리=날카롭게

   [디자인 담당 TODO] 공 외형을 이미지로 교체하려면:
   draw() 의 ctx.arc() + createRadialGradient() 부분을
   ctx.drawImage(ballImg, this.x - this.r, this.y - this.r, this.r*2, this.r*2)
   으로 교체하세요. (이미지 로드는 nemo-game.js 상단에서 처리)
============================================================ */
class Ball {
    static MIN_DY = 1.5; // Y축 최소 속도 — 수평 루프 방지 상수

    constructor(x, y, color = '#ff6b35') {
        this.x         = x;
        this.y         = y;
        this.r         = 9;
        this.dx        = 0;
        this.dy        = 0;
        this.color     = color;
        this.stuck     = true;
        this.stuckDx   = 0;
        this.slowTimer = 0;
        this.trail     = [];
        this.rainbow   = false;
    }

    /** 공 발사 — ±45° 이내 아래쪽(양수 dy) 방향으로 */
    launch(speed) {
        this.stuck = false;
        const angle = (Math.random() - 0.5) * Math.PI * 0.5;
        this.dx = Math.sin(angle) * speed;
        this.dy = Math.cos(angle) * speed; // 양수 = 아래쪽 (블록 방향)
    }

    update(paddle, cw, ch) {
        // 패들에 붙어 있을 때: 패들 바로 아래에 위치
        if (this.stuck) {
            this.x = paddle.cx + this.stuckDx;
            this.y = paddle.y + paddle.h + this.r + 1;
            return 'ok';
        }

        const s = this.slowTimer > 0 ? 0.45 : 1.0;
        if (this.slowTimer > 0) this.slowTimer--;

        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 4) this.trail.shift();

        this.x += this.dx * s;
        this.y += this.dy * s;

        // ── 벽 반사 ──────────────────────────────────────────
        if (this.x - this.r < 0)   { this.x = this.r;       this.dx =  Math.abs(this.dx); }
        if (this.x + this.r > cw)  { this.x = cw - this.r;  this.dx = -Math.abs(this.dx); }
        if (this.y + this.r >= ch) { this.y = ch - this.r;   this.dy = -Math.abs(this.dy); } // 하단 벽 반사
        if (this.y - this.r < 0)   return 'lost';                                              // 상단 이탈 → 목숨 감소

        // ── MIN DY 클램프: 수평 루프 방지 ────────────────────
        if (Math.abs(this.dy) < Ball.MIN_DY)
            this.dy = this.dy >= 0 ? Ball.MIN_DY : -Ball.MIN_DY;

        // ── 패들 충돌: 공이 위(dy < 0)로 올라올 때만 처리 ──
        if (this.dy < 0 && this._hitPaddle(paddle)) {
            const offset = (this.x - paddle.cx) / (paddle.w / 2); // -1 ~ +1
            const maxAng = 58 * (Math.PI / 180);
            const ang    = Math.sign(offset) * Math.pow(Math.abs(offset), 1.3) * maxAng;
            const spd    = Math.hypot(this.dx, this.dy);
            this.dx = Math.sin(ang) * spd;
            this.dy = Math.abs(Math.cos(ang) * spd); // 양수 = 다시 아래로
            if (this.dy < Ball.MIN_DY) this.dy = Ball.MIN_DY;
            this.y  = paddle.y + paddle.h + this.r + 1;
            return 'paddle';
        }

        return 'ok';
    }

    _hitPaddle(p) {
        return (
            this.y - this.r <= p.y + p.h &&
            this.y + this.r >= p.y &&
            this.x + this.r >= p.x &&
            this.x - this.r <= p.x + p.w
        );
    }

    draw(ctx) {
        const rainbow = this.rainbow;
        const hue     = rainbow ? (Date.now() * 0.4) % 360 : 0;

        // 잔상 (물방울 흔적)
        this.trail.forEach((pt, i) => {
            const t = (i + 1) / this.trail.length;
            if (rainbow) {
                const th = (hue + i * 45) % 360;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, this.r * 0.75 * t, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${th}, 100%, 60%, ${t * 0.42})`;
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, this.r * 0.65 * t, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200,230,255,${t * 0.22})`;
                ctx.fill();
            }
        });

        // 본체 — 방울 스타일
        ctx.save();
        ctx.shadowColor = rainbow ? `hsl(${hue}, 100%, 60%)` : this.color;
        ctx.shadowBlur  = rainbow ? 32 : 22;

        if (rainbow) {
            // 무지개 공 외곽 링 3겹
            for (let ri = 0; ri < 3; ri++) {
                const rh = (hue + ri * 120) % 360;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r + 3 + ri * 4, 0, Math.PI * 2);
                ctx.strokeStyle = `hsla(${rh}, 100%, 65%, ${0.55 - ri * 0.15})`;
                ctx.lineWidth   = 1.8 - ri * 0.35;
                ctx.stroke();
            }
        }

        // 메인 바디
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(
            this.x - this.r * 0.2, this.y - this.r * 0.25, this.r * 0.05,
            this.x + this.r * 0.1, this.y + this.r * 0.1, this.r
        );
        if (rainbow) {
            const h2 = (hue +  60) % 360;
            const h3 = (hue + 160) % 360;
            const h4 = (hue + 260) % 360;
            g.addColorStop(0,    'rgba(255,255,255,0.95)');
            g.addColorStop(0.25, `hsl(${hue}, 100%, 62%)`);
            g.addColorStop(0.55, `hsl(${h2},  100%, 55%)`);
            g.addColorStop(0.80, `hsl(${h3},  100%, 50%)`);
            g.addColorStop(1,    `hsl(${h4},   80%, 30%)`);
        } else {
            g.addColorStop(0,    'rgba(255,255,255,0.92)');
            g.addColorStop(0.28, this.color);
            g.addColorStop(0.85, this.color);
            g.addColorStop(1,    'rgba(0,0,0,0.32)');
        }
        ctx.fillStyle = g;
        ctx.fill();

        // 방울 테두리 (rim light)
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.strokeStyle = rainbow
            ? `hsla(${(hue + 180) % 360}, 100%, 80%, 0.65)`
            : 'rgba(255,255,255,0.42)';
        ctx.lineWidth   = rainbow ? 1.5 : 1.1;
        ctx.stroke();

        // 메인 하이라이트 — 좌상단 타원 (빛 반사)
        ctx.save();
        ctx.translate(this.x - this.r * 0.28, this.y - this.r * 0.30);
        ctx.scale(1, 0.58);
        ctx.beginPath();
        ctx.arc(0, 0, this.r * 0.44, 0, Math.PI * 2);
        const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, this.r * 0.44);
        hg.addColorStop(0,    'rgba(255,255,255,0.96)');
        hg.addColorStop(0.65, 'rgba(255,255,255,0.38)');
        hg.addColorStop(1,    'rgba(255,255,255,0)');
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.restore();

        // 보조 하이라이트 — 우하단 작은 점
        ctx.beginPath();
        ctx.arc(this.x + this.r * 0.38, this.y + this.r * 0.38, this.r * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.52)';
        ctx.fill();

        ctx.restore();
    }
}

/* ============================================================
   Paddle — 캔버스 상단 (y = 16), 마우스/키보드 lerp 이동

   [디자인 담당 TODO] 패들 위 니모 이모지를 이미지로 교체하려면:
   draw() 내 ctx.fillText('🐠', 0, 0) 을
   ctx.drawImage(nemoImg, -nemoImg.width/2, -nemoImg.height/2) 로 교체
   (이미지 로드는 nemo-game.js 상단에서 미리 처리)
============================================================ */
class Paddle {
    constructor(cw, ch) {
        this._baseW   = 100;
        this.w        = this._baseW;
        this.h        = 64; // nemo_father 비율(1192×762 ≈ 1.565) 유지
        this.x        = (cw - this.w) / 2;
        this.y        = 16; // 화면 상단 배치
        this.CW       = cw;
        this._targetX = this.x;
        this._expandT = 0;
        this.direction    = 'right'; // 마지막으로 누른 방향키 기준
        this._waterTrails = [];
        this._trailTimer  = 0;
        this._swingTimer  = 0;   // 남은 스윙 틱 (>0 이면 스윙 중)
        this._swingCd     = 0;   // 쿨다운 틱
    }

    get cx()         { return this.x + this.w / 2; }
    get isSwinging() { return this._swingTimer > 0; }
    get swingReady() { return this._swingTimer === 0 && this._swingCd === 0; }

    setDirection(dir) { this.direction = dir; }

    triggerSwing() {
        if (this._swingTimer > 0 || this._swingCd > 0) return;
        this._swingTimer = 36; // ~600ms (GIF 재생 시간)
    }

    moveTo(mouseX) {
        this._targetX = Math.max(0, Math.min(this.CW - this.w, mouseX - this.w / 2));
    }

    update() {
        this.x += (this._targetX - this.x) * 0.18;
        if (this._expandT > 0) { this._expandT--; this.w = this._baseW * 1.55; }
        else                   { this.w = this._baseW; }

        // 스윙 타이머 감소
        if (this._swingTimer > 0) {
            if (--this._swingTimer === 0) this._swingCd = 180; // 쿨다운 3초
        }
        if (this._swingCd > 0) this._swingCd--;

        // 헤엄칠 때 뒤쪽에서 물거품 생성
        const moveDelta = this._targetX - this.x;
        if (Math.abs(moveDelta) > 0.5) {
            if (++this._trailTimer % 4 === 0) {
                const tx = moveDelta > 0 ? this.x + 8 : this.x + this.w - 8;
                const count = Math.random() < 0.35 ? 2 : 1;
                for (let i = 0; i < count; i++) {
                    this._waterTrails.push({
                        x:      tx + (Math.random() - 0.5) * 18,
                        y:      this.y + this.h * (0.25 + Math.random() * 0.55),
                        r:      1.5 + Math.random() * 3.5,
                        alpha:  0.65 + Math.random() * 0.25,
                        vy:     -(0.5 + Math.random() * 0.9),
                        vx:     (Math.random() - 0.5) * 0.4,
                        wob:    Math.random() * Math.PI * 2,
                        wobSpd: 0.05 + Math.random() * 0.05,
                    });
                }
            }
        }
        for (let i = this._waterTrails.length - 1; i >= 0; i--) {
            const t = this._waterTrails[i];
            t.wob += t.wobSpd;
            t.x   += t.vx + Math.sin(t.wob) * 0.25;
            t.y   += t.vy;
            t.alpha -= 0.010 + (t.r < 2.5 ? 0.005 : 0);
            if (t.alpha <= 0) this._waterTrails.splice(i, 1);
        }
    }

    applyExpand(frames = 400) { this._expandT = frames; }

    draw(ctx) {
        const { x, y, w, h, direction } = this;

        // 물거품 먼저 그리기 (물고기 아래에 렌더링)
        this._waterTrails.forEach(t => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, t.alpha);
            // 반투명 버블 본체
            ctx.beginPath();
            ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(180,240,255,0.15)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(160,228,255,0.72)';
            ctx.lineWidth = 0.9;
            ctx.stroke();
            // 하이라이트 (왼쪽 위 작은 흰 점 — 버블 느낌)
            ctx.beginPath();
            ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.28, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fill();
            ctx.restore();
        });

        ctx.save();
        if (this._swingTimer > 0) {
            // 스윙 프레임은 560×560 정사각형 — 높이 기준(h×h)으로 유지하고 가운데 정렬
            const TOTAL = 36;
            const frameIdx = Math.min(6, Math.floor((TOTAL - this._swingTimer) * 7 / TOTAL));
            const img = swingFrames[direction][frameIdx];
            ctx.drawImage(img, x + (w - h) / 2, y, h, h);
        } else {
                ctx.drawImage(swingFrames[direction][0], x, y, w, h);
        }
        ctx.restore();
    }
}

/* ============================================================
   Block — normal / hard / vortex
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
        this._cp       = ROW_COLORS[row % ROW_COLORS.length];
        this._imgIdx   = row % 3;
        this.hp        = type === BT.hard ? 3 : 1;
        this.maxHp     = this.hp;
        this._vang     = Math.random() * Math.PI * 2;
        this._cracks   = [];
        this._itemType = null;
        this._flashT   = 0; // 하드 블록 피격 플래시 타이머
    }

    get color() { return this._cp[0]; }

    hit() {
        this.hp--;
        if (this.hp > 0) {
            this._addCrack();
            this._flashT = 8; // 피격 플래시 트리거
        } else {
            this.alive = false;
        }
        return this.hp;
    }

    _addCrack() {
        const x1 = this.x + Math.random() * this.w * 0.3 + this.w * 0.1;
        const y1 = this.y + Math.random() * this.h * 0.3 + this.h * 0.1;
        const x2 = this.x + Math.random() * this.w * 0.5 + this.w * 0.2;
        const y2 = this.y + Math.random() * this.h * 0.5 + this.h * 0.1;
        this._cracks.push({ x1, y1, x2, y2 });
    }

    update() {
        if (this.type === BT.vortex) this._vang += 0.04;
        if (this._flashT > 0) this._flashT--;
    }

    draw(ctx) {
        if (!this.alive) return;
        const { x, y, w, h } = this;
        const bImgs = typeof blockImgs !== 'undefined' ? blockImgs : null;

        ctx.save();

        if (this.type === BT.normal) {
            ctx.shadowColor = this._cp[0];
            ctx.shadowBlur  = 8;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.clip();
            if (bImgs?.[this._imgIdx]?.complete) {
                ctx.drawImage(bImgs[this._imgIdx], x + 1, y + 1, w - 2, h - 2);
            } else {
                const g = ctx.createLinearGradient(x, y, x, y + h);
                g.addColorStop(0, this._cp[1]);
                g.addColorStop(1, this._cp[0]);
                ctx.fillStyle = g;
                ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
            }
            ctx.restore();

        } else if (this.type === BT.hard) {
            const flashAlpha = this._flashT > 0 ? (this._flashT / 8) * 0.65 : 0;
            ctx.shadowColor  = this._flashT > 0 ? '#ffffff' : '#666';
            ctx.shadowBlur   = this._flashT > 0 ? 20 : 6;

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.clip();
            if (bImgs?.[2]?.complete) {
                ctx.drawImage(bImgs[2], x + 1, y + 1, w - 2, h - 2);
            } else {
                const g = ctx.createLinearGradient(x, y, x + w, y + h);
                g.addColorStop(0,   '#6b7280');
                g.addColorStop(0.5, '#374151');
                g.addColorStop(1,   '#1f2937');
                ctx.fillStyle = g;
                ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
            }
            ctx.fillStyle = 'rgba(20,20,30,0.52)';
            ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
            ctx.restore();

            if (flashAlpha > 0) {
                ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
                ctx.beginPath();
                ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
                ctx.fill();
            }

            ctx.strokeStyle = 'rgba(255,255,255,0.65)';
            ctx.lineWidth   = 1.2;
            this._cracks.forEach(c => {
                ctx.beginPath();
                ctx.moveTo(c.x1, c.y1);
                ctx.lineTo(c.x2, c.y2);
                ctx.stroke();
            });

            for (let i = 0; i < this.maxHp; i++) {
                ctx.beginPath();
                ctx.arc(x + 6 + i * 8, y + h / 2, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = i < this.hp ? '#fff' : 'rgba(255,255,255,0.2)';
                ctx.fill();
            }

        } else { // vortex
            ctx.shadowColor = '#00b4d8';
            ctx.shadowBlur  = 12;

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.clip();
            if (bImgs?.[1]?.complete) {
                ctx.drawImage(bImgs[1], x + 1, y + 1, w - 2, h - 2);
            } else {
                const g = ctx.createLinearGradient(x, y, x + w, y + h);
                g.addColorStop(0, '#0077b6');
                g.addColorStop(1, '#023e8a');
                ctx.fillStyle = g;
                ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
            }
            ctx.fillStyle = 'rgba(0,50,120,0.45)';
            ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
            ctx.restore();

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

        ctx.restore();
    }
}

/* ============================================================
   아이템 타입 정보
   [기획 담당 수정 가능] label · color 만 수정하세요.
   새 타입 추가 시 nemo-game.js _applyItem() 에 케이스 추가 필요.

   · extraBall  : 공 1개 추가
   · paddleWide : 패들 너비 확장 (일정 시간)
   · multiball  : 현재 공 각각에서 ±30° 복사본 2개 생성 (분열)
   · speedUp    : 공 속도 20% 즉시 증가
   · slowBall   : 공 속도 감소 (4초)
   · extraLife  : 목숨 1개 추가
============================================================ */
const ITEM_INFO = {
    extraBall:  { label: '+B',  color: '#f7d716' },
    paddleWide: { label: 'PW',  color: '#ff6b35' },
    multiball:  { label: '×3',  color: '#ff6b9d' },
    speedUp:    { label: 'SP↑', color: '#ff4500' },
    slowBall:   { label: 'SL',  color: '#4fc3f7' },
    extraLife:  { label: '+♥',  color: '#ff69b4' },
};

/* ============================================================
   Item — 아이템 드롭 (블록 상단 → 패들 방향으로 낙하)

   [디자인 담당 TODO] 이모지/텍스트 대신 아이콘 이미지를 사용하려면:
   draw() 내 ctx.fillText(info.label, ...) 을
   ctx.drawImage(itemImgs[this.type], this.x-r, this.y-r, r*2, r*2) 로 교체
============================================================ */
class Item {
    constructor(x, y, type) {
        this.x     = x; this.y = y; this.type = type;
        this.r     = 12;
        this.dy    = -2.2; // 음수 = 위로 떠오름 (패들 방향)
        this.dx    = (Math.random() - 0.5) * 0.8;
        this.alive = true;
        this._wob  = 0;
    }

    update(cw, ch) {
        this._wob += 0.08;
        this.dx   += Math.sin(this._wob) * 0.04;
        this.dx    = Math.max(-1.5, Math.min(1.5, this.dx));
        this.x    += this.dx;
        this.y    += this.dy;
        if (this.x - this.r < 0 || this.x + this.r > cw) this.dx *= -1;
        if (this.y + this.r < 0) this.alive = false; // 화면 상단 이탈
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
        g.addColorStop(0,   '#fff');
        g.addColorStop(0.5, info.color);
        g.addColorStop(1,   info.color + '88');
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
