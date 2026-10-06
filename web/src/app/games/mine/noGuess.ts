// 추측 없이(논리만으로) 풀 수 있는 지뢰찾기 판 생성기.
// 1) 첫 클릭 주변 3x3을 비우고 지뢰를 무작위 배치
// 2) 사람이 쓰는 수준의 추론(단일 칸·두 칸 비교·남은 지뢰 수)으로 풀어보고
// 3) 막히면 막힌 경계(frontier) 근처의 지뢰를 경계 밖으로 옮기거나 반대로 옮겨서 다시 풀어봄
// 시간 예산 안에 못 만들면 마지막 판을 그대로 씀(거의 안 일어남).

const UNKNOWN = 0;
const OPEN = 1;
const MINE = 2;

function neighborsOf(rows: number, cols: number): Int32Array[] {
  const list: Int32Array[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ns: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr,
            nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) ns.push(nr * cols + nc);
        }
      }
      list.push(Int32Array.from(ns));
    }
  }
  return list;
}

function countNumbers(mines: Uint8Array, nbrs: Int32Array[]): Int8Array {
  const nums = new Int8Array(mines.length);
  for (let i = 0; i < mines.length; i++) {
    if (mines[i]) {
      nums[i] = -1;
      continue;
    }
    let n = 0;
    for (const j of nbrs[i]) n += mines[j];
    nums[i] = n;
  }
  return nums;
}

/** 논리만으로 풀어본 뒤 최종 상태를 돌려줌. 다 열렸으면 solved = true */
function solve(nums: Int8Array, nbrs: Int32Array[], start: number, mineCount: number) {
  const n = nums.length;
  const state = new Uint8Array(n);
  let opened = 0;
  let knownMines = 0;
  const safeCells = n - mineCount;

  const open = (s: number) => {
    const stack = [s];
    while (stack.length) {
      const i = stack.pop()!;
      if (state[i] !== UNKNOWN) continue;
      state[i] = OPEN;
      opened++;
      if (nums[i] === 0) for (const j of nbrs[i]) if (state[j] === UNKNOWN) stack.push(j);
    }
  };
  const mark = (i: number) => {
    if (state[i] === UNKNOWN) {
      state[i] = MINE;
      knownMines++;
    }
  };

  open(start);

  while (opened < safeCells) {
    let progress = false;

    // 제약식: 열린 숫자 칸마다 { 미확정 이웃들, 그 중 지뢰 수 }
    const cons: { cells: number[]; need: number }[] = [];
    const consByCell: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      if (state[i] !== OPEN || nums[i] <= 0) continue;
      const cells: number[] = [];
      let need = nums[i];
      for (const j of nbrs[i]) {
        if (state[j] === UNKNOWN) cells.push(j);
        else if (state[j] === MINE) need--;
      }
      if (!cells.length) continue;
      cons.push({ cells, need });
    }

    // 단일 칸 규칙
    for (const { cells, need } of cons) {
      if (need === 0) {
        for (const j of cells) if (state[j] === UNKNOWN) (open(j), (progress = true));
      } else if (need === cells.length) {
        for (const j of cells) if (state[j] === UNKNOWN) (mark(j), (progress = true));
      }
    }
    if (progress) continue;

    // 두 제약 비교: A의 지뢰 - B의 지뢰 == |A\B| 이면 A\B는 전부 지뢰, B\A는 전부 안전
    cons.forEach((c, idx) => c.cells.forEach((cell) => consByCell[cell].push(idx)));
    outer: for (let a = 0; a < cons.length; a++) {
      const A = cons[a];
      const seen = new Set<number>();
      for (const cell of A.cells) {
        for (const b of consByCell[cell]) {
          if (b === a || seen.has(b)) continue;
          seen.add(b);
          const B = cons[b];
          const bSet = new Set(B.cells);
          const aOnly = A.cells.filter((x) => !bSet.has(x));
          if (A.need - B.need !== aOnly.length) continue;
          const aSet = new Set(A.cells);
          const bOnly = B.cells.filter((x) => !aSet.has(x));
          if (!aOnly.length && !bOnly.length) continue;
          for (const x of aOnly) mark(x);
          for (const x of bOnly) open(x);
          progress = true;
          break outer;
        }
      }
    }
    if (progress) continue;

    // 남은 지뢰 수
    const remaining = mineCount - knownMines;
    const unknowns: number[] = [];
    for (let i = 0; i < n; i++) if (state[i] === UNKNOWN) unknowns.push(i);
    if (remaining === 0) {
      unknowns.forEach(open);
      continue;
    }
    if (remaining === unknowns.length) {
      unknowns.forEach(mark);
      continue;
    }
    break; // 막힘 -> 추측 필요
  }

  return { solved: opened >= safeCells, state };
}

export function generateNoGuessBoard(
  safeR: number,
  safeC: number,
  rows: number,
  cols: number,
  mineCount: number,
  budgetMs = 1500
): { board: number[][]; noGuess: boolean } {
  const n = rows * cols;
  const nbrs = neighborsOf(rows, cols);
  const start = safeR * cols + safeC;
  const inSafeZone = (i: number) =>
    Math.abs(Math.floor(i / cols) - safeR) <= 1 && Math.abs((i % cols) - safeC) <= 1;
  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

  const randomMines = () => {
    const m = new Uint8Array(n);
    const pool: number[] = [];
    for (let i = 0; i < n; i++) if (!inSafeZone(i)) pool.push(i);
    for (let k = 0; k < mineCount; k++) {
      const j = k + Math.floor(Math.random() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      m[pool[k]] = 1;
    }
    return m;
  };

  const deadline = Date.now() + budgetMs;
  let mines = randomMines();
  let tweaks = 0;
  let nums = countNumbers(mines, nbrs);

  while (Date.now() < deadline) {
    const { solved, state } = solve(nums, nbrs, start, mineCount);
    if (solved) return { board: toGrid(nums, rows, cols), noGuess: true };

    // 막힌 경계: 열린 칸과 붙어 있는 미확정 칸 / 그 바깥: 아무 정보 없는 미확정 칸
    const frontier: number[] = [];
    const interior: number[] = [];
    for (let i = 0; i < n; i++) {
      if (state[i] !== UNKNOWN || inSafeZone(i)) continue;
      let touches = false;
      for (const j of nbrs[i]) if (state[j] === OPEN) touches = true;
      (touches ? frontier : interior).push(i);
    }
    const fMines = frontier.filter((i) => mines[i]);
    const fEmpty = frontier.filter((i) => !mines[i]);
    const iMines = interior.filter((i) => mines[i]);
    const iEmpty = interior.filter((i) => !mines[i]);

    const moves: (() => void)[] = [];
    if (fMines.length && iEmpty.length)
      moves.push(() => ((mines[pick(fMines)] = 0), (mines[pick(iEmpty)] = 1)));
    if (fEmpty.length && iMines.length)
      moves.push(() => ((mines[pick(iMines)] = 0), (mines[pick(fEmpty)] = 1)));

    if (!moves.length || ++tweaks > 400) {
      mines = randomMines();
      tweaks = 0;
    } else {
      pick(moves)();
    }
    nums = countNumbers(mines, nbrs);
  }

  return { board: toGrid(nums, rows, cols), noGuess: false };
}

function toGrid(nums: Int8Array, rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from(nums.subarray(r * cols, (r + 1) * cols))
  );
}
