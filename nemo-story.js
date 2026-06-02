'use strict';
/* ============================================================
   nemo-story.js — 스토리 담당 파일
   담당: 스토리 팀원
   역할: 모든 대사 스크립트 데이터 + 대화창(DialogueManager) 클래스
   의존: 없음 (nemo-objects.js, nemo-game.js보다 먼저 로드)
============================================================ */

/* ============================================================
   DIALOGUE — 대사 스크립트 데이터
   각 오브젝트 구조:
     speaker : 이름표에 표시할 화자 이름
     side    : 'left'(도리/말린 좌측) | 'right'(상대방 우측)
     text    : 대화 내용 (타이핑 효과로 한 글자씩 표시됨)

   [스토리 담당 수정 범위]
   · 수정 가능: speaker 이름, text 내용, 엔트리 추가/삭제
   · 수정 금지: DIALOGUE 객체의 키(1, '1_out', 2, '2_out', 3, '3_out') —
                 키 변경 시 nemo-game.js _launchStage() / _stageClear() 에서 참조 불일치 발생
   · side 값은 'left' 또는 'right' 만 허용 (다른 값은 무시됨)
   · 새 씬(예: 'prologue') 추가 후 사용하려면 nemo-game.js에서 dialogue.play('prologue', cb) 호출 필요
============================================================ */
const DIALOGUE = {

    // ── STAGE 1 인트로: 조력자 구출 ─────────────────────────
    1: [
        { speaker: '도 리',  side: 'left',  text: '어... 저 여기가 어딘지 기억이 안 나요. 도와주실 수 있나요?' },
        { speaker: '말 린',  side: 'right', text: '도리! 걱정 마, 내가 반드시 구해줄게. 조금만 기다려!' },
        { speaker: '도 리',  side: 'left',  text: '벽돌들을 부숴서 저를 구해주세요! 참, 제 이름이 뭐였더라...' },
        { speaker: '말 린',  side: 'right', text: '(한숨) 도리야. 서두르자, 공을 발사해서 블록을 깨!' },
    ],

    // ── STAGE 1 아웃트로 ─────────────────────────────────────
    '1_out': [
        { speaker: '도 리',  side: 'left',  text: '고마워요! 그런데... 제가 왜 거기 있었죠? 기억이 안 나네요.' },
        { speaker: '말 린',  side: 'right', text: '괜찮아, 도리. 이제 다음 단계로 같이 가자!' },
        { speaker: '도 리',  side: 'left',  text: '오케이! 앞으로 나아가는 거죠? 그건 기억해요!' },
    ],

    // ── STAGE 2 인트로: 상어의 위협 ─────────────────────────
    2: [
        { speaker: '브루스', side: 'right', text: '물고기는... 친구다. 물고기는 친구야. (눈빛이 흔들린다)' },
        { speaker: '말 린',  side: 'left',  text: '저 상어! 도리, 조심해. 공이 저한테 닿으면 패들 방향이 뒤집혀버려!' },
        { speaker: '도 리',  side: 'right', text: '상어가 친구랬잖아요. 친구... 맞죠?' },
        { speaker: '말 린',  side: 'left',  text: '일단 도망가! 브루스, 미안하지만 오늘은 식사 취소야!' },
    ],

    // ── STAGE 2 아웃트로 ─────────────────────────────────────
    '2_out': [
        { speaker: '브루스', side: 'right', text: '피... 피 냄새. 피는 내 이성을 자극해! 하지만 참을 수 있어!' },
        { speaker: '말 린',  side: 'left',  text: '브루스를 따돌렸어! 니모가 점점 가까워지고 있어, 도리!' },
        { speaker: '도 리',  side: 'right', text: '우리 이겼죠? 이긴 거 맞죠? 저 이기는 거 좋아해요!' },
    ],

    // ── STAGE 3 인트로: 니모 구하기 ─────────────────────────
    3: [
        { speaker: '말 린',  side: 'left',  text: '드디어 여기까지 왔어, 니모. 아빠가 왔다!' },
        { speaker: '니 모',  side: 'right', text: '아빠!! 빨리 이 벽을 부숴주세요. 소용돌이 블록은 속도가 느려지니까 조심해요!' },
        { speaker: '도 리',  side: 'left',  text: '시야가 너무 어두워요. 뭔가 찜찜하지만... 할 수 있어요!' },
        { speaker: '말 린',  side: 'right', text: '마지막이야. 포기하지 마. 니모, 기다려!' },
    ],

    // ── STAGE 3 아웃트로 / 엔딩 ─────────────────────────────
    '3_out': [
        { speaker: '니 모',  side: 'right', text: '아빠! 해냈어요!! 드디어 자유야!' },
        { speaker: '말 린',  side: 'left',  text: '니모... 드디어 찾았다. 다시는 절대 놓치지 않을게.' },
        { speaker: '도 리',  side: 'right', text: '저도 있어요! 우리 셋이 함께잖아요. 기억할게요, 아마도!' },
        { speaker: '말 린',  side: 'left',  text: '집으로 돌아가자. 함께.' },
    ],
};

