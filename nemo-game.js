'use strict';
/* ============================================================
   nemo-game.js — 구현 B 담당 파일
   역할: Shark, A*(AStarGrid/Dory), Game 메인 컨트롤러, 부트스트랩
   추가: 게임 상태(READY/PLAYING), 화면 흔들림, 방향키 조작,
         점수 팝업, 개선된 패들 물리
============================================================ */

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

const LS_KEY = 'nemo_breakout_v1';
function loadSave()      { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function writeSave(data) { localStorage.setItem(LS_KEY, JSON.stringify({ ...loadSave(), ...data })); }

const STAGE_CFG = {
    1: { speed: 4.2, timerSec: null, rows: 6,  cols: 13, blackout: 0, shark: false, vortex: false, dorisAI: true  },
    2: { speed: 5.8, timerSec: 90,   rows: 8,  cols: 13, blackout: 2, shark: true,  vortex: false, dorisAI: false },
    3: { speed: 7.5, timerSec: 60,   rows: 10, cols: 13, blackout: 1, shark: false, vortex: true,  dorisAI: false },
};

/* ============================================================
   Shark — Stage 2 횡단 장애물
============================================================ */
class Shark {
    constructor(cw, ch, speed = 2.8) {
        this.CW = cw; this.CH = ch;
        this.w  = 80; this.h  = 40;
        this.x  = -this.w;
        this.y  = ch * 0.3 + (Math.random() - 0.5) * 60;
        this.dx = speed;
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

        ctx.fillStyle = '#4a90d9';
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#357abd';
        ctx.beginPath();
        ctx.moveTo(-5, -h / 2); ctx.lineTo(5, -h / 2 - 18); ctx.lineTo(14, -h / 2);
        ctx.closePath(); ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(-w / 2 - 18, -12);
        ctx.lineTo(-w / 2 - 18,  12);
        ctx.closePath(); ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(w / 2 - 10, -5, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(w / 2 - 9, -5, 2.5, 0, Math.PI * 2); ctx.fill();

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
   AStarGrid — A* 경로 탐색 (Stage 1 Dory AI)
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

    findPath(start, end) {
        const key = (c, r) => c * 1000 + r;
        const h   = (c, r) => Math.abs(c - end.col) + Math.abs(r - end.row);
        const open   = [{ col: start.col, row: start.row, g: 0, f: h(start.col, start.row), prev: null }];
        const closed = new Set();
        const gMap   = new Map([[key(start.col, start.row), 0]]);

        while (open.length) {
            open.sort((a, b) => a.f - b.f);
            const cur = open.shift();
            const ck  = key(cur.col, cur.row);

            if (cur.col === end.col && cur.row === end.row) {
                const path = [];
                let node   = cur;
                while (node) { path.unshift({ col: node.col, row: node.row }); node = node.prev; }
                return path;
            }

            if (closed.has(ck)) continue;
            closed.add(ck);

            for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
                const nc = cur.col + dc;
                const nr = cur.row + dr;
                if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
                if (this.grid[nr][nc] === 1) continue;
                const nk   = key(nc, nr);
                if (closed.has(nk)) continue;
                const newG = cur.g + 1;
                if (newG >= (gMap.get(nk) ?? Infinity)) continue;
                gMap.set(nk, newG);
                open.push({ col: nc, row: nr, g: newG, f: newG + h(nc, nr), prev: cur });
            }
        }
        return [];
    }

    toGrid(px, py) {
        return { col: Math.floor(px / this.cell), row: Math.floor(py / this.cell) };
    }

    toPixel(col, row) {
        return { x: col * this.cell + this.cell / 2, y: row * this.cell + this.cell / 2 };
    }
}

/* ============================================================
   Dory — Stage 1 A* AI
============================================================ */
class Dory {
    constructor(cw, ch) {
        this.x       = cw / 2;
        this.y       = ch - 60;
        this.r       = 18;
        this.spd     = 1.6;
        this.grid    = new AStarGrid(cw, ch);
        this.path    = [];
        this.pathPx  = [];
        this.pathIdx = 0;
        this._recT   = 0;
        this._wob    = 0;
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
        if (this._recT++ % 60 === 0) this.recalcPath(blocks, paddle);
        this._wob += 0.07;
        if (!this.pathPx.length || this.pathIdx >= this.pathPx.length) return;
        const tgt  = this.pathPx[this.pathIdx];
        const dx   = tgt.x - this.x;
        const dy   = tgt.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < this.spd + 1) { this.pathIdx++; }
        else { this.x += (dx / dist) * this.spd; this.y += (dy / dist) * this.spd; }
    }

    drawPath(ctx) {
        for (let r = 0; r < this.grid.rows; r++) {
            for (let c = 0; c < this.grid.cols; c++) {
                if (this.grid.grid[r][c] === 1) {
                    ctx.fillStyle = 'rgba(255,60,60,0.08)';
                    ctx.fillRect(c * this.grid.cell, r * this.grid.cell, this.grid.cell, this.grid.cell);
                }
            }
        }
        if (this.pathPx.length < 2) return;
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(0,200,255,0.35)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        for (let i = this.pathIdx; i < this.pathPx.length; i++)
            ctx.lineTo(this.pathPx[i].x, this.pathPx[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
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
   · 게임 상태: READY (공 대기) / PLAYING (게임 중)
   · 화면 흔들림(Screen Shake) — 벽돌 파괴 시 6프레임
   · 방향키(←→) 패들 조작 지원
   · 점수 팝업(ScorePopup) 렌더링
============================================================ */
class Game {
    constructor() {
        this.audio    = new AudioManager();
        this.dialogue = new DialogueManager(this.audio);

        this._stage    = 1;
        this._score    = 0;
        this._lives    = 3;
        this._timer    = 0;
        this._timerMs  = 0;
        this._running  = false;
        this._paused   = false;
        this._clearing = false;
        this._raf      = null;
        this._lastTs   = 0;

        this._balls     = [];
        this._paddle    = null;
        this._blocks    = [];
        this._items     = [];
        this._particles = [];
        this._shark     = null;
        this._dory      = null;
        this._mouseX    = CW / 2;
        this._revTimer  = 0;

        // 신규: 게임 상태 / 화면 흔들림 / 점수 팝업 / 방향키
        this._phase          = 'READY';   // 'READY' | 'PLAYING'
        this._shakeFrames    = 0;
        this._shakeIntensity = 6;
        this._scorePopups    = [];
        this._keysDown       = { ArrowLeft: false, ArrowRight: false };

        const sv = loadSave();
        this._highScore     = sv.highScore     || 0;
        this._clearedStages = sv.clearedStages || [];
        this._settings      = sv.settings      || { bgm:'on', sfx:'on', speed:'1x', theme:'deep', tsize:'md' };

        this._initUI();
        this._loadSettingsUI();
        this._applyUnlocked();
        showScreen('lobby');
    }

    // ── UI 이벤트 바인딩 ──────────────────────────────────────
    _initUI() {
        document.getElementById('btnStart').addEventListener('click', () => {
            showScreen('stages'); this._applyUnlocked();
        });
        document.getElementById('btnSettings').addEventListener('click', () => openModal(modalSettings));
        document.getElementById('btnCredits').addEventListener('click',  () => openModal(modalCredits));
        document.getElementById('btnBackLobby').addEventListener('click', () => showScreen('lobby'));

        document.querySelectorAll('.stage-card').forEach(card => {
            card.querySelector('.btn-stage')?.addEventListener('click', () => {
                if (!card.classList.contains('stage-locked'))
                    this._launchStage(Number(card.dataset.stage));
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
        document.getElementById('btnCloseCredits').addEventListener('click',  () => closeModal(modalCredits));

        [modalSettings, modalCredits].forEach(m =>
            m.addEventListener('click', e => { if (e.target === m) closeModal(m); })
        );

        document.querySelectorAll('.toggle-group').forEach(grp => {
            grp.addEventListener('click', e => {
                const b = e.target.closest('.toggle-btn');
                if (!b) return;
                grp.querySelectorAll('.toggle-btn').forEach(x => x.classList.remove('on'));
                b.classList.add('on');
            });
        });

        document.querySelectorAll('.color-swatches').forEach(c => {
            c.addEventListener('click', e => {
                const sw = e.target.closest('.swatch');
                if (!sw) return;
                c.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
            });
        });

        // 마우스 이동
        canvas.addEventListener('mousemove', e => {
            const rect = canvas.getBoundingClientRect();
            this._mouseX = (e.clientX - rect.left) * (CW / rect.width);
        });

        // 캔버스 클릭 → 공 발사
        canvas.addEventListener('click', () => {
            if (this._running && !this._paused) this._launchBalls();
        });

        // 키보드 입력
        document.addEventListener('keydown', e => {
            const gameActive = screenEls.game.classList.contains('active');

            // 방향키 ← → : 패들 이동
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                if (gameActive) {
                    e.preventDefault();
                    this._keysDown[e.code] = true;
                }
                return;
            }

            // Space : 공 발사 (READY → PLAYING)
            if (e.code === 'Space' && gameActive) {
                e.preventDefault();
                if (this._running && !this._paused) this._launchBalls();
                return;
            }

            // P : 일시정지
            if ((e.key === 'p' || e.key === 'P') && gameActive) {
                this._togglePause();
                return;
            }

            // Escape : 모달 닫기
            if (e.key === 'Escape') {
                if (!modalSettings.classList.contains('hidden')) { closeModal(modalSettings); return; }
                if (!modalCredits.classList.contains('hidden'))  { closeModal(modalCredits);  return; }
            }
        });

        document.addEventListener('keyup', e => {
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                this._keysDown[e.code] = false;
            }
        });
    }

    _applyUnlocked() {
        const cleared = loadSave().clearedStages || [];
        document.querySelectorAll('.stage-card').forEach(card => {
            const n  = Number(card.dataset.stage);
            const ok = n === 1 || cleared.includes(n - 1);
            card.classList.toggle('stage-locked', !ok);
            const btn = card.querySelector('.btn-stage');
            if (btn) { btn.disabled = !ok; btn.textContent = ok ? '시작하기' : '잠금 해제 필요'; }
        });
    }

    // ── 스테이지 실행 흐름 ────────────────────────────────────
    _launchStage(n) {
        this._stage = n;
        const names = { 1:'조력자 구출', 2:'상어의 위협', 3:'니모 구하기' };
        document.querySelector('.vn-stage-tag').textContent = `STAGE ${n} — ${names[n]}`;
        showScreen('dialog');
        this.dialogue.play(n, () => { showScreen('game'); this._initStage(n); });
    }

    _initStage(n) {
        const cfg    = STAGE_CFG[n];
        const spdMul = { '1x':1, '1.2x':1.2, '1.4x':1.4 }[this._settings.speed] ?? 1;
        this._spdMul    = spdMul;
        this._baseSpeed = cfg.speed * spdMul;

        this._lives    = 3;
        this._score    = 0;
        this._timer    = cfg.timerSec ?? 0;
        this._timerMs  = 0;
        this._running  = true;
        this._paused   = false;
        this._clearing = false;
        this._revTimer = 0;
        this._blocksDestroyed = 0;
        this._particles  = [];
        this._items      = [];
        this._scorePopups = [];
        this._shakeFrames = 0;
        this._phase      = 'READY';  // 공 대기 상태로 시작

        hudStageEl.textContent = String(n).padStart(2, '0');
        this._syncHUD();

        this._paddle = new Paddle(CW);
        this._blocks = this._buildBlocks(cfg);
        this._balls  = [this._newBall()];

        this._shark = cfg.shark   ? new Shark(CW, CH, 2.8 * spdMul) : null;
        this._dory  = cfg.dorisAI ? new Dory(CW, CH)  : null;
        if (this._dory)  this._dory.recalcPath(this._blocks, this._paddle);
        if (this._shark) setTimeout(() => this.audio.playSharkAlert(), 600);

        document.getElementById('canvasPlaceholder').style.display = 'none';
        document.getElementById('btnPause').textContent = '⏸';

        if (this._raf) cancelAnimationFrame(this._raf);
        this._lastTs = 0;
        this._raf = requestAnimationFrame(ts => this._loop(ts));
    }

    _buildBlocks(cfg) {
        const sideMargin   = 32;
        const bottomMargin = 32;
        const gap = 5, bh = 22;
        const bw     = (CW - sideMargin * 2 - gap * (cfg.cols - 1)) / cfg.cols;
        const totalH = cfg.rows * (bh + gap);
        const startY = CH - bottomMargin - totalH;
        const itemPool = ['extraBall', 'shield', 'paddleWide'];
        const blocks   = [];

        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
                const x = sideMargin + c * (bw + gap);
                const y = startY + r * (bh + gap);

                let type = BT.normal;
                if (r === 0)                               type = BT.hard;
                else if (cfg.vortex && (r + c) % 5 === 0) type = BT.vortex;

                const b = new Block(x, y, bw, bh, type, r);
                if (Math.random() < 0.25)
                    b._itemType = itemPool[Math.floor(Math.random() * itemPool.length)];
                blocks.push(b);
            }
        }
        return blocks;
    }

    _newBall() {
        const b = new Ball(
            this._paddle.cx,
            this._paddle.y + this._paddle.h + 10,
            this._ballColor()
        );
        b.stuck = true; b.stuckDx = 0;
        return b;
    }

    _ballColor() {
        const sw = document.querySelector('.color-swatches .swatch.selected');
        return sw ? getComputedStyle(sw).getPropertyValue('--sc').trim() : '#ff6b35';
    }

    /** 공 발사 + PLAYING 상태 전환 */
    _launchBalls() {
        const hadStuck = this._balls.some(b => b.stuck);
        this._balls.forEach(b => { if (b.stuck) b.launch(this._baseSpeed); });
        if (hadStuck) this._phase = 'PLAYING';
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

        // ── 방향키 → _mouseX 조정 후 패들 이동 ──
        const arrowSpd = 10 * this._spdMul;
        if (this._keysDown.ArrowLeft)  this._mouseX = Math.max(0,  this._mouseX - arrowSpd);
        if (this._keysDown.ArrowRight) this._mouseX = Math.min(CW, this._mouseX + arrowSpd);

        this._paddle.moveTo(this._mouseX);
        this._paddle.update();

        if (this._revTimer > 0) {
            this._revTimer--;
            this._paddle.reversed = this._revTimer > 0;
        }

        // ── 상어 (Stage 2) ──
        if (this._shark) {
            this._shark.update();
            for (const b of this._balls) {
                if (!b.stuck && this._shark.hitsBall(b)) {
                    b.dx *= -1;
                    if (this._revTimer === 0) this.audio.playSharkAlert();
                    this._revTimer = 150;
                }
            }
        }

        // ── 도리 A* (Stage 1) ──
        if (this._dory) this._dory.update(this._blocks, this._paddle);

        // ── 공 물리 ──
        for (let i = this._balls.length - 1; i >= 0; i--) {
            const b   = this._balls[i];
            const res = b.update(this._paddle, CW, CH);
            if      (res === 'paddle') { this.audio.playPaddleHit(); this._paddle.onBallHit(); }
            else if (res === 'lost') {
                if (this._balls.length > 1) this._balls.splice(i, 1);
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
                    // 단단한 블록: 타격음 (미파괴)
                    this.audio.playHardHit();
                } else {
                    // 블록 파괴
                    this.audio.playBlockBreak();

                    // 화면 흔들림 트리거 (6프레임)
                    this._shakeFrames = 6;

                    // 점수 계산 (100 / 200 / 300)
                    const pts = block.type === BT.hard ? 300 : block.type === BT.vortex ? 200 : 100;
                    this._score += pts;
                    this._syncHUD(true);
                    this._saveHigh();

                    // 점수 팝업
                    this._scorePopups.push(new ScorePopup(
                        block.x + block.w / 2,
                        block.y + block.h / 2,
                        pts
                    ));

                    // 파티클 (기포 + 사각형 파편)
                    this._particles.push(...spawnParticles(
                        block.x + block.w / 2, block.y + block.h / 2, block.color
                    ));

                    // 아이템 드롭
                    if (block._itemType)
                        this._items.push(new Item(block.x + block.w / 2, block.y + block.h / 2, block._itemType));

                    // 점진적 속도 증가 — 8블록 파괴마다 5% 가속, 최대 기본속도의 1.35배
                    this._blocksDestroyed++;
                    if (this._blocksDestroyed % 8 === 0) {
                        const cap = this._baseSpeed * 1.35;
                        for (const b of this._balls) {
                            if (b.stuck) continue;
                            const spd = Math.hypot(b.dx, b.dy);
                            if (spd > 0 && spd < cap) {
                                const ns = Math.min(spd + this._baseSpeed * 0.05, cap);
                                b.dx = (b.dx / spd) * ns;
                                b.dy = (b.dy / spd) * ns;
                            }
                        }
                    }
                }

                if (block.type === BT.vortex && block.alive) ball.slowTimer = 90;
            }
        }

        // ── 아이템 ──
        for (let i = this._items.length - 1; i >= 0; i--) {
            const it = this._items[i];
            it.update(CW);
            if (it.hits(this._paddle)) { this._applyItem(it.type); this._items.splice(i, 1); }
            else if (!it.alive)        { this._items.splice(i, 1); }
        }

        // ── 파티클 ──
        for (let i = this._particles.length - 1; i >= 0; i--) {
            this._particles[i].update();
            if (this._particles[i].dead) this._particles.splice(i, 1);
        }

        // ── 점수 팝업 ──
        for (let i = this._scorePopups.length - 1; i >= 0; i--) {
            this._scorePopups[i].update();
            if (this._scorePopups[i].dead) this._scorePopups.splice(i, 1);
        }

        // ── 클리어 판정 ──
        if (!this._clearing && this._blocks.every(b => !b.alive)) {
            this._clearing = true;
            this._stageClear();
        }
    }

    _collide(ball, block) {
        const { x, y, r }           = ball;
        const { x: bx, y: by, w: bw, h: bh } = block;
        const nearX = Math.max(bx, Math.min(x, bx + bw));
        const nearY = Math.max(by, Math.min(y, by + bh));
        if (Math.hypot(x - nearX, y - nearY) > r) return false;
        const ovX = Math.min(x + r - bx, bx + bw - (x - r));
        const ovY = Math.min(y + r - by, by + bh - (y - r));
        if (ovX < ovY) ball.dx *= -1;
        else           ball.dy *= -1;
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
        if (this._lives <= 0) {
            this._gameOver(false);
        } else {
            // 공 패들에 재부착 + READY 상태 복귀
            this._balls = [this._newBall()];
            this._phase = 'READY';
        }
    }

    // ── 스테이지 클리어 ───────────────────────────────────────
    _stageClear() {
        this._running = false;
        cancelAnimationFrame(this._raf);
        this.audio.playStageClear();

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

        if (DIALOGUE[outKey]) { showScreen('dialog'); this.dialogue.play(outKey, next); }
        else                  { setTimeout(next, 800); }
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
        ctx.shadowColor  = color; ctx.shadowBlur = 32;
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

        // 배경 (흔들림 없음)
        const bg = ctx.createLinearGradient(0, 0, 0, CH);
        bg.addColorStop(0, '#0a1e38');
        bg.addColorStop(1, '#050e1c');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CW, CH);

        // ── 화면 흔들림 적용 영역 (게임 오브젝트 전체) ──
        ctx.save();
        if (this._shakeFrames > 0) {
            const progress = this._shakeFrames / 6;  // 1.0 → 0
            const ix = (Math.random() - 0.5) * this._shakeIntensity * 2 * progress;
            const iy = (Math.random() - 0.5) * this._shakeIntensity * 2 * progress;
            ctx.translate(ix, iy);
            this._shakeFrames--;
        }

        if (this._dory)  this._dory.drawPath(ctx);
        this._particles.forEach(p  => p.draw(ctx));
        this._blocks.forEach(b     => b.draw(ctx));
        this._items.forEach(it     => it.draw(ctx));
        if (this._dory)  this._dory.draw(ctx);
        if (this._shark) this._shark.draw(ctx);
        this._balls.forEach(b      => b.draw(ctx));
        this._paddle.draw(ctx);

        this._drawBlackout();

        // 점수 팝업 (흔들림 영역 내부 — 세계 공간)
        this._scorePopups.forEach(sp => sp.draw(ctx));

        ctx.restore();
        // ── 흔들림 영역 종료 ──

        // 상태 텍스트 (UI — 흔들림 없음)
        if (this._revTimer > 0) {
            ctx.save();
            ctx.globalAlpha = 0.6 + Math.sin(Date.now() * 0.01) * 0.35;
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

        // ── READY 상태: "PRESS SPACE TO START" 깜빡임 ──
        if (this._phase === 'READY' && this._running) {
            // 사인파로 부드럽게 깜빡임
            const alpha = Math.sin(Date.now() * 0.004) * 0.45 + 0.55;  // 0.1 ~ 1.0
            ctx.save();
            ctx.globalAlpha    = alpha;
            ctx.textAlign      = 'center';
            ctx.textBaseline   = 'middle';
            ctx.font           = 'bold 22px Orbitron, sans-serif';
            ctx.fillStyle      = '#ffffff';
            ctx.shadowColor    = '#00b4d8';
            ctx.shadowBlur     = 20;
            ctx.fillText('PRESS SPACE TO START', CW / 2, CH * 0.35);
            ctx.restore();
        }
    }

    _drawBlackout() {
        const cfg = STAGE_CFG[this._stage];
        if (!cfg.blackout) return;

        const alive = this._blocks.filter(b => b.alive);
        if (!alive.length) return;

        const topY    = Math.min(...alive.map(b => b.y));
        const revealH = cfg.blackout * (22 + 5);
        const darkY   = topY + revealH;

        ctx.save();
        ctx.fillStyle = 'rgba(0,5,20,0.90)';
        ctx.fillRect(0, darkY, CW, CH - darkY);

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

    // ── HUD 동기화 ────────────────────────────────────────────
    _syncHUD(scoreChanged = false) {
        hudScoreEl.textContent = String(this._score).padStart(6, '0');
        if (scoreChanged) {
            hudScoreEl.classList.remove('bump');
            void hudScoreEl.offsetWidth;
            hudScoreEl.classList.add('bump');
        }
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

    _applySettings() {
        const g = k => document.querySelector(`[data-group="${k}"].on`)?.dataset.val;
        this._settings = { bgm: g('bgm'), sfx: g('sfx'), speed: g('speed'), theme: g('theme'), tsize: g('textsize') };
        this.audio.setEnabled(this._settings.sfx !== 'off');
    }

    _loadSettingsUI() {
        const s = this._settings;
        [['bgm',s.bgm],['sfx',s.sfx],['textsize',s.tsize??'md'],['theme',s.theme],['speed',s.speed]]
            .forEach(([grp, val]) => {
                if (!val) return;
                document.querySelectorAll(`[data-group="${grp}"]`)
                    .forEach(b => b.classList.toggle('on', b.dataset.val === val));
            });
    }

    _resetSettingsUI() {
        [['bgm','on'],['sfx','on'],['textsize','md'],['theme','deep'],['speed','1x']]
            .forEach(([g, v]) =>
                document.querySelectorAll(`[data-group="${g}"]`)
                    .forEach(b => b.classList.toggle('on', b.dataset.val === v))
            );
        document.querySelectorAll('.color-swatches .swatch')
            .forEach((s, i) => s.classList.toggle('selected', i === 0));
    }
}

/* ============================================================
   Bootstrap
============================================================ */
window.addEventListener('DOMContentLoaded', () => {
    window._game = new Game();
});
