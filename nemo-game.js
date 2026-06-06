'use strict';
/* ============================================================
   nemo-game.js — 구현 B 담당 파일
   역할: Shark, A*(AStarGrid/Dory), Game 메인 컨트롤러, 부트스트랩
============================================================ */

const canvas     = document.getElementById('gameCanvas');
const dpr        = window.devicePixelRatio || 1;
const CW         = 1100;
const CH         = 650;
canvas.width     = Math.round(CW * dpr);
canvas.height    = Math.round(CH * dpr);
const ctx        = canvas.getContext('2d');
ctx.scale(dpr, dpr);
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

// 벽돌 기준 크기 (CW=1100 기준 절대값 — CW가 바뀌면 비례 스케일됨)
const BASE_BLOCK_W   = 48;
const BASE_BLOCK_H   = 18;
const BASE_BLOCK_GAP = 3;

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

function _mkImg(src) { const i = new Image(); i.src = src; return i; }

const swingFrames = {
    left:  Array.from({ length: 7 }, (_, i) => _mkImg(`assets/images/left_swing${i + 1}.png`)),
    right: Array.from({ length: 7 }, (_, i) => _mkImg(`assets/images/right_swing${i + 1}.png`)),
};
const sharkImgs = {
    1: { left: _mkImg('assets/images/shark1_left.png'),  right: _mkImg('assets/images/shark1_right.png') },
    2: { left: _mkImg('assets/images/shark2_left.png'),  right: _mkImg('assets/images/shark2_right.png') },
    3: { left: _mkImg('assets/images/shark3_left.png'),  right: _mkImg('assets/images/shark3_right.png') },
};

const blockImgs = [
    _mkImg('assets/images/block1.png'),
    _mkImg('assets/images/block2.png'),
    _mkImg('assets/images/block3.png'),
];

const stoneImgs = [
    _mkImg('assets/images/stone1.png'),
    _mkImg('assets/images/stone2.png'),
    _mkImg('assets/images/stone3.png'),
];

const doriImg      = _mkImg('assets/images/dori_left.png');
const doriLeftImg  = _mkImg('assets/images/dori_left.png');
const doriRightImg = _mkImg('assets/images/dori_right.png');
const specialBlockImg = _mkImg('assets/images/special block.png');
const nemoPrisonImg   = _mkImg('assets/images/nemo_prison.png');
const nemoImg         = _mkImg('assets/images/nemo.png');

const stageBgImgs = {
    1: _mkImg('assets/images/stage1.png'),
    2: _mkImg('assets/images/stage2.png'),
    3: _mkImg('assets/images/stage3.png'),
};


/* ============================================================
   📋 STAGE CONFIG — 기획/스토리 담당자 수정 영역
   ============================================================
   각 필드 설명 (숫자·불린만 수정, 키 이름 변경 금지):
     speed      : 공 초기 속도 (권장 범위 3.0 ~ 9.0 — 높을수록 어려움)
     timerSec   : 제한 시간 초 (null = 무제한)
     rows       : 블록 행 수
     cols       : 블록 열 수
     shark      : 상어 등장 여부
     vortex     : 소용돌이 블록 포함 여부
     dorisAI    : Stage 1 도리 경로 가이드 표시 여부
     itemChance : 아이템 드롭 확률 (0.0 ~ 1.0)
     sharkSpeed : 상어 이동 속도 (shark: true 일 때만 유효)
     paddleSpeed: 패들 기본 이동 속도 배율 (1.0 = 기본, 높을수록 빠름)
============================================================ */
const STAGE_CFG = {
    1: { speed: 7.0, timerSec: null, rows: 12, cols: 17, shark: false, vortex: false, dorisAI: true,  itemChance: 0.30, sharkSpeed: 2.8, paddleSpeed: 1.0 },
    2: { speed: 8.5, timerSec: 90,   rows: 14, cols: 19, shark: true,  vortex: false, dorisAI: false, itemChance: 0.35, sharkSpeed: 3.5, paddleSpeed: 1.0 },
    3: { speed: 10.0, timerSec: 60,  rows: 16, cols: 21, shark: true,  vortex: false, dorisAI: false, itemChance: 0.40, sharkSpeed: 4.0, paddleSpeed: 1.5 },
};

/* ── 스테이지별 아이템 풀 (가중치: 배열 중복으로 확률 조정) ─── */
const ITEM_POOLS = {
    1: ['extraBall', 'extraBall', 'paddleWide', 'paddleWide', 'multiball', 'multiball', 'slowBall', 'extraLife'],
    2: ['extraBall', 'paddleWide', 'multiball', 'slowBall', 'extraLife', 'timeBonus', 'timeBonus'],
    3: ['extraBall', 'paddleWide', 'multiball', 'slowBall', 'extraLife', 'timeBonus'],
};


/* ============================================================
   🚨 CORE OBJECTS — 구현 개발자 외 수정 금지 🚨
   Shark · AStarGrid · Dory · Game
============================================================ */

/* ============================================================
   Shark — Stage 2 횡단 장애물 (쿨다운 기믹)

   동작 원리:
   · 평소에는 화면 밖에서 대기 (active = false)
   · _cooldown 이 0이 되면 화면을 한 번 가로질러 사라짐
   · 공과 충돌 시 dx 반전 + 조작 반전, 단 _hitCooldown 으로
     같은 횡단 중 중복 반전 방지
============================================================ */
class Shark {
    /**
     * @param {number} type      상어 종류 (1·2·3)
     * @param {number} laneY     고정 레인 y 좌표
     * @param {number} initDelay 초기 대기 프레임 (스태거용)
     */
    constructor(cw, ch, type, laneY, speed, initDelay = 0) {
        this.CW   = cw; this.CH = ch;
        this.type = type;
        this.w    = 110; this.h = 45; // 1468:601 비율

        this.active       = false;
        this.dead         = false; // 강공격으로 영구 격침됨
        this._hitCooldown = 0;
        this._speed       = speed;
        this.dx           = speed;
        this.laneY        = laneY;
        this.y            = laneY;
        this.x            = -this.w;

        this._cooldown    = 180 + initDelay;
        this._cooldownMin = 450;
        this._cooldownMax = 720;
    }

    update() {
        if (this.dead) return;
        if (this._hitCooldown > 0) this._hitCooldown--;

        if (!this.active) {
            if (--this._cooldown <= 0) {
                this.active       = true;
                this._cooldown    = this._cooldownMin +
                    Math.floor(Math.random() * (this._cooldownMax - this._cooldownMin));
                this._hitCooldown = 0;

                const goRight = Math.random() > 0.5;
                this.dx = goRight ?  this._speed : -this._speed;
                this.x  = goRight ? -this.w : this.CW + this.w;
                this.y  = this.laneY;
            }
            return;
        }

        this.x += this.dx;
        if (this.dx > 0 && this.x > this.CW + this.w) this.active = false;
        if (this.dx < 0 && this.x < -this.w)          this.active = false;
    }

    hitsBall(ball) {
        if (this.dead || !this.active || this._hitCooldown > 0) return null;
        const cx  = this.x + this.w / 2;
        const cy  = this.y + this.h / 2;
        const adx = Math.abs(ball.x - cx);
        const ady = Math.abs(ball.y - cy);
        if (adx >= this.w / 2 + ball.r || ady >= this.h / 2 + ball.r) return null;
        const ovX = this.w / 2 + ball.r - adx;
        const ovY = this.h / 2 + ball.r - ady;
        if (ovX < ovY) {
            // 좌우 측면 충돌: 공이 실제로 상어 쪽으로 이동 중일 때만 반사
            const movingIn = (ball.x < cx && ball.dx > 0) || (ball.x > cx && ball.dx < 0);
            if (!movingIn) return null;
            return 'x';
        } else {
            // 상하 충돌: 공이 실제로 상어 쪽으로 이동 중일 때만 반사
            const movingIn = (ball.y < cy && ball.dy > 0) || (ball.y > cy && ball.dy < 0);
            if (!movingIn) return null;
            return 'y';
        }
    }

    registerHit() { this._hitCooldown = 45; }

    draw(ctx) {
        if (this.dead || !this.active) return;
        const { x, y, w, h, dx, type } = this;
        const img = sharkImgs[type][dx > 0 ? 'right' : 'left'];
        ctx.save();
        ctx.shadowColor = '#ef233c';
        ctx.shadowBlur  = 16;
        ctx.drawImage(img, x, y, w, h);
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
        const key  = (c, r) => c * 1000 + r;
        const h    = (c, r) => Math.abs(c - end.col) + Math.abs(r - end.row);
        const open   = [{ col: start.col, row: start.row, g: 0, f: h(start.col, start.row), prev: null }];
        const closed = new Set();
        const gMap   = new Map([[key(start.col, start.row), 0]]);

        while (open.length) {
            // O(n) min-find: open.sort() 대신 — 매 스텝 전체 정렬 방지
            let minI = 0;
            for (let i = 1; i < open.length; i++) if (open[i].f < open[minI].f) minI = i;
            const [cur] = open.splice(minI, 1);
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

    toGrid(px, py) { return { col: Math.floor(px / this.cell), row: Math.floor(py / this.cell) }; }
    toPixel(col, row) { return { x: col * this.cell + this.cell / 2, y: row * this.cell + this.cell / 2 }; }
}

/* ============================================================
   Dory — Stage 1 A* AI 가이드 (패들 위치까지 경로 탐색)
============================================================ */
class Dory {
    constructor(cw, ch) {
        this.x         = cw / 2;
        this.y         = ch * 0.45; // 블록 영역 아래, 패들 위 빈 공간에서 시작
        this.r         = 18;
        this.spd       = 1.6;
        this.direction = 'right';
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
        const end   = this.grid.toGrid(paddle.cx, paddle.y + paddle.h + 20); // 패들 바로 아래를 목표로
        this.path   = this.grid.findPath(start, end);
        this.pathPx = this.path.map(p => this.grid.toPixel(p.col, p.row));
        this.pathIdx = 0;
    }

    update(blocks, paddle) {
        if (this._recT++ % 60 === 0) this.recalcPath(blocks, paddle);
        this._wob += 0.07;
        if (this.pathPx.length && this.pathIdx < this.pathPx.length) {
            const tgt  = this.pathPx[this.pathIdx];
            const dx   = tgt.x - this.x;
            const dy   = tgt.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist < this.spd + 1) this.pathIdx++;
            else { this.x += (dx / dist) * this.spd; this.y += (dy / dist) * this.spd; }
        } else {
            // A* 경로 없음: 패들 방향으로 직접 이동
            const tx   = paddle.cx;
            const ty   = paddle.y + paddle.h + 20;
            const dx   = tx - this.x;
            const dy   = ty - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 1) { this.x += (dx / dist) * this.spd; this.y += (dy / dist) * this.spd; }
        }
    }

