'use strict';
/* ============================================================
   nemo-objects.js — 구현 A 담당 파일
   역할: AudioManager, ScorePopup, Particle, Ball, Paddle, Block, Item
============================================================ */

/* ============================================================
   AudioManager
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
        this._ac = new (window.AudioContext || window.webkitAudioContext)();
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

    playBlockBreak() {
        this._noise(0.09, 0.6);
        this._tone(320, 'sine', 0.07, 0.4);
    }

    playHardHit() {
        this._tone(80,  'sawtooth', 0.15, 0.7);
        this._tone(120, 'sine',     0.10, 0.3);
    }

    playItemGet() {
        [440, 550, 660].forEach((f, i) =>
            setTimeout(() => this._tone(f, 'sine', 0.18, 0.5), i * 60)
        );
    }

    playSharkAlert() {
        this._tone(55,  'sawtooth', 0.6, 0.8);
        this._tone(110, 'square',   0.3, 0.3);
    }

    playPaddleHit() { this._tone(280, 'sine', 0.06, 0.4); }

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
        this.vy   *= 0.97;   // 위로 올라갈수록 감속
        this.life -= this.decay;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha    = Math.max(0, this.life);
        ctx.font           = 'bold 16px Orbitron, sans-serif';
        ctx.textAlign      = 'center';
        ctx.textBaseline   = 'middle';
        ctx.fillStyle      = '#FFD700';
        ctx.shadowColor    = '#FF8C00';
        ctx.shadowBlur     = 12;
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

/* ============================================================
   Particle — 3종류:
     bubble : 위로 솟구치는 기포
     rect   : 벽돌 색상 사각형 파편 (6~8개, 사방으로 튀어 중력 낙하)
     debris : 원형 파편 (하위호환)
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
            this.pw    = Math.random() * 7 + 4;   // 가로 4~11px
            this.ph    = Math.random() * 5 + 3;   // 세로 3~8px
            const ang  = Math.random() * Math.PI * 2;  // 사방 360°
            const spd  = Math.random() * 5 + 2;
            this.dx    = Math.cos(ang) * spd;
            this.dy    = Math.sin(ang) * spd;
            this.decay = 0.020 + Math.random() * 0.018;
            this.color = color;
            this.rot   = Math.random() * Math.PI * 2;
            this.rotSpd = (Math.random() - 0.5) * 0.30;

        } else {
            // debris (circle)
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
            this.dy  += 0.20;   // 중력
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
            ctx.fillStyle = g;
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

/**
 * 벽돌 파괴 시 파티클 생성
 * · bubble 3~4개 + rect 사각형 파편 6~8개
 */
function spawnParticles(x, y, color) {
    const out = [];
    const nb  = 3 + Math.floor(Math.random() * 2);   // bubble 3~4
    const nd  = 6 + Math.floor(Math.random() * 3);   // rect   6~8
    for (let i = 0; i < nb; i++) out.push(new Particle(x, y, 'bubble', color));
    for (let i = 0; i < nd; i++) out.push(new Particle(x, y, 'rect',   color));
    return out;
}

