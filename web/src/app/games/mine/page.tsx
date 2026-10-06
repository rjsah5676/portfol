"use client";

import RankList from "@/components/RankList";
import GameHeader from "@/components/GameHeader";
import { MINE_GUIDE } from "@/data/gameGuides";
import { useState, useEffect, useRef } from "react";
import { getTopRankings, addRanking, type MineRanking } from "@/firestore/minesweeperRankings";
import { playChord, playExplosion, playFlag, playReveal } from "@/lib/sfx";
import endBgmSrc from "@/sounds/melongame/endbgm.mp3";
import "@/css/minesweeper.css";
import { generateNoGuessBoard } from "./noGuess";
import HintBubble, { markHintSeen } from "@/components/HintBubble";

const HINT_KEY = "hint:mine-controls";

type Grid<T> = T[][];
type Timer = ReturnType<typeof setTimeout>;

export default function Minesweeper() {
  const [rankOpen, setRankOpen] = useState(false);
  // window.innerHeight/innerWidth를 useState 초기값으로 직접 넣으면 정적 export
  // 빌드(Node, window 없음) 중에 그대로 크래시남 -> 안전한 기본값으로 시작하고
  // 마운트 후 useEffect에서 실제 값으로 갱신.
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    setIsPortrait(window.innerHeight > window.innerWidth);
    const handleResize = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 판 크기는 state로 들고, 게임 시작 전일 때만 화면 방향에 맞춰 바꾼다.
  // (예전엔 isPortrait에서 바로 계산해서, 첫 렌더의 20x24 배열로 만든 state와
  //  세로 화면의 24x20 크기가 어긋나 모바일에서 첫 탭에 크래시났음)
  const [dims, setDims] = useState({ rows: 20, cols: 24 });
  const ROWS = dims.rows;
  const COLS = dims.cols;
  const MINES = 99;

  // new Audio(...)도 브라우저 API라 렌더 중이 아니라 ref에 지연 생성해서 사용.
  const endBgmAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    endBgmAudioRef.current = new Audio(endBgmSrc);
    endBgmAudioRef.current.volume = 0.6;
  }, []);

  const [board, setBoard] = useState<Grid<number>>(
    Array.from({ length: ROWS }, () => Array(COLS).fill(0))
  );
  const [visible, setVisible] = useState<Grid<boolean>>(
    Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  );
  const [flagged, setFlagged] = useState<Grid<boolean>>(
    Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  );
  const [gameOver, setGameOver] = useState(false);
  const [win, setWin] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return; // 진행 중에는 회전해도 판 크기 유지
    const next = isPortrait ? { rows: 24, cols: 20 } : { rows: 20, cols: 24 };
    if (next.rows === dims.rows && next.cols === dims.cols) return;
    /* eslint-disable react-hooks/set-state-in-effect -- 화면 방향에 맞춰 빈 판을 다시 만듦 */
    setDims(next);
    setBoard(Array.from({ length: next.rows }, () => Array(next.cols).fill(0)));
    setVisible(Array.from({ length: next.rows }, () => Array(next.cols).fill(false)));
    setFlagged(Array.from({ length: next.rows }, () => Array(next.cols).fill(false)));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isPortrait, initialized, dims]);
  const [pressingCell, setPressingCell] = useState<{ row: number; col: number } | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [timer, setTimer] = useState<number | string>(0);
  const [rankings, setRankings] = useState<MineRanking[]>([]);
  const flaggedCount = flagged.flat().filter((v) => v).length;
  const remainingMines = MINES - flaggedCount;

  useEffect(() => {
    if (!startTime || gameOver) return;
    const interval = setInterval(() => {
      setTimer(((Date.now() - startTime) / 1000).toFixed(1));
    }, 100);
    return () => clearInterval(interval);
  }, [startTime, gameOver]);

  useEffect(() => {
    if (win && startTime) {
      const clearTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const name = prompt(`🎉 ${clearTime}s 클리어! 이름을 입력하세요:`);
      if (name) {
        addRanking(name, parseFloat(clearTime));
      }
    }
  }, [win]);

  useEffect(() => {
    getTopRankings(10).then(setRankings);
  }, [win]);

  useEffect(() => {
    const handleMouseUp = () => setPressingCell(null);
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const resetGame = () => {
    setBoard(Array.from({ length: ROWS }, () => Array(COLS).fill(0)));
    setVisible(Array.from({ length: ROWS }, () => Array(COLS).fill(false)));
    setFlagged(Array.from({ length: ROWS }, () => Array(COLS).fill(false)));
    setGameOver(false);
    setWin(false);
    setInitialized(false);
    setStartTime(null);
    setTimer(0);
  };

  const floodFill = (r: number, c: number, newVisible: Grid<boolean>) => {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || newVisible[r][c]) return;
    newVisible[r][c] = true;
    if (board[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          floodFill(r + dr, c + dc, newVisible);
        }
      }
    }
  };

  useEffect(() => {
    if (!gameOver) return;
    // 지뢰를 밟으면 폭발음, 클리어면 엔딩 음악
    if (!win) playExplosion();
    else if (endBgmAudioRef.current) {
      endBgmAudioRef.current.currentTime = 0;
      endBgmAudioRef.current.play();
    }
  }, [gameOver, win]);

  const handleLeftClick = (r: number, c: number) => {
    if (gameOver || visible[r][c] || flagged[r][c]) return;

    if (!initialized) {
      // 찍기(50:50) 없이 논리만으로 끝까지 풀리는 판만 생성
      const { board: newBoard } = generateNoGuessBoard(r, c, ROWS, COLS, MINES);
      setBoard(newBoard);
      setStartTime(Date.now());

      const newVisible = visible.map((row) => [...row]);
      const tempBoard = newBoard;
      const flood = (r: number, c: number) => {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || newVisible[r][c]) return;
        newVisible[r][c] = true;
        if (tempBoard[r][c] === 0) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              flood(r + dr, c + dc);
            }
          }
        }
      };
      flood(r, c);

      setVisible(newVisible);
      setInitialized(true);
      playReveal();
      return;
    }

    const newVisible = visible.map((row) => [...row]);
    if (board[r][c] === -1) {
      setGameOver(true); // 소리는 폭발음만
      newVisible[r][c] = true;
    } else {
      floodFill(r, c, newVisible);
      playReveal();
    }
    setVisible(newVisible);
    checkWin(newVisible);
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (gameOver || visible[r][c]) return;
    playFlag(!flagged[r][c]);
    const newFlagged = flagged.map((row) => [...row]);
    newFlagged[r][c] = !newFlagged[r][c];
    setFlagged(newFlagged);
    markHintSeen(HINT_KEY);
  };

  const handleMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.buttons === 3 && visible[r][c]) {
      setPressingCell({ row: r, col: c });
    }
    if (e.buttons !== 3 || gameOver || !visible[r][c]) return;
    const target = board[r][c];
    if (target <= 0) return;

    let flagCount = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr,
          nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          if (flagged[nr][nc]) flagCount++;
        }
      }
    }

    if (flagCount === target) {
      const newVisible = visible.map((row) => [...row]);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr,
            nc = c + dc;
          if (
            nr >= 0 &&
            nr < ROWS &&
            nc >= 0 &&
            nc < COLS &&
            !visible[nr][nc] &&
            !flagged[nr][nc]
          ) {
            if (board[nr][nc] === -1) {
              newVisible[nr][nc] = true;
              setVisible(newVisible);
              setGameOver(true);
              return;
            } else {
              floodFill(nr, nc, newVisible);
            }
          }
        }
      }
      playChord();
      setVisible(newVisible);
      checkWin(newVisible);
    }
  };

  const checkWin = (visibleBoard: Grid<boolean>) => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== -1 && !visibleBoard[r][c]) return;
      }
    }
    setWin(true);
    setGameOver(true);
  };

  const [touchTimer, setTouchTimer] = useState<Timer | null>(null);
  const handleTouchStart = (r: number, c: number) => {
    const timer = setTimeout(() => {
      if (!gameOver && !visible[r][c]) {
        const newFlagged = flagged.map((row) => [...row]);
        newFlagged[r][c] = !newFlagged[r][c];
        setFlagged(newFlagged);
        playFlag(newFlagged[r][c]);
        markHintSeen(HINT_KEY);
      }
    }, 600);
    setTouchTimer(timer);
  };

  const handleTouchEnd = () => {
    if (touchTimer) clearTimeout(touchTimer);
  };
  // 손가락이 움직이거나(판 밀기) 두 손가락(확대)이면 꾹 누르기 취소 — 확대하다 깃발 꽂히는 일 방지
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const cancelLongPress = () => {
    if (touchTimer) clearTimeout(touchTimer);
    if (numberTouchTimer) clearTimeout(numberTouchTimer);
  };

  const handleNumberLongPress = (r: number, c: number) => {
    if (!visible[r][c] || board[r][c] <= 0) return;
    const target = board[r][c];

    let flagCount = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr,
          nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && flagged[nr][nc]) {
          flagCount++;
        }
      }
    }

    if (flagCount === target) {
      const newVisible = visible.map((row) => [...row]);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr,
            nc = c + dc;
          if (
            nr >= 0 &&
            nr < ROWS &&
            nc >= 0 &&
            nc < COLS &&
            !visible[nr][nc] &&
            !flagged[nr][nc]
          ) {
            if (board[nr][nc] === -1) {
              newVisible[nr][nc] = true;
              setVisible(newVisible);
              setGameOver(true);
              return;
            } else {
              floodFill(nr, nc, newVisible);
            }
          }
        }
      }
      playChord();
      setVisible(newVisible);
      checkWin(newVisible);
    }
  };

  const [numberTouchTimer, setNumberTouchTimer] = useState<Timer | null>(null);

  const handleNumberTouchStart = (r: number, c: number) => {
    const timer = setTimeout(() => handleNumberLongPress(r, c), 500);
    setNumberTouchTimer(timer);
  };

  const handleNumberTouchEnd = () => {
    if (numberTouchTimer) clearTimeout(numberTouchTimer);
  };

  return (
    <div className="minesweeper">
      <GameHeader
        icon="💣"
        title="지뢰찾기"
        en="Minesweeper"
        accent="#F87171"
        desc="지뢰 99개 고급 난이도"
        className="w-full max-w-[848px]"
        guide={MINE_GUIDE}
        rank={{
          top: rankings.slice(0, 3).map((r) => ({ name: r.name, value: `${r.time}s` })),
          sub: "클리어 시간",
          open: rankOpen,
          onOpenChange: setRankOpen,
          render: () => (
            <RankList
              rows={rankings.map((r) => ({ name: r.name, value: `${r.time}s`, date: r.createdAt }))}
              skip={3}
            />
          ),
        }}
      />
      <div className="status-row">
        <div className="status-box">⏱ {timer}s</div>
        <div className="status-box">🚩 {remainingMines}</div>
      </div>
      <div style={{ height: 12 }} />
      <div className="relative">
        {/* 조작법 안내 (PC: 마우스 / 모바일: 꾹 누르기) */}
        <HintBubble
          storageKey={HINT_KEY}
          tail="none"
          maxShows={3}
          delay={1200}
          duration={6000}
          className="absolute top-6 left-1/2 -translate-x-1/2"
          mobile={
            <>
              <b className="text-white">꾹</b> 누르면 깃발 · 숫자를 <b className="text-white">꾹</b>{" "}
              누르면 주변이 열려요
            </>
          }
        >
          <b className="text-white">우클릭</b>으로 깃발 · 숫자 위에서{" "}
          <b className="text-white">좌+우 동시 클릭</b>하면 주변이 열려요
        </HintBubble>
        <div className="mine-viewport">
          <div className="mine-grid">
            {board.map((row, rIdx) => (
              <div className="mine-row" key={rIdx}>
                {row.map((cell, cIdx) => {
                  const isHighlighted =
                    pressingCell &&
                    Math.abs(pressingCell.row - rIdx) <= 1 &&
                    Math.abs(pressingCell.col - cIdx) <= 1;
                  const isEven = (rIdx + cIdx) % 2 === 0;
                  const isOpen = visible[rIdx][cIdx];
                  return (
                    <div
                      key={cIdx}
                      className={`cell ${isOpen ? "open" : ""} ${isEven ? "even" : ""} ${
                        isHighlighted && !isOpen ? "highlight" : ""
                      }`}
                      onClick={() => handleLeftClick(rIdx, cIdx)}
                      onContextMenu={(e) => handleRightClick(e, rIdx, cIdx)}
                      onMouseDown={(e) => handleMouseDown(e, rIdx, cIdx)}
                      onTouchStart={(e) => {
                        if (e.touches.length > 1) {
                          cancelLongPress();
                          return;
                        }
                        touchStartPos.current = {
                          x: e.touches[0].clientX,
                          y: e.touches[0].clientY,
                        };
                        if (visible[rIdx][cIdx] && board[rIdx][cIdx] > 0) {
                          handleNumberTouchStart(rIdx, cIdx);
                        } else {
                          handleTouchStart(rIdx, cIdx);
                        }
                      }}
                      onTouchMove={(e) => {
                        const p0 = touchStartPos.current;
                        const t = e.touches[0];
                        if (
                          e.touches.length > 1 ||
                          (p0 && t && Math.hypot(t.clientX - p0.x, t.clientY - p0.y) > 8)
                        )
                          cancelLongPress();
                      }}
                      onTouchEnd={() => {
                        handleNumberTouchEnd();
                        handleTouchEnd();
                      }}
                    >
                      {flagged[rIdx][cIdx] ? (
                        "🚩"
                      ) : isOpen ? (
                        cell === -1 ? (
                          "💣"
                        ) : cell ? (
                          <span style={{ fontWeight: "bold" }} className={`number number-${cell}`}>
                            {cell}
                          </span>
                        ) : (
                          ""
                        )
                      ) : (
                        ""
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {gameOver && (
              <div className="message-overlay">
                {win ? "🎉 클리어!" : "💥 펑 ㅋㅋ"}
                <button
                  className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
                  onClick={resetGame}
                >
                  🔁 새 게임
                </button>
                <button
                  className="cursor-pointer rounded-full border border-white/20 px-5 py-2 font-mono text-sm text-white/85 transition-colors hover:text-white"
                  onClick={() => setRankOpen(true)}
                >
                  🏆 랭킹
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