    drawPath(ctx) {
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
        const size = this.r * 2.5;
        ctx.save();
        ctx.shadowColor = '#00b4d8';
        ctx.shadowBlur  = 14;

        // 동행 도리(Stage 2+)는 이동 방향에 맞는 이미지 사용
        let img = doriImg;
        if (this._isCompanion) {
            const dirImg = this.direction === 'left'
                ? (typeof doriLeftImg !== 'undefined' ? doriLeftImg : null)
                : (typeof doriRightImg !== 'undefined' ? doriRightImg : null);
            if (dirImg?.complete && dirImg.naturalWidth > 0) img = dirImg;
        }

        if (img?.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, this.x - size / 2, this.y + bobY - size / 2, size, size);
        } else {
            ctx.font         = `${this.r * 2}px serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🐠', this.x, this.y + bobY);
        }
        ctx.restore();
    }
}

/* ============================================================
   Game — 메인 게임 컨트롤러
   · 상태: READY (공 대기) / PLAYING (게임 진행)
   · 화면 흔들림(Screen Shake) + 히트스탑(Hit Stop)
   · 방향키(←→) 패들 조작
   · 점수 팝업(ScorePopup) 렌더링
   · Multiball 아이템
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

        this._balls      = [];
        this._paddle     = null;
        this._blocks     = [];
        this._liveBlocks = [];
        this._items      = [];
        this._particles  = [];
        this._ripples    = [];
        this._sharks     = [];
        this._dory       = null;
        this._doriFreed  = false;
        this._mouseX     = CW / 2;

        this._phase          = 'READY';
        this._shakeFrames    = 0;
        this._shakeIntensity = 6;
        this._scorePopups    = [];
        this._keysDown       = { ArrowLeft: false, ArrowRight: false };
        this._aliveBlocks    = 0;
        this._lastExpandSecs = -1;
        this._lastSlowSecs   = -1;
        this._doriEscaping     = false;
        this._stage1Diving     = false;
        this._stage1DiveTimer  = 0;
        this._diveSpeed        = 0;
        this._fadeInAlpha      = 0;
        this._fadeInStart      = 0;
        this._announceTimer    = 0;
        this._announceActive   = false;
        this._overlayRaf       = null;
        this._overlayActive    = false;
        this._sharksKilled     = 0;
        this._nemoPrisonBroken = false;
        this._nemoPos          = null;
        this._nemoBubbleTimer  = 0;
        this._nemoBubbleText   = '';
        this._doryHintTimer    = 0;
        this._doryHintText     = '';
        this._realNemoIdx      = -1;
        this._nemoBlocks       = [];

        const sv = loadSave();
        this._highScore     = sv.highScore     || 0;
        this._clearedStages = sv.clearedStages || [];
        this._settings      = sv.settings      || { bgm:'on', sfx:'on', theme:'deep', tsize:'md' };

        this._initUI();
        this._hudEls = {
            swingBadge:       document.getElementById('swingBadge'),
            swingCdRow:       document.getElementById('swingCdRow'),
            swingCdFill:      document.getElementById('swingCdFill'),
            swingCdNum:       document.getElementById('swingCdNum'),
            itemStatusEmpty:  document.getElementById('itemStatusEmpty'),
            itemCdPaddle:     document.getElementById('itemCdPaddle'),
            itemCdPaddleFill: document.getElementById('itemCdPaddleFill'),
            itemCdPaddleNum:  document.getElementById('itemCdPaddleNum'),
            itemCdSlow:       document.getElementById('itemCdSlow'),
            itemCdSlowFill:   document.getElementById('itemCdSlowFill'),
            itemCdSlowNum:    document.getElementById('itemCdSlowNum'),
        };
        this._loadSettingsUI();
        this._applySettings();
        this._applyUnlocked();
        showScreen('lobby');
    }

    // ── UI 이벤트 바인딩 ─────────────────────────────────────
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
        document.getElementById('btnGameLobby').addEventListener('click', () => {
            if (this._running) {
                this._running = false;
                cancelAnimationFrame(this._raf);
            }
            showScreen('lobby');
        });
        document.getElementById('btnHudSetting').addEventListener('click', () => {
            if (this._running) this._togglePause();
            openModal(modalSettings);
        });

        document.getElementById('btnCloseSettings').addEventListener('click', () => {
            this._applySettings(); closeModal(modalSettings);
            if (this._paused && this._running) this._togglePause();
        });
        document.getElementById('btnSettingsToLobby').addEventListener('click', () => {
            closeModal(modalSettings);
            if (this._running) {
                this._running = false;
                cancelAnimationFrame(this._raf);
            }
            showScreen('lobby');
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
                this._applySettings();
            });
        });

        document.querySelectorAll('.color-swatches').forEach(c => {
            c.addEventListener('click', e => {
                const sw = e.target.closest('.swatch');
                if (!sw) return;
                c.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
                this._applySettings();
                const col = this._ballColor();
                this._balls?.forEach(b => b.color = col);
            });
        });

        document.addEventListener('keydown', e => {
            const gameActive = screenEls.game.classList.contains('active');

            // 키 시각 피드백
            if (gameActive) {
                if (e.code === 'ArrowLeft')  document.getElementById('keyLeft')?.classList.add('pressed');
                if (e.code === 'ArrowRight') document.getElementById('keyRight')?.classList.add('pressed');
                if (e.code === 'Space')      document.getElementById('keySpace')?.classList.add('pressed');
            }

            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                if (gameActive) {
                    e.preventDefault();
                    this._keysDown[e.code] = true;
                    this._paddle?.setDirection(e.code === 'ArrowLeft' ? 'left' : 'right');
                }
                return;
            }
            if (e.code === 'Space' && gameActive) {
                e.preventDefault();
                if (this._announceActive) {
                    this._announceActive = false;
                    if (this._stage === 3 && this._doryHintText) this._doryHintTimer = 600;
                    // 공지 해제와 동시에 공 발사
                    if (this._running && !this._paused && !this._doriEscaping)
                        this._launchBalls();
                    return;
                }
                if (this._running && !this._paused && !this._doriEscaping) {
                    if (this._balls.some(b => b.stuck)) this._launchBalls();
                    else                                this._paddle.triggerSwing();
                }
                return;
            }
            if ((e.key === 'p' || e.key === 'P') && gameActive) { this._togglePause(); return; }
            if (e.key === 'Escape') {
                if (!modalSettings.classList.contains('hidden')) {
                    this._applySettings(); closeModal(modalSettings);
                    if (this._paused && this._running) this._togglePause();
                    return;
                }
                if (!modalCredits.classList.contains('hidden'))  { closeModal(modalCredits);  return; }
                if (this._running && !this._paused) this._togglePause();
                openModal(modalSettings);
            }
        });

        document.addEventListener('keyup', e => {
            if (e.code === 'ArrowLeft')  { this._keysDown.ArrowLeft  = false; document.getElementById('keyLeft')?.classList.remove('pressed'); }
            if (e.code === 'ArrowRight') { this._keysDown.ArrowRight = false; document.getElementById('keyRight')?.classList.remove('pressed'); }
            if (e.code === 'Space')      document.getElementById('keySpace')?.classList.remove('pressed');
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

    // ── 스테이지 실행 흐름 ───────────────────────────────────
    _launchStage(n) {
        this._stage = n;
        const names = { 1:'조력자 구출', 2:'상어의 위협', 3:'니모 구하기' };
        document.querySelector('.vn-stage-tag').textContent = `STAGE ${n} — ${names[n]}`;
        showScreen('dialog');
        this.dialogue.play(n, () => {
            showScreen('game');
            this._initStage(n);
            this._fadeInAlpha = 1.0;
            this._fadeInStart = performance.now();
        });
    }

    _initSidebar(n) {
        const goals = {
            1: { main: '도리를 구출하세요!',                  sub: '특수 블록 속에 갇힌 도리를 찾아서 구출하세요!' },
            2: { main: '최하단 블럭을 파괴해 탈출!',           sub: '상어를 피해 맨 아래 열 블럭 중 하나를 부숴라!' },
            3: { main: '상어 3마리 + 니모 블록 파괴!',         sub: '강공격으로 상어와 니모 블록을 제거하세요!' },
        };
        const g  = goals[n];
        const el = document.getElementById('sidebarGoalText');
        if (!el || !g) return;
        if (n === 1) {
            el.innerHTML = `
                <p class="goal-main">${g.main}</p>
                <p class="goal-sub">${g.sub}</p>
                <div class="goal-special-hint">
                    <img src="assets/images/special block.png" alt="특수 블록" class="goal-special-img">
                    <span class="goal-special-label">이 특수 블록을 찾아라!</span>
                </div>`;
        } else if (n === 2) {
            el.innerHTML = `
                <p class="goal-main">${g.main}</p>
                <p class="goal-sub">${g.sub}</p>
                <div class="goal-special-hint" style="margin-top:6px;border-color:rgba(130,180,230,0.35);background:rgba(80,130,200,0.08);">
                    <img src="assets/images/stone1.png" alt="돌 블럭"
                         style="width:24px;height:24px;object-fit:contain;flex-shrink:0;
                                filter:drop-shadow(0 0 5px rgba(120,170,255,0.7));">
                    <span class="goal-special-label" style="color:rgba(160,210,255,0.95);">
                        맨 아래 돌 블럭을 제거하면 탈출!
                    </span>
                </div>
                <div class="goal-special-hint" style="margin-top:4px;border-color:rgba(255,90,90,0.35);background:rgba(255,60,60,0.08);">
                    <img src="assets/images/shark1_right.png" alt="상어"
                         style="width:55px;height:23px;object-fit:contain;flex-shrink:0;
                                filter:drop-shadow(0 0 5px rgba(255,60,60,0.7));">
                    <span class="goal-special-label" style="color:rgba(255,160,160,0.95);">
                        ⚡ 강공격으로만 상어를 물리칠 수 있습니다!
                    </span>
                </div>`;
        } else if (n === 3) {
            el.innerHTML = `
                <p class="goal-main">${g.main}</p>
                <p class="goal-sub">${g.sub}</p>
                <div class="goal-special-hint" style="margin-top:6px;border-color:rgba(255,90,90,0.35);background:rgba(255,60,60,0.08);">
                    <img src="assets/images/shark1_right.png" alt="상어"
                         style="width:55px;height:23px;object-fit:contain;flex-shrink:0;
                                filter:drop-shadow(0 0 5px rgba(255,60,60,0.7));">
                    <span class="goal-special-label" style="color:rgba(255,160,160,0.95);">
                        ⚡ 강공격으로 상어 3마리 모두 제거!
                    </span>
                </div>
                <div class="goal-special-hint" style="margin-top:4px;border-color:rgba(255,180,60,0.35);background:rgba(255,150,30,0.08);">
                    <img src="assets/images/nemo_prison.png" alt="니모 블록" class="goal-special-img"
                         style="filter:drop-shadow(0 0 5px rgba(255,140,0,0.7));">
                    <span class="goal-special-label" style="color:rgba(255,210,120,0.95);">
                        ⚡ 니모 블록은 강공격으로만 파괴 가능!
                    </span>
                </div>`;
        } else {
            el.innerHTML = `<p class="goal-main">${g.main}</p><p class="goal-sub">${g.sub}</p>`;
        }

        // 상어 현황 패널 표시 여부
        this._initSharkSidebar(STAGE_CFG[n]?.shark === true);
    }

    _initStage(n) {
        this._stopOverlay();
        const cfg    = STAGE_CFG[n];
        this._baseSpeed      = cfg.speed;
        this._paddleSpeedMul = cfg.paddleSpeed ?? 1.0;

        this._lives    = 3;
        this._score    = 0;
        this._timer    = cfg.timerSec ?? 0;
        this._timerMs  = 0;
        this._running  = true;
        this._paused   = false;
        this._clearing = false;
        this._blocksDestroyed = 0;
        this._aliveBlocks     = 0;
        this._lastExpandSecs  = -1;
        this._lastSlowSecs    = -1;
        this._doriFreed        = false;
        this._doriEscaping     = false;
        this._stage1Diving     = false;
        this._stage1DiveTimer  = 0;
        this._diveSpeed        = 0;
        this._stage2Diving     = false;
        this._stage2DiveTimer  = 0;
        this._stage2DiveSpeed  = 0;
        this._stage2BreakX     = CW / 2;
        this._fadeInAlpha      = 0;
        this._sharksKilled      = 0;
        this._nemoPrisonBroken  = false;
        this._nemoPos           = null;
        this._nemoBubbleTimer   = 0;
        this._nemoBubbleText    = '';
        this._doryHintTimer     = 0;
        this._doryHintText      = '';
        this._nemoBlocks        = [];
        this._realNemoIdx       = -1;
        this._stage2BottomBlocks = [];
        this._announceActive    = true;
        this._announceTimer     = 0;  // counts up for fade-in animation
        this._particles    = [];
        this._ripples     = [];
        this._items       = [];
        this._scorePopups = [];
        this._shakeFrames = 0;
        this._phase       = 'READY';

        hudStageEl.textContent = String(n).padStart(2, '0');
        this._syncHUD();

        this._paddle = new Paddle(CW);
        this._blocks = this._buildBlocks(cfg);
        this._liveBlocks = [...this._blocks];
        this._aliveBlocks = this._blocks.length;
        this._balls  = [this._newBall()];
        if (n === 2) this._stage2BottomBlocks = this._blocks.filter(b => b._bottomRow);

        // Stage 3: 도리 힌트 텍스트 준비 (announce 끝나면 표시)
        if (n === 3 && this._realNemoIdx >= 0) {
            const hintLabels = ['왼쪽', '가운데', '오른쪽'];
            this._doryHintText = `진짜 니모는 ${hintLabels[this._realNemoIdx]}인 것 같아!`;
        }

        if (cfg.shark) {
            const spd   = cfg.sharkSpeed;
            const lanes = [CH * 0.28, CH * 0.50, CH * 0.72];
            this._sharks = [1, 2, 3].map((t, i) =>
                new Shark(CW, CH, t, lanes[i], spd, i * 180));
        } else {
            this._sharks = [];
        }
        // Stage 1: 도리 없음(블록에 갇혀있음). Stage 2+: 구출된 도리가 패들 동행
        if (n >= 2) {
            this._dory = new Dory(CW, CH);
            this._dory._isCompanion = true;
            this._dory.x = this._paddle.x + this._paddle.w + 28; // 패들 오른쪽
            this._dory.y = this._paddle.y + this._paddle.h * 0.6;
        } else {
            this._dory = null;
        }
        if (this._sharks.length) setTimeout(() => this.audio.playSharkAlert(), 800);

        this._initSidebar(n);
        document.getElementById('canvasPlaceholder').style.display = 'none';
        document.getElementById('btnPause').textContent = '⏸';

        if (this._raf) cancelAnimationFrame(this._raf);
        this._lastTs = 0;
        this._raf = requestAnimationFrame(ts => this._loop(ts));
    }

    _buildBlocks(cfg) {
        const scale        = CW / 1100;
        const bottomMargin = Math.round(24 * scale);
        const gap = Math.max(1, Math.round(BASE_BLOCK_GAP * scale));
        // 좌우 캔버스 끝에 꽉 붙도록 bw 를 열 수 기준으로 역산
        const bw  = (CW - (cfg.cols - 1) * gap) / cfg.cols;
        const bh  = Math.round(BASE_BLOCK_H * scale);
        const totalH = cfg.rows * bh + (cfg.rows - 1) * gap;
        const startX = 0; // 왼쪽 캔버스 끝에서 시작
        const startY = CH - bottomMargin - totalH;
        const blocks = [];

        // Stage 1: 마지막 행의 5개 열을 special 블록으로 배치 (균등 간격)
        const stage1SpecialCols = new Set([0, 4, 8, 12, 16]);

        // Stage 3: 하단 행에 좌/중/우 3개 nemo 블록 자리 비워둠
        const s3LeftC   = 3;
        const s3CenterC = Math.floor(cfg.cols / 2); // 10 (cols=21일 때)
        const s3RightC  = cfg.cols - 4;             // 17
        const s3NemoCols = new Set([s3LeftC, s3CenterC, s3RightC]);
        const s3NemoRow  = cfg.rows - 1;

        for (let r = 0; r < cfg.rows; r++) {
            for (let c = 0; c < cfg.cols; c++) {
                // Stage 3 nemo 블록 자리는 일반 블록 배치 건너뜀
                if (this._stage === 3 && s3NemoCols.has(c) && r === s3NemoRow) continue;

                const x = startX + c * (bw + gap);
                const y = startY + r * (bh + gap);

                let type = BT.normal;
                if (this._stage === 1 && r === cfg.rows - 1 && stage1SpecialCols.has(c)) {
                    type = BT.special;
                } else if (this._stage === 2 && r === cfg.rows - 1) {
                    type = BT.hard;
                } else {
                    // 하드 블록은 뒤쪽(하단) 2행에만 소수 배치
                    const isBackRow = r >= cfg.rows - 2;
                    if (isBackRow && Math.random() < 0.22)     type = BT.hard;
                    else if (cfg.vortex && (r + c) % 6 === 0) type = BT.vortex;
                }

                const b = new Block(x, y, bw, bh, type, r);
                b._bottomRow = (r === cfg.rows - 1);
                if (type !== BT.special && type !== BT.nemo && Math.random() < (cfg.itemChance ?? 0.20)) {
                    const pool = ITEM_POOLS[this._stage] || ITEM_POOLS[1];
                    b._itemType = pool[Math.floor(Math.random() * pool.length)];
                }
                blocks.push(b);
            }
        }

        // Stage 1: 랜덤 special 블록 하나에 도리 배치
        if (this._stage === 1) {
            const specials = blocks.filter(b => b.type === BT.special);
            if (specials.length > 0)
                specials[Math.floor(Math.random() * specials.length)]._hasDori = true;
        }

        // Stage 3: 하단 행 좌/중/우에 nemo 블록 3개 배치 (각각 단독 셀 크기)
        if (this._stage === 3) {
            this._realNemoIdx = Math.floor(Math.random() * 3);
            const nr = s3NemoRow;
            const nemoCols = [s3LeftC, s3CenterC, s3RightC];
            for (let i = 0; i < 3; i++) {
                const nc    = nemoCols[i];
                const nemoX = startX + nc * (bw + gap);
                const nemoY = startY + nr * (bh + gap);
                const b = new Block(nemoX, nemoY, bw, bh, BT.nemo, nr);
                b._nemoIdx    = i;
                b._isRealNemo = (i === this._realNemoIdx);
                blocks.push(b);
                this._nemoBlocks.push(b);
            }
        }

        return blocks;
    }

    _newBall() {
        const b = new Ball(
            this._paddle.cx,
            this._paddle.y + this._paddle.h + 12,
            this._ballColor()
        );
        b.stuck = true; b.stuckDx = 0;
        return b;
    }

    _ballColor() {
        const sw = document.querySelector('.color-swatches .swatch.selected');
        return sw ? getComputedStyle(sw).getPropertyValue('--sc').trim() : '#ff6b35';
    }

    _launchBalls() {
        const hadStuck = this._balls.some(b => b.stuck);
        this._balls.forEach(b => { if (b.stuck) b.launch(this._baseSpeed); });
        if (hadStuck) this._phase = 'PLAYING';
    }

    // ── 메인 루프 ────────────────────────────────────────────
    _loop(ts) {
        if (!this._running) return;
        const dt = this._lastTs ? Math.min(ts - this._lastTs, 50) : 16;
        this._lastTs = ts;
        if (!this._paused) this._update(dt);
        this._draw();
        this._raf = requestAnimationFrame(t2 => this._loop(t2));
    }

    _update(dt) {
        // 스테이지 시작 공지 중: 게임 로직 일시 정지 (SPACE로만 해제)
        if (this._announceActive) {
            this._announceTimer++;
            return;
        }

        // 힌트/말풍선 타이머 소모
        if (this._doryHintTimer > 0) this._doryHintTimer--;
        if (this._nemoBubbleTimer > 0) this._nemoBubbleTimer--;

        // 도리 탈출 연출 중 (1스테이지): 도리만 움직이고 나머지 멈춤
        if (this._doriEscaping) {
            const arrowSpd = 10;
            if (this._keysDown.ArrowLeft)  this._mouseX = Math.max(0,  this._mouseX - arrowSpd);
            if (this._keysDown.ArrowRight) this._mouseX = Math.min(CW, this._mouseX + arrowSpd);
            this._paddle.moveTo(this._mouseX);
            this._paddle.update();
            if (this._dory) {
                this._dory.update(this._blocks, this._paddle);
                const dist = Math.hypot(
                    this._dory.x - this._paddle.cx,
                    this._dory.y - (this._paddle.y + this._paddle.h + 20)
                );
                if (dist < 60 && !this._stage1Diving) {
                    this._doriEscaping    = false;
                    this._stage1Diving    = true;
                    this._stage1DiveTimer = 0;
                    this._diveSpeed       = 0;
                    this.audio.playStageClear();
                }
            }
            for (let i = this._particles.length - 1; i >= 0; i--) {
                this._particles[i].update();
                if (this._particles[i].dead) this._particles.splice(i, 1);
            }
            for (let i = this._scorePopups.length - 1; i >= 0; i--) {
                this._scorePopups[i].update();
                if (this._scorePopups[i].dead) this._scorePopups.splice(i, 1);
            }
            return;
        }

        // ── Stage 1 심해 다이브 연출 ────────────────────────
        if (this._stage1Diving) {
            this._stage1DiveTimer++;

            if (this._stage1DiveTimer > 90) {
                this._diveSpeed = Math.min(this._diveSpeed + 0.18, 12);
                this._paddle.y += this._diveSpeed;
            }

            if (this._dory) {
                const tx = this._paddle.cx;
                const ty = this._paddle.y + this._paddle.h / 2;
                this._dory.x   += (tx - this._dory.x) * 0.15;
                this._dory.y   += (ty - this._dory.y) * 0.15;
                this._dory._wob += 0.12;
            }

            for (let i = this._particles.length - 1; i >= 0; i--) {
                this._particles[i].update();
                if (this._particles[i].dead) this._particles.splice(i, 1);
            }
            for (let i = this._scorePopups.length - 1; i >= 0; i--) {
                this._scorePopups[i].update();
                if (this._scorePopups[i].dead) this._scorePopups.splice(i, 1);
            }

            if (this._paddle.y > CH + 60 && !this._clearing) {
                this._clearing = true;
                this._doStage1ClearTransition();
            }
            return;
        }

        // ── Stage 2 심해 다이브 연출 ────────────────────────
        if (this._stage2Diving) {
            this._stage2DiveTimer++;

            if (this._stage2DiveTimer > 30) {
                const diff = this._stage2BreakX - this._paddle.cx;
                if (Math.abs(diff) > 4 && this._stage2DiveSpeed === 0) {
                    this._mouseX += diff * 0.14;
                    this._paddle.moveTo(this._mouseX);
                    this._paddle.update();
                } else {
                    this._stage2DiveSpeed = Math.min(this._stage2DiveSpeed + 0.18, 12);
                    this._paddle.y += this._stage2DiveSpeed;
                }
            }

            if (this._dory) {
                const tx = this._paddle.cx;
                const ty = this._paddle.y + this._paddle.h / 2;
                this._dory.x += (tx - this._dory.x) * 0.15;
                this._dory.y += (ty - this._dory.y) * 0.15;
                this._dory._wob += 0.12;
            }

            for (let i = this._particles.length - 1; i >= 0; i--) {
                this._particles[i].update();
                if (this._particles[i].dead) this._particles.splice(i, 1);
            }
            for (let i = this._scorePopups.length - 1; i >= 0; i--) {
                this._scorePopups[i].update();
                if (this._scorePopups[i].dead) this._scorePopups.splice(i, 1);
            }

            if (this._paddle.y > CH + 60) {
                this._stage2Diving = false;
                this._doStage2ClearTransition();
            }
            return;
        }

        const cfg = STAGE_CFG[this._stage];

        // ── 타이머 ─────────────────────────────────────────
        let maxSlow = 0;
        for (const b of this._balls) if (!b.stuck && b.slowTimer > maxSlow) maxSlow = b.slowTimer;
        const slowFactor = maxSlow > 0 ? 0.45 : 1.0;

        if (cfg.timerSec) {
            this._timerMs += dt * slowFactor;
            if (this._timerMs >= 1000) {
                this._timerMs -= 1000;
                this._timer = Math.max(0, this._timer - 1);
                this._syncHUD();
                if (this._timer === 0) { this._gameOver('time'); return; }
            }
        }

        // ── 공 속도 비율 → 패들 반응 속도 연동 ─────────────
        let curBallSpd = 0;
        for (const b of this._balls) {
            if (!b.stuck) { const s = Math.hypot(b.dx, b.dy); if (s > curBallSpd) curBallSpd = s; }
        }
        if (curBallSpd === 0) curBallSpd = this._baseSpeed;
        const spdRatio = Math.max(1.0, Math.min(curBallSpd / this._baseSpeed, 1.5));
        this._paddle._lerpFactor = 0.18 * spdRatio * this._paddleSpeedMul;

        // ── 방향키 → 패들 이동 ──────────────────────────────
        const arrowSpd = 10 * spdRatio * this._paddleSpeedMul;
        if (this._keysDown.ArrowLeft)  this._mouseX = Math.max(0,  this._mouseX - arrowSpd);
        if (this._keysDown.ArrowRight) this._mouseX = Math.min(CW, this._mouseX + arrowSpd);

        this._paddle.moveTo(this._mouseX);
        this._paddle.update();

        // paddleWide 타이머: 모든 공이 stuck 상태이면 타이머 소모 안 함
        if (this._balls.every(b => b.stuck) && this._paddle._expandT > 0) {
            this._paddle._expandT++;
        }

        // ── 상어 (Stage 2/3 — 공 튕기기) ─────────────────────
        for (const shark of this._sharks) {
            shark.update();
            for (const b of this._balls) {
                if (!b.stuck) {
                    const side = shark.hitsBall(b);
                    if (side) {
                        if (b.rainbow) {
                            // 무지개 공: 상어 영구 격침 (강공격 전용)
                            shark.dead   = true;
                            shark.active = false;
                            this._sharksKilled++;
                            const pts = 500;
                            this._score += pts;
                            this._syncHUD(true);
                            this._saveHigh();
                            this._scorePopups.push(new ScorePopup(
                                shark.x + shark.w / 2, shark.y + shark.h / 2, pts
                            ));
                            this._particles.push(...spawnParticles(
                                shark.x + shark.w / 2, shark.y + shark.h / 2, '#ff6b35'
                            ));
                            this.audio.playBlockBreak();
                            this._renderSharkSidebar();
                            if (this._stage === 3) this._checkStage3Clear();
                        } else {
                            const cx = shark.x + shark.w / 2;
                            const cy = shark.y + shark.h / 2;
                            if (side === 'x') {
                                b.dx *= -1;
                                const push = shark.w / 2 + b.r - Math.abs(b.x - cx);
                                b.x += b.x < cx ? -push : push;
                            } else {
                                b.dy *= -1;
                                const push = shark.h / 2 + b.r - Math.abs(b.y - cy);
                                b.y += b.y < cy ? -push : push;
                            }
                            shark.registerHit();
                            this.audio.playPaddleHit();
                        }
                    }
                }
            }
        }

        // ── 도리 A* — 구출 전 경로 가이드 (구출 후는 _doriEscaping 분기에서 처리)
        if (this._dory && !this._doriFreed && !this._dory._isCompanion) {
            this._dory.update(this._blocks, this._paddle);
        }
        // ── 동행 도리 (Stage 2+): 패들 오른쪽 뒤쪽에 붙어서 따라이동
        if (this._dory && this._dory._isCompanion) {
            const prevDoryX = this._dory.x;
            const tx = this._paddle.x + this._paddle.w + 28; // 패들 오른쪽 바깥
            const ty = this._paddle.y + this._paddle.h * 0.6;
            this._dory.x += (tx - this._dory.x) * 0.15;
            this._dory.y += (ty - this._dory.y) * 0.15;
            this._dory._wob += 0.08;
            const dxDelta = this._dory.x - prevDoryX;
            if (Math.abs(dxDelta) > 0.2) {
                this._dory.direction = dxDelta > 0 ? 'right' : 'left';
            }
        }

        // ── 공 물리 ─────────────────────────────────────────
        for (let i = this._balls.length - 1; i >= 0; i--) {
            const b   = this._balls[i];
            const res = b.update(this._paddle, CW, CH);
            if (res === 'paddle') {
                    this.audio.playPaddleHit();
                    if (this._paddle.isSwinging) {
                        this.audio.playPowerSwing();
                        b.rainbow = true;
                        this._ripples.push({ x: b.x, y: b.y, r: 5,  maxR:  55, life: 1.0, decay: 0.055 });
                        this._ripples.push({ x: b.x, y: b.y, r: 0,  maxR:  80, life: 1.0, decay: 0.040 });
                        this._ripples.push({ x: b.x, y: b.y, r: 0,  maxR: 110, life: 1.0, decay: 0.030 });
                    }
                }
            else if (res === 'lost') {
                if (this._balls.length > 1) this._balls.splice(i, 1);
                else { this._loseLife(); return; }
            }
        }

        // ── 블록 충돌 ───────────────────────────────────────
        for (let _bi = this._liveBlocks.length - 1; _bi >= 0; _bi--) {
            const block = this._liveBlocks[_bi];
            if (!block.alive) { this._liveBlocks.splice(_bi, 1); continue; }
            block.update();
            for (const ball of this._balls) {
                if (ball.stuck || !this._collide(ball, block)) continue;

                if (ball.rainbow) {
                    if (block.type === BT.nemo) {
                        // 니모 블록: 강공격(무지개)으로만 파괴 가능
                        block.alive = false;
                        this._blocksDestroyed++;
                        this._aliveBlocks--;
                        const pts = block._isRealNemo ? 1000 : 300;
                        this._score += pts;
                        this._syncHUD(true);
                        this._saveHigh();
                        this._scorePopups.push(new ScorePopup(
                            block.x + block.w / 2, block.y + block.h / 2, pts
                        ));
                        this._particles.push(...spawnParticles(
                            block.x + block.w / 2, block.y + block.h / 2, '#ff6b35'
                        ));
                        this.audio.playBlockBreak();
                        this._shakeFrames    = 14;
                        this._shakeIntensity = 12;
                        if (block._isRealNemo) {
                            this._nemoPrisonBroken = true;
                            this._nemoPos = { x: block.x + block.w / 2, y: block.y + block.h / 2 };
                            if (this._sharksKilled < 3) {
                                this._nemoBubbleText = '상어를 다 제거해줘! 그러면 갈게!';
                            }
                        }
                        if (this._stage === 3) this._checkStage3Clear();
                        break;
                    }
                    const doriPos = this._rainbowBlockHit(ball, block);
                    if (doriPos && !this._doriFreed) {
                        this._doriFreed    = true;
                        this._doriEscaping = true;
                        this._dory = new Dory(CW, CH);
                        this._dory.x   = doriPos.x;
                        this._dory.y   = doriPos.y;
                        this._dory.spd = 2.8;
                        this._dory.recalcPath(this._blocks, this._paddle);
                    }
                    break;
                } else if (block.type === BT.nemo) {
                    // 니모 블록: 일반 공은 튕기기만, 데미지 없음
                    this.audio.playHardHit();
                    ball.slowTimer = Math.max(ball.slowTimer, 6);
                } else {
                    const hp = block.hit();
                    if (hp > 0) {
                        // 하드 블록 피격 — 히트스탑 + 약한 화면 흔들림
                        this.audio.playHardHit();
                        this._shakeFrames    = Math.max(this._shakeFrames, 4);
                        this._shakeIntensity = 3;
                        ball.slowTimer = Math.max(ball.slowTimer, 8);
                    } else {
                        // 블록 파괴
                        this.audio.playBlockBreak();
                        this._shakeFrames    = 6;
                        this._shakeIntensity = 6;

                        const pts = block.type === BT.hard ? 300 : block.type === BT.vortex ? 200 : 100;
                        this._score += pts;
                        this._syncHUD(true);
                        this._saveHigh();

                        this._scorePopups.push(new ScorePopup(
                            block.x + block.w / 2,
                            block.y + block.h / 2,
                            pts
                        ));

                        this._particles.push(...spawnParticles(
                            block.x + block.w / 2, block.y + block.h / 2, block.color
                        ));

                        if (block._itemType)
                            this._items.push(new Item(block.x + block.w / 2, block.y + block.h / 2, block._itemType));

                        // 점진적 속도 증가 — 8블록마다 5% 가속, 최대 기본속도의 1.35배
                        this._blocksDestroyed++;
                        this._aliveBlocks--;
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

                        // 도리 구출: 블록 위치에서 말린(패들)을 향해 A* 수영 시작
                        if (block._hasDori && !this._doriFreed) {
                            this._doriFreed    = true;
                            this._doriEscaping = true;
                            this._dory = new Dory(CW, CH);
                            this._dory.x   = block.x + block.w / 2;
                            this._dory.y   = block.y + block.h / 2;
                            this._dory.spd = 2.8;
                            this._dory.recalcPath(this._blocks, this._paddle);
                        }
                        break;
                    }
                }

                if (block.type === BT.vortex && block.alive) ball.slowTimer = 90;
            }
        }

        // ── 아이템 ─────────────────────────────────────────
        for (let i = this._items.length - 1; i >= 0; i--) {
            const it = this._items[i];
            it.update(CW);
            if (it.hits(this._paddle)) { this._applyItem(it.type); this._items.splice(i, 1); }
            else if (!it.alive)        { this._items.splice(i, 1); }
        }

        // ── 파티클 ─────────────────────────────────────────
        for (let i = this._particles.length - 1; i >= 0; i--) {
            this._particles[i].update();
            if (this._particles[i].dead) this._particles.splice(i, 1);
        }

        // ── 리플 (물결 이펙트) ──────────────────────────────
        for (let i = this._ripples.length - 1; i >= 0; i--) {
            const rp  = this._ripples[i];
            rp.r     += (rp.maxR - rp.r) * 0.18;
            rp.life  -= rp.decay;
            if (rp.life <= 0) this._ripples.splice(i, 1);
        }

        // ── 점수 팝업 ───────────────────────────────────────
        for (let i = this._scorePopups.length - 1; i >= 0; i--) {
            this._scorePopups[i].update();
            if (this._scorePopups[i].dead) this._scorePopups.splice(i, 1);
        }

        // ── 클리어 판정 ────────────────────────────────────────
        if (this._stage === 3) {
            // Stage 3: 상어 3마리 처치 + 니모 블록 파괴 (이벤트 기반 — _checkStage3Clear에서 처리)
        } else if (this._stage === 2 && !this._clearing) {
            // Stage 2: 최하단 열 블럭 중 하나라도 파괴되면 다이브 시작
            const brokenBottom = this._stage2BottomBlocks.find(b => !b.alive);
            if (this._stage2BottomBlocks.length > 0 && brokenBottom) {
                this._clearing = true;
                this._stage2BreakX = brokenBottom.x + brokenBottom.w / 2;
                this._stage2DiveTimer = 0;
                this._stage2DiveSpeed = 0;
                this._stage2Diving = true;
                for (const b of this._balls) b.stuck = true;
                this._sharks.forEach(s => { s.dead = true; });
                this._items = [];
                this.audio.playStageClear();
            }
        } else if (!this._clearing && this._aliveBlocks === 0 && !this._doriFreed) {
            this._clearing = true;
            this._stageClear();
        }
    }

    _checkStage3Clear() {
        if (this._clearing) return;
        if (this._nemoPrisonBroken && this._sharksKilled >= 3) {
            this._clearing = true;
            this._stageClear();
        }
    }

    _initSharkSidebar(show) {
        const section = document.getElementById('sharkStatusSection');
        const divider = document.getElementById('sharkDivider');
        if (!section || !divider) return;
        section.style.display = show ? '' : 'none';
        divider.style.display = show ? '' : 'none';
        if (show) this._renderSharkSidebar();
    }

    _renderSharkSidebar() {
        const list = document.getElementById('sharkStatusList');
        if (!list || !this._sharks.length) return;
        list.innerHTML = this._sharks.map((shark, i) => {
            const dead = shark.dead;
            return `<div class="shark-status-row${dead ? ' shark-dead' : ''}">
                <img src="assets/images/shark${shark.type}_right.png" class="shark-status-img" alt="">
                <span class="shark-status-name">상어 ${i + 1}호</span>
                <span class="shark-status-badge ${dead ? 'badge-dead' : 'badge-alive'}">${dead ? '✗ 처치' : '● 활성'}</span>
            </div>`;
        }).join('');
    }

    _collide(ball, block) {
        const { x, y, r }                     = ball;
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

        } else if (type === 'paddleWide') {
            this._paddle.applyExpand(480);

        } else if (type === 'multiball') {
            // 현재 맵의 모든 공 각각에서 +30° 방향으로 복사본 1개 생성
            this.audio.playMultiball();
            const toAdd = [];
            for (const ball of this._balls) {
                if (ball.stuck) continue;
                const spd     = Math.hypot(ball.dx, ball.dy);
                const baseAng = Math.atan2(ball.dy, ball.dx);
                const nb = new Ball(ball.x, ball.y, this._ballColor());
                nb.stuck = false;
                nb.dx = Math.cos(baseAng + Math.PI / 6) * spd;
                nb.dy = Math.sin(baseAng + Math.PI / 6) * spd;
                if (Math.abs(nb.dy) < Ball.MIN_DY)
                    nb.dy = nb.dy >= 0 ? Ball.MIN_DY : -Ball.MIN_DY;
                toAdd.push(nb);
            }
            this._balls.push(...toAdd);

        } else if (type === 'slowBall') {
            // 공 속도 감소 — 기존 slowTimer보다 길게 적용
            for (const b of this._balls)
                b.slowTimer = Math.max(b.slowTimer, 240); // 4초

        } else if (type === 'extraLife') {
            if (this._lives < 3) {
                this._lives++;
                this._syncHUD();
            }

        } else if (type === 'timeBonus') {
            if (STAGE_CFG[this._stage].timerSec) {
                this._timer += 5;
                this._syncHUD();
            }
        }
    }

    _loseLife() {
        this._lives--;
        this.audio.playLifeLost();
        this._syncHUD();
        if (this._lives <= 0) {
            this._gameOver('lives');
        } else {
            this._balls   = [this._newBall()];
            this._ripples = [];
            this._phase   = 'READY';
        }
    }

    // ── 스테이지 클리어 ──────────────────────────────────────
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

        const stageNum = this._stage;
        this._drawOverlay(`STAGE ${stageNum} CLEAR!`, '#f7d716');
        setTimeout(() => {
            this._stopOverlay();
            if (stageNum < 3) this._doFadeOut(600, () => this._launchStage(stageNum + 1));
            else              this._showEnding();
        }, 2200);
    }

    _gameOver(reason = 'lives') {
        this._running = false;
        cancelAnimationFrame(this._raf);
        const msg      = reason === 'time' ? 'TIME OVER!' : 'GAME OVER';
        const subtitle = reason === 'time' ? '시간이 초과되었습니다' : '목숨을 모두 잃었습니다';
        this._drawOverlay(msg, '#ef233c', subtitle);
        setTimeout(() => {
            this._stopOverlay();
            showScreen('stages');
            this._applyUnlocked();
        }, 3500);
    }

    _doFadeOut(duration, callback) {
        const start = performance.now();
        const tick  = (ts) => {
            const alpha = Math.min((ts - start) / duration, 1.0);
            ctx.save();
            ctx.fillStyle = `rgba(0,0,0,${alpha})`;
            ctx.fillRect(0, 0, CW, CH);
            ctx.restore();
            if (alpha < 1.0) requestAnimationFrame(tick);
            else callback();
        };
        requestAnimationFrame(tick);
    }

    _showEnding() {
        this._drawOverlay('CONGRATULATIONS!', '#f7d716', '모든 스테이지를 클리어했습니다!');
        setTimeout(() => { this._stopOverlay(); showScreen('lobby'); }, 4500);
    }

    _stopOverlay() {
        this._overlayActive = false;
        if (this._overlayRaf) { cancelAnimationFrame(this._overlayRaf); this._overlayRaf = null; }
    }

    _drawOverlay(msg, color, subtitle = null) {
        this._stopOverlay();
        this._overlayActive = true;
        const scoreRef = () => `SCORE: ${this._score}  |  BEST: ${this._highScore}`;
        const draw = () => {
            if (!this._overlayActive) return;
            const now    = Date.now();
            const pulse  = Math.sin(now * 0.003) * 0.08 + 0.92;
            const glow   = 24 + Math.sin(now * 0.005) * 14;
            ctx.save();
            ctx.fillStyle = 'rgba(0,5,20,0.84)';
            ctx.fillRect(0, 0, CW, CH);
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor  = color;
            ctx.shadowBlur   = glow;
            ctx.fillStyle    = color;
            ctx.font         = `bold ${Math.round(62 * pulse)}px Orbitron, sans-serif`;
            const mainY = subtitle ? CH / 2 - 44 : CH / 2 - 24;
            ctx.fillText(msg, CW / 2, mainY);
            ctx.shadowBlur = 0;
            if (subtitle) {
                ctx.fillStyle = 'rgba(200,230,255,0.88)';
                ctx.font      = '24px Noto Sans KR, sans-serif';
                ctx.fillText(subtitle, CW / 2, CH / 2 + 16);
            }
            ctx.fillStyle = 'rgba(160,200,240,0.65)';
            ctx.font      = '20px Noto Sans KR, sans-serif';
            ctx.fillText(scoreRef(), CW / 2, CH / 2 + (subtitle ? 60 : 36));
            ctx.restore();
            this._overlayRaf = requestAnimationFrame(draw);
        };
        draw();
    }

    _drawStageAnnouncement() {
        const elapsed = this._announceTimer; // counts up from 0
        let alpha = 1;
        if (elapsed < 25) alpha = elapsed / 25; // fade-in only

        const goalText = {
            1: { main: '도리를 구출하세요!',                 sub: '특수 블록 속 도리를 찾아서 구출하세요!' },
            2: { main: '최하단 블럭을 파괴해 탈출!',          sub: '상어를 피해 맨 아래 열 블럭 중 하나를 부숴서 탈출하라!' },
            3: { main: '상어 3마리 처치 + 니모 블록 파괴!',   sub: '강공격으로 상어와 니모 블록을 모두 없애세요!' },
        };
        const stageNames = { 1: '조력자 구출', 2: '상어의 위협', 3: '니모 구하기' };
        const g = goalText[this._stage];

        // 스테이지별 레이아웃 y 비율 (겹침 없도록 충분한 간격 확보)
        const hasRules = this._stage === 2 || this._stage === 3;
        const subY     = hasRules ? CH * 0.68 : CH * 0.70;
        const spaceY   = hasRules ? CH * 0.95 : CH * 0.88;

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.fillStyle = 'rgba(0,5,20,0.90)';
        ctx.fillRect(0, 0, CW, CH);

        const pulse = Math.sin(Date.now() * 0.004) * 0.06 + 0.94;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        // STAGE 번호
        ctx.shadowColor = '#f7d716';
        ctx.shadowBlur  = 44;
        ctx.fillStyle   = '#f7d716';
        ctx.font        = `bold ${Math.round(82 * pulse)}px Orbitron, sans-serif`;
        ctx.fillText(`STAGE ${this._stage}`, CW / 2, CH * 0.27);

        // 스테이지 이름
        ctx.shadowColor = 'rgba(0,200,255,0.7)';
        ctx.shadowBlur  = 18;
        ctx.fillStyle   = '#00e5ff';
        ctx.font        = 'bold 28px Noto Sans KR, sans-serif';
        ctx.fillText(stageNames[this._stage], CW / 2, CH * 0.27 + 74);

        // 구분선
        ctx.shadowBlur  = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(CW * 0.22, CH * 0.53);
        ctx.lineTo(CW * 0.78, CH * 0.53);
        ctx.stroke();

        // 클리어 목표
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font      = 'bold 23px Noto Sans KR, sans-serif';
        ctx.fillText(`목표: ${g.main}`, CW / 2, CH * 0.61);

        ctx.fillStyle = 'rgba(160,210,255,0.72)';
        ctx.font      = '18px Noto Sans KR, sans-serif';
        ctx.fillText(g.sub, CW / 2, subY);

        // ── 스테이지 2/3: 강공격 룰 이미지 설명 ─────────────
        if (this._stage === 2 || this._stage === 3) {
            const ruleY1 = this._stage === 3 ? CH * 0.755 : CH * 0.77;
            const ruleW  = 460;
            const ruleH  = 38;
            const ruleX  = CW / 2 - ruleW / 2;

            // 상어 룰 박스
            ctx.shadowBlur  = 0;
            ctx.fillStyle   = 'rgba(255,60,60,0.10)';
            ctx.strokeStyle = 'rgba(255,90,90,0.45)';
            ctx.lineWidth   = 1.2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(ruleX, ruleY1 - ruleH / 2, ruleW, ruleH, 6);
            else ctx.rect(ruleX, ruleY1 - ruleH / 2, ruleW, ruleH);
            ctx.fill();
            ctx.stroke();

            // 상어 이미지
            const sImg = sharkImgs[1]?.right;
            if (sImg?.complete && sImg.naturalWidth > 0) {
                ctx.drawImage(sImg, ruleX + 10, ruleY1 - 11, 55, 22);
            }

            // 상어 룰 텍스트
            ctx.fillStyle    = 'rgba(255,150,150,0.95)';
            ctx.font         = 'bold 15px Noto Sans KR, sans-serif';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.shadowColor  = 'rgba(255,80,80,0.6)';
            ctx.shadowBlur   = 8;
            ctx.fillText('⚡ 강공격(SPACE)으로만 상어를 물리칠 수 있습니다!', ruleX + 74, ruleY1);
            ctx.shadowBlur   = 0;
        }

        // ── 스테이지 2 전용: 돌 블럭 힌트 ──────────────────
        if (this._stage === 2) {
            const ruleY2 = CH * 0.86;
            const ruleW  = 460;
            const ruleH  = 38;
            const ruleX  = CW / 2 - ruleW / 2;

            ctx.fillStyle   = 'rgba(80,130,200,0.12)';
            ctx.strokeStyle = 'rgba(130,180,230,0.45)';
            ctx.lineWidth   = 1.2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(ruleX, ruleY2 - ruleH / 2, ruleW, ruleH, 6);
            else ctx.rect(ruleX, ruleY2 - ruleH / 2, ruleW, ruleH);
            ctx.fill();
            ctx.stroke();

            const stoneImg = stoneImgs[0];
            if (stoneImg?.complete && stoneImg.naturalWidth > 0) {
                ctx.drawImage(stoneImg, ruleX + 10, ruleY2 - 12, 24, 24);
            }

            ctx.fillStyle    = 'rgba(160,210,255,0.95)';
            ctx.font         = 'bold 15px Noto Sans KR, sans-serif';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.shadowColor  = 'rgba(100,160,255,0.6)';
            ctx.shadowBlur   = 8;
            ctx.fillText('맨 아래 돌 블럭을 제거하면 탈출!', ruleX + 44, ruleY2);
            ctx.shadowBlur   = 0;
        }

        // ── 스테이지 3 전용: 니모 블록 룰 ───────────────────
        if (this._stage === 3) {
            const ruleY2 = CH * 0.855;
            const ruleW  = 460;
            const ruleH  = 38;
            const ruleX  = CW / 2 - ruleW / 2;

            ctx.textAlign = 'center';
            ctx.fillStyle   = 'rgba(255,160,50,0.10)';
            ctx.strokeStyle = 'rgba(255,180,80,0.45)';
            ctx.lineWidth   = 1.2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(ruleX, ruleY2 - ruleH / 2, ruleW, ruleH, 6);
            else ctx.rect(ruleX, ruleY2 - ruleH / 2, ruleW, ruleH);
            ctx.fill();
            ctx.stroke();

            // 니모 프리즌 이미지
            const npImg = nemoPrisonImg;
            if (npImg?.complete && npImg.naturalWidth > 0) {
                ctx.drawImage(npImg, ruleX + 8, ruleY2 - 14, 44, 28);
            }

            // 니모 블록 룰 텍스트
            ctx.fillStyle    = 'rgba(255,210,100,0.95)';
            ctx.font         = 'bold 15px Noto Sans KR, sans-serif';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.shadowColor  = 'rgba(255,160,0,0.6)';
            ctx.shadowBlur   = 8;
            ctx.fillText('⚡ 니모 블록은 강공격으로만 파괴할 수 있습니다!', ruleX + 62, ruleY2);
            ctx.shadowBlur   = 0;
        }

        // PRESS SPACE 힌트 (깜빡임)
        const blink = Math.sin(Date.now() * 0.005) * 0.35 + 0.65;
        ctx.globalAlpha  = alpha * blink;
        ctx.fillStyle    = 'rgba(255,255,255,0.55)';
        ctx.font         = '13px Orbitron, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PRESS SPACE TO START', CW / 2, spaceY);

        ctx.restore();
    }

    // ── 렌더링 ───────────────────────────────────────────────
    _draw() {
        ctx.clearRect(0, 0, CW, CH);

        // 배경 — 스테이지별 이미지, 로드 전엔 기본 그라데이션으로 폴백
        const bgImg = stageBgImgs[this._stage];
        if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
            ctx.drawImage(bgImg, 0, 0, CW, CH);
        } else {
            const bg = ctx.createLinearGradient(0, 0, 0, CH);
            bg.addColorStop(0, '#0a1e38');
            bg.addColorStop(1, '#050e1c');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, CW, CH);
        }

        // ── 화면 흔들림 적용 영역 ──────────────────────────
        ctx.save();
        if (this._shakeFrames > 0) {
            const progress = this._shakeFrames / 6;
            const ix = (Math.random() - 0.5) * this._shakeIntensity * 2 * progress;
            const iy = (Math.random() - 0.5) * this._shakeIntensity * 2 * progress;
            ctx.translate(ix, iy);
            this._shakeFrames--;
        }

        if (this._dory && !this._doriFreed && !this._dory._isCompanion) this._dory.drawPath(ctx);
        this._particles.forEach(p  => p.draw(ctx));
        for (const b of this._liveBlocks) b.draw(ctx);

        // ── Stage 3: 하단 모래바람 — 블록 위에 씌워 아래쪽을 흐릿하게 ─
        if (this._stage === 3) {
            const t          = Date.now() * 0.00045;
            const dustStartY = CH * 0.62;
            const dustH      = CH - dustStartY;

            // 모래안개 그라데이션
            const dg = ctx.createLinearGradient(0, dustStartY, 0, CH);
            dg.addColorStop(0,    'rgba(175,142,62,0)');
            dg.addColorStop(0.30, 'rgba(188,155,72,0.16)');
            dg.addColorStop(0.65, 'rgba(202,168,82,0.30)');
            dg.addColorStop(0.85, 'rgba(210,175,88,0.55)');
            dg.addColorStop(1,    'rgba(220,182,92,0.78)');
            ctx.fillStyle = dg;
            ctx.fillRect(0, dustStartY, CW, dustH);

            // 흩날리는 모래 입자 (Math.random 없이 sin으로 안정적 위치)
            ctx.save();
            for (let i = 0; i < 65; i++) {
                const bx = (Math.sin(i * 3.71 + 1.23) * 0.5 + 0.5 +
                            Math.sin(t * 0.6 + i * 0.42) * 0.05) * CW;
                const relY = Math.sin(i * 2.13 + 3.47) * 0.5 + 0.5;
                const by   = dustStartY + relY * dustH +
                             Math.sin(t * 1.15 + i * 0.88) * 9;
                const sz   = Math.abs(Math.sin(i * 3.17)) * 2.8 + 0.4;
                const al   = (Math.abs(Math.sin(i * 2.31)) * 0.32 + 0.08) *
                             (0.35 + 0.65 * relY);
                ctx.fillStyle = `rgba(212,178,90,${al.toFixed(2)})`;
                ctx.fillRect(bx, by, sz, sz);
            }
            ctx.restore();
        }

        this._items.forEach(it     => it.draw(ctx));
        if (this._dory)  this._dory.draw(ctx);
        this._sharks.forEach(s => s.draw(ctx));
        this._ripples.forEach(rp => {
            if (rp.life <= 0) return;
            ctx.save();
            ctx.globalAlpha = rp.life * 0.85;
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, Math.max(0, rp.r), 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth   = 3 * rp.life;
            ctx.stroke();
            ctx.restore();
        });
        this._balls.forEach(b      => b.draw(ctx));
        this._paddle.draw(ctx);


        this._scorePopups.forEach(sp => sp.draw(ctx));

        // ── 니모 이미지 (진짜 박스 파괴 후 등장) ─────────────
        if (this._nemoPos) {
            const ni = typeof nemoImg !== 'undefined' ? nemoImg : null;
            if (ni?.complete && ni.naturalWidth > 0) {
                const nemoSize = 48;
                const bobY = Math.sin(Date.now() * 0.003) * 4;
                ctx.save();
                ctx.shadowColor = '#ff8c00';
                ctx.shadowBlur  = 20;
                ctx.drawImage(ni,
                    this._nemoPos.x - nemoSize / 2,
                    this._nemoPos.y - nemoSize / 2 + bobY,
                    nemoSize, nemoSize
                );
                ctx.restore();
            }
        }

        ctx.restore(); // ── 흔들림 영역 종료

        // ── 도리 힌트 말풍선 (Stage 3 게임 시작 직후) ────────
        if (this._stage === 3 && this._doryHintTimer > 0 && this._dory?._isCompanion) {
            const alpha = Math.min(1, this._doryHintTimer / 30);
            ctx.save();
            ctx.globalAlpha = alpha;
            this._drawSpeechBubble(ctx, this._doryHintText,
                this._dory.x, this._dory.y, false);
            ctx.restore();
        }

        // ── 니모 말풍선 (상어 미처치 시 — 상어가 남아있는 한 계속 표시) ──────
        if (this._nemoPos && this._nemoBubbleText && this._sharksKilled < 3) {
            ctx.save();
            this._drawSpeechBubble(ctx, this._nemoBubbleText,
                this._nemoPos.x, this._nemoPos.y, true);
            ctx.restore();
        }

        // ── Stage 1 클리어 — 심해 다이브 연출 오버레이 ─────
        if (this._stage1Diving) {
            if (this._stage1DiveTimer > 90) {
                const diveProgress = Math.max(0, Math.min(1,
                    (this._paddle.y - 16) / (CH + 60 - 16)));
                ctx.fillStyle = `rgba(0,5,20,${diveProgress * 0.88})`;
                ctx.fillRect(0, 0, CW, CH);
            }
            const textAlpha = Math.min(1, this._stage1DiveTimer / 30);
            ctx.save();
            ctx.globalAlpha  = textAlpha;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor  = '#f7d716';
            ctx.shadowBlur   = 36;
            ctx.fillStyle    = '#f7d716';
            ctx.font         = 'bold 62px Orbitron, sans-serif';
            ctx.fillText('Stage1 Clear!', CW / 2, CH * 0.35);
            ctx.shadowBlur   = 0;
            ctx.fillStyle    = 'rgba(220,240,255,0.88)';
            ctx.font         = '22px Noto Sans KR, sans-serif';
            ctx.fillText(`SCORE: ${this._score}  |  BEST: ${this._highScore}`, CW / 2, CH * 0.35 + 50);
            ctx.restore();
        }

        // ── Stage 2 클리어 — 심해 다이브 연출 오버레이 ─────
        if (this._stage2Diving) {
            if (this._stage2DiveTimer > 90) {
                const diveProgress = Math.max(0, Math.min(1,
                    (this._paddle.y - 16) / (CH + 60 - 16)));
                ctx.fillStyle = `rgba(0,5,20,${diveProgress * 0.88})`;
                ctx.fillRect(0, 0, CW, CH);
            }
            const textAlpha = Math.min(1, this._stage2DiveTimer / 30);
            ctx.save();
            ctx.globalAlpha  = textAlpha;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor  = '#f7d716';
            ctx.shadowBlur   = 36;
            ctx.fillStyle    = '#f7d716';
            ctx.font         = 'bold 62px Orbitron, sans-serif';
            ctx.fillText('Stage2 Clear!', CW / 2, CH * 0.35);
            ctx.shadowBlur   = 0;
            ctx.fillStyle    = 'rgba(220,240,255,0.88)';
            ctx.font         = '22px Noto Sans KR, sans-serif';
            ctx.fillText(`SCORE: ${this._score}  |  BEST: ${this._highScore}`, CW / 2, CH * 0.35 + 50);
            ctx.restore();
        }

        // ── 상태 UI 오버레이 (흔들림 없음) ─────────────────

        // ── 파워스윙 상태 표시 ──────────────────────────────
        if (this._phase === 'PLAYING' && this._paddle) {
            if (this._paddle.isSwinging) {
                ctx.save();
                ctx.fillStyle   = '#f7d716';
                ctx.font        = 'bold 13px Orbitron, sans-serif';
                ctx.textAlign   = 'center';
                ctx.shadowColor = '#ff8c00';
                ctx.shadowBlur  = 16;
                ctx.fillText('⚡ POWER SWING!', CW / 2, CH - 82);
                ctx.restore();
            } else if (this._paddle.swingReady) {
                const alpha = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle   = '#f7d716';
                ctx.font        = 'bold 11px Orbitron, sans-serif';
                ctx.textAlign   = 'center';
                ctx.fillText('⚡ POWER SWING [SPACE]', CW / 2, CH - 82);
                ctx.restore();
            }
        }

        // ── 스테이지 시작 공지 오버레이 ─────────────────────
        if (this._announceActive) this._drawStageAnnouncement();

        // ── READY 상태: PRESS SPACE TO START 깜빡임 ────────
        if (this._phase === 'READY' && this._running && !this._announceActive) {
            const alpha  = Math.sin(Date.now() * 0.004) * 0.45 + 0.55;
            const readyY = this._paddle ? this._paddle.y + this._paddle.h + 60 : CH * 0.25;
            ctx.save();
            ctx.globalAlpha    = alpha;
            ctx.textAlign      = 'center';
            ctx.textBaseline   = 'middle';
            ctx.font           = 'bold 22px Orbitron, sans-serif';
            ctx.fillStyle      = '#ffffff';
            ctx.shadowColor    = '#00e5ff';
            ctx.shadowBlur     = 22;
            ctx.fillText('PRESS SPACE TO START', CW / 2, readyY);
            ctx.restore();
        }

        // 페이드인 오버레이
        if (this._fadeInAlpha > 0) {
            const elapsed = performance.now() - this._fadeInStart;
            this._fadeInAlpha = Math.max(0, 1.0 - elapsed / 800);
            ctx.fillStyle = `rgba(0,0,0,${this._fadeInAlpha})`;
            ctx.fillRect(0, 0, CW, CH);
        }

        if (this._paddle) { this._updateSwingHUD(); this._updateItemStatusHUD(); }
    }

    // ── HUD 동기화 ───────────────────────────────────────────
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

    _updateSwingHUD() {
        const { swingBadge: badge, swingCdRow: cdRow, swingCdFill: cdFill, swingCdNum: cdNum } = this._hudEls;
        if (!badge) return;

        if (this._paddle.isSwinging) {
            badge.style.display = 'inline-block';
            badge.textContent   = '⚡ ACTIVE';
            badge.className     = 'swing-badge active';
            cdRow.style.display = 'none';
        } else if (this._paddle.swingReady) {
            badge.style.display = 'inline-block';
            badge.textContent   = '✓ READY';
            badge.className     = 'swing-badge';
            cdRow.style.display = 'none';
        } else {
            badge.style.display = 'none';
            cdRow.style.display = 'flex';
            const pct = (this._paddle._swingCd / 180) * 100;
            cdFill.style.width  = pct + '%';
            cdNum.textContent   = (this._paddle._swingCd / 60).toFixed(1) + '초';
        }
    }

    _updateItemStatusHUD() {
        const h = this._hudEls;
        if (!h.itemStatusEmpty) return;

        const expandT = this._paddle._expandT;
        let maxSlow = 0;
        for (const b of this._balls) if (b.slowTimer > maxSlow) maxSlow = b.slowTimer;

        const hasActive = expandT > 0 || maxSlow > 0;
        h.itemStatusEmpty.style.display = hasActive ? 'none' : '';

        if (h.itemCdPaddle) {
            h.itemCdPaddle.style.display = expandT > 0 ? '' : 'none';
            if (expandT > 0) {
                h.itemCdPaddleFill.style.width = Math.min(100, (expandT / 480) * 100).toFixed(1) + '%';
                h.itemCdPaddleNum.textContent  = (expandT / 60).toFixed(1) + '초';
            }
        }
        if (h.itemCdSlow) {
            h.itemCdSlow.style.display = maxSlow > 0 ? '' : 'none';
            if (maxSlow > 0) {
                h.itemCdSlowFill.style.width = Math.min(100, (maxSlow / 240) * 100).toFixed(1) + '%';
                h.itemCdSlowNum.textContent  = (maxSlow / 60).toFixed(1) + '초';
            }
        }
    }

    _rainbowBlockHit(ball, block) {
        ball.rainbow = false;

        const cx = block.x + block.w / 2;
        const cy = block.y + block.h / 2;
        const nearby = this._blocks
            .filter(b => b.alive && b !== block)
            .sort((a, b) => {
                const da = Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy);
                const db = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
                return da - db;
            })
            .slice(0, 2);

        const toDestroy     = [block, ...nearby];
        const prevDestroyed = this._blocksDestroyed;
        let doriBlock       = null;

        for (const b of toDestroy) {
            if (!b.alive) continue;
            b.alive = false;
            if (b._hasDori) doriBlock = b;

            const pts = b.type === BT.hard ? 300 : b.type === BT.vortex ? 200 : 100;
            this._score += pts;
            this._scorePopups.push(new ScorePopup(b.x + b.w / 2, b.y + b.h / 2, pts));
            this._particles.push(...spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color));
            if (b._itemType)
                this._items.push(new Item(b.x + b.w / 2, b.y + b.h / 2, b._itemType));
            this._blocksDestroyed++;
            this._aliveBlocks--;
        }

        this._syncHUD(true);
        this._saveHigh();
        this.audio.playBlockBreak();
        this._shakeFrames    = 12;
        this._shakeIntensity = 10;

        if (Math.floor(this._blocksDestroyed / 8) > Math.floor(prevDestroyed / 8)) {
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

        return doriBlock
            ? { x: doriBlock.x + doriBlock.w / 2, y: doriBlock.y + doriBlock.h / 2 }
            : null;
    }

    _drawSpeechBubble(ctx, text, targetX, targetY, bubbleAbove = true) {
        const padding = 14;
        const bh = 36;
        ctx.save();
        ctx.font = 'bold 14px Noto Sans KR, sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(text).width;
        const bw = textW + padding * 2;
        let bx = targetX - bw / 2;
        let by = bubbleAbove ? targetY - bh - 16 : targetY + 16;
        bx = Math.max(8, Math.min(CW - bw - 8, bx));
        by = Math.max(8, Math.min(CH - bh - 40, by));
        const tailX = Math.max(bx + 14, Math.min(bx + bw - 14, targetX));

        ctx.shadowColor   = 'rgba(0,0,0,0.22)';
        ctx.shadowBlur    = 6;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = 'rgba(255,252,235,0.97)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 10);
        else ctx.rect(bx, by, bw, bh);
        ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.strokeStyle = 'rgba(80,160,220,0.85)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 10);
        else ctx.rect(bx, by, bw, bh);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,252,235,0.97)';
        ctx.beginPath();
        if (bubbleAbove) {
            ctx.moveTo(tailX - 7, by + bh);
            ctx.lineTo(tailX + 7, by + bh);
            ctx.lineTo(tailX, by + bh + 11);
        } else {
            ctx.moveTo(tailX - 7, by);
            ctx.lineTo(tailX + 7, by);
            ctx.lineTo(tailX, by - 11);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,160,220,0.85)';
        ctx.lineWidth   = 2;
        ctx.stroke();

        ctx.fillStyle = '#1a3a5c';
        ctx.shadowBlur = 0;
        ctx.fillText(text, bx + padding, by + bh / 2);
        ctx.restore();
    }

    _doStage1ClearTransition() {
        this._running = false;
        cancelAnimationFrame(this._raf);
        this._stopOverlay();
        this._saveHigh();

        if (!this._clearedStages.includes(this._stage)) {
            this._clearedStages.push(this._stage);
            writeSave({ clearedStages: this._clearedStages });
        }

        const stageNum = this._stage;
        setTimeout(() => this._launchStage(stageNum + 1), 300);
    }

    _doStage2ClearTransition() {
        this._running = false;
        cancelAnimationFrame(this._raf);
        this._stopOverlay();
        this._saveHigh();

        if (!this._clearedStages.includes(this._stage)) {
            this._clearedStages.push(this._stage);
            writeSave({ clearedStages: this._clearedStages });
        }

        const stageNum = this._stage;
        setTimeout(() => this._launchStage(stageNum + 1), 300);
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
        this._settings = { bgm: g('bgm'), sfx: g('sfx'), theme: g('theme'), tsize: g('textsize') };
        this.audio.setEnabled(this._settings.sfx !== 'off');
        document.body.dataset.theme = this._settings.theme || 'deep';
        document.body.dataset.tsize = this._settings.tsize || 'md';
    }

    _loadSettingsUI() {
        const s = this._settings;
        [['bgm',s.bgm],['sfx',s.sfx],['textsize',s.tsize??'md'],['theme',s.theme]]
            .forEach(([grp, val]) => {
                if (!val) return;
                document.querySelectorAll(`[data-group="${grp}"]`)
                    .forEach(b => b.classList.toggle('on', b.dataset.val === val));
            });
    }

    _resetSettingsUI() {
        [['bgm','on'],['sfx','on'],['textsize','md'],['theme','deep']]
            .forEach(([g, v]) =>
                document.querySelectorAll(`[data-group="${g}"]`)
                    .forEach(b => b.classList.toggle('on', b.dataset.val === v))
            );
        document.querySelectorAll('.color-swatches .swatch')
            .forEach((s, i) => s.classList.toggle('selected', i === 0));
        this._applySettings();
        const col = this._ballColor();
        this._balls?.forEach(b => b.color = col);
    }
}

/* ============================================================
   Bootstrap
============================================================ */
window.addEventListener('DOMContentLoaded', () => {
    window._game = new Game();
});