/* ============================================================
   Ball — 상하 반전 물리 (패들 상단, 블록 하단)
   · trail 4개 잔상
   · 패들 반사: pow(1.3) 커브로 중앙 수직, 가장자리 날카롭게
============================================================ */
class Ball {
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
    }

    launch(speed) {
        this.stuck = false;
        // Max ±45° from vertical — prevents near-horizontal trajectories at launch
        const angle = (Math.random() - 0.5) * Math.PI * 0.5;
        this.dx = Math.sin(angle) * speed;
        this.dy = Math.cos(angle) * speed;
    }

    update(paddle, cw, ch) {
        if (this.stuck) {
            this.x = paddle.cx + this.stuckDx;
            this.y = paddle.y + paddle.h + this.r + 1;
            return 'ok';
        }

        const s = this.slowTimer > 0 ? 0.45 : 1.0;
        if (this.slowTimer > 0) this.slowTimer--;

        // 잔상: 최근 4프레임
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 4) this.trail.shift();

        this.x += this.dx * s;
        this.y += this.dy * s;

        if (this.x - this.r < 0)  { this.x = this.r;      this.dx =  Math.abs(this.dx); }
        if (this.x + this.r > cw) { this.x = cw - this.r; this.dx = -Math.abs(this.dx); }
        if (this.y + this.r >= ch) { this.y = ch - this.r; this.dy = -Math.abs(this.dy); }
        if (this.y + this.r < 0)  return 'lost';

        // 패들 충돌 — 공이 위로 올라갈 때만
        if (this.dy < 0 && this._hitPaddle(paddle)) {
            // 중앙 → 수직, 가장자리 → 날카로운 각도 (pow 1.3 커브)
            // maxAng 58° — dy가 최소 cos(58°)≈0.53*spd 보장, 낮은 각도 방지
            const offset = (this.x - paddle.cx) / (paddle.w / 2);  // -1 ~ 1
            const maxAng = 58 * (Math.PI / 180);
            const ang    = Math.sign(offset) * Math.pow(Math.abs(offset), 1.3) * maxAng;
            const spd    = Math.hypot(this.dx, this.dy);
            this.dx = Math.sin(ang) * spd;
            this.dy = Math.abs(Math.cos(ang) * spd);  // 다시 아래 방향
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
        // 잔상 렌더링 (오래될수록 작고 투명)
        this.trail.forEach((pt, i) => {
            const t = (i + 1) / this.trail.length;  // 0.25 → 1.0
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, this.r * 0.75 * t, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,107,53,${t * 0.45})`;
            ctx.fill();
        });

        // 본체
        ctx.save();
        ctx.shadowColor = this.color;
        ctx.shadowBlur  = 18;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(
            this.x - this.r * 0.35, this.y - this.r * 0.35, 0,
            this.x, this.y, this.r
        );
        g.addColorStop(0,   '#fff');
        g.addColorStop(0.4, this.color);
        g.addColorStop(1,   '#803010');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
    }
}

/* ============================================================
   Paddle — 캔버스 상단 (y = 16), 마우스/키보드 lerp 이동
============================================================ */
class Paddle {
    constructor(cw) {
        this._baseW   = 130;
        this.w        = this._baseW;
        this.h        = 12;
        this.x        = (cw - this.w) / 2;
        this.y        = 16;
        this.CW       = cw;
        this._targetX = this.x;
        this._fin     = 0;
        this._hitAnim = 0;
        this.reversed = false;
        this.shield   = false;
        this._shieldT = 0;
        this._expandT = 0;
    }

    get cx() { return this.x + this.w / 2; }

    moveTo(mouseX) {
        const tx = this.reversed ? this.CW - mouseX : mouseX;
        this._targetX = Math.max(0, Math.min(this.CW - this.w, tx - this.w / 2));
    }

    update() {
        this.x += (this._targetX - this.x) * 0.18;
        this._fin++;
        if (this._hitAnim > 0) this._hitAnim--;
        if (this._shieldT > 0) { this._shieldT--; } else { this.shield = false; }
        if (this._expandT > 0) { this._expandT--; this.w = this._baseW * 1.55; }
        else                   { this.w = this._baseW; }
    }

    applyShield(frames = 300) { this.shield = true; this._shieldT = frames; }
    applyExpand(frames = 400) { this._expandT = frames; }
    onBallHit()               { this._hitAnim = 22; }

    draw(ctx) {
        const { x, y, w, h } = this;
        const cx = x + w / 2;

        ctx.save();
        ctx.shadowColor = this.shield ? '#f7d716' : '#ff6b35';
        ctx.shadowBlur  = this.shield ? 22 : 14;

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

        ctx.save();
        ctx.shadowBlur  = 0;
        ctx.shadowColor = 'transparent';
        if (this._hitAnim > 0) {
            ctx.shadowColor = 'rgba(255,140,50,0.55)';
            ctx.shadowBlur  = 6;
        }
        const nemoWobble = this._hitAnim > 0
            ? Math.sin(this._hitAnim * 0.35) * (this._hitAnim / 22) * 0.45 : 0;
        const nemoScale  = 1 + (this._hitAnim / 22) * 0.2;
        ctx.translate(cx + 14, y - 8);
        ctx.rotate(nemoWobble);
        ctx.scale(-nemoScale, nemoScale);
        ctx.font         = '18px serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐠', 0, 0);
        ctx.restore();

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
        this.hp        = type === BT.hard ? 3 : 1;
        this.maxHp     = this.hp;
        this._vang     = Math.random() * Math.PI * 2;
        this._cracks   = [];
        this._itemType = null;
    }

    get color() { return this._cp[0]; }

    hit() {
        this.hp--;
        if (this.hp > 0) this._addCrack();
        else             this.alive = false;
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
    }

    draw(ctx) {
        if (!this.alive) return;
        const { x, y, w, h } = this;
        ctx.save();

        if (this.type === BT.normal) {
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
            ctx.shadowColor = '#666';
            ctx.shadowBlur  = 6;
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0,   '#6b7280');
            g.addColorStop(0.5, '#374151');
            g.addColorStop(1,   '#1f2937');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.fill();

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

        } else {
            ctx.shadowColor = '#00b4d8';
            ctx.shadowBlur  = 12;
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, '#0077b6');
            g.addColorStop(1, '#023e8a');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
            ctx.fill();

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

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth   = 0.8;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 3);
        ctx.stroke();

        ctx.restore();
    }
}

Block._img = null;

/* ============================================================
   Item — 아이템 드롭 (부력으로 위로 이동)
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
        this.dy    = -2.2;
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