/* ============================================================
   DialogueManager — VN 대화창 제어 + 글자 타이핑 효과
   Game 클래스(nemo-game.js)에서 생성되어 사용됨

   [스토리 담당 — 이 클래스는 수정하지 않아도 됩니다]
   · 타이핑 속도 조정 필요 시: this._speed 값 변경 (기본 38ms/글자)
   · 키보드 단축키(Space/Enter) 동작은 변경 금지
============================================================ */
class DialogueManager {
    /**
     * @param {AudioManager} audio  효과음 재생용 AudioManager 인스턴스
     */
    constructor(audio) {
        this.audio     = audio;
        this._timer    = null;
        this._charIdx  = 0;
        this._fullText = '';
        this._lineIdx  = 0;
        this._script   = [];
        this._onDone   = null;
        this._speed    = 38; // ms / 글자

        // DOM 요소 참조
        this.nameTag  = document.getElementById('vnNameTag');
        this.textEl   = document.getElementById('vnText');
        this.stageTag = document.querySelector('.vn-stage-tag');
        this.charL    = document.getElementById('vnCharLeft');
        this.charR    = document.getElementById('vnCharRight');

        // ── 버튼 이벤트 ──
        document.getElementById('btnVnNext').addEventListener('click', () => this._next());
        document.getElementById('btnVnSkip').addEventListener('click', () => {
            this._stopTyping();
            this._onDone?.();
        });

        // Space / Enter 로 다음 줄
        document.addEventListener('keydown', e => {
            // screenEls 는 nemo-game.js 에서 선언 (이벤트 발화 시점엔 이미 로드됨)
            if (!screenEls.dialog.classList.contains('active')) return;
            if (e.code === 'Space' || e.key === 'Enter') {
                e.preventDefault();
                this._next();
            }
        });
    }

    /**
     * 대화 재생 시작
     * @param {number|string} key  DIALOGUE 객체의 키 (1, 2, 3, '1_out', ...)
     * @param {Function}      onDone  대화 종료 후 호출할 콜백
     */
    play(key, onDone) {
        this._script  = DIALOGUE[key] ?? DIALOGUE[1];
        this._lineIdx = 0;
        this._onDone  = onDone;
        this._showLine();
    }

    // ── 현재 줄 표시 ───────────────────────────────────────────
    _showLine() {
        const line = this._script[this._lineIdx];
        if (!line) { this._onDone?.(); return; }

        this.nameTag.textContent = line.speaker;
        this.charL.classList.toggle('active', line.side === 'left');
        this.charR.classList.toggle('active', line.side === 'right');

        this._stopTyping();
        this._fullText = line.text;
        this._charIdx  = 0;
        this.textEl.textContent = '';
        this._typeNext();
    }

    // ── 타이핑 효과 (재귀 setTimeout) ──────────────────────────
    _typeNext() {
        if (this._charIdx >= this._fullText.length) return;
        this._timer = setTimeout(() => {
            this.textEl.textContent += this._fullText[this._charIdx++];
            // 3글자마다 타이핑 효과음
            if (this._charIdx % 3 === 0) this.audio.playTyping();
            this._typeNext();
        }, this._speed);
    }

    _stopTyping() { clearTimeout(this._timer); }

    // ── 다음 줄 / 즉시 완성 ────────────────────────────────────
    _next() {
        // 타이핑 진행 중 → 현재 줄 전체 즉시 표시
        if (this._charIdx < this._fullText.length) {
            this._stopTyping();
            this.textEl.textContent = this._fullText;
            this._charIdx = this._fullText.length;
            return;
        }
        // 타이핑 완료 → 다음 줄로
        this._lineIdx++;
        if (this._lineIdx < this._script.length) this._showLine();
        else                                      this._onDone?.();
    }
}
