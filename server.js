// Multiplayer server for Chemin minimal — Graphe pondéré
// Express + Socket.IO authoritative game state

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve static client
const PUBLIC_DIR = path.join(__dirname);
app.use(express.static(PUBLIC_DIR));

// Game constants
const ROWS = 11;
const COLS = 8;
const PREP_SECONDS = 45;
const GAME_SECONDS = 60;

// Utilities
function range(n) { return Array.from({ length: n }, (_, i) => i); }
function shuffle(arr) { const a = arr.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }

function makeGrid() {
  // values 1..ROWS*COLS shuffled across ROWSxCOLS
  const vals = shuffle(range(ROWS * COLS).map(i => i + 1));
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let k = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c] = vals[k++];
    }
  }
  return grid;
}

function canMove(path, to) {
  if (path.length === 0) return to.r === 0; // first move must be top row
  const last = path[path.length - 1];
  if (to.r !== last.r + 1) return false;
  const dc = Math.abs(to.c - last.c);
  return dc <= 1;
}

function computeScore(grid, path) {
  if (path.length === 0) return 0;
  let score = grid[path[0].r][path[0].c];
  for (let i = 1; i < path.length; i++) {
    const a = grid[path[i-1].r][path[i-1].c];
    const b = grid[path[i].r][path[i].c];
    score += Math.abs(b - a);
  }
  return score;
}

function computeOptimalPath(grid) {
  // DP layer-by-layer; tie-break: first found in iteration order
  const dp = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let c = 0; c < COLS; c++) {
    dp[0][c] = { cost: grid[0][c], from: null };
  }
  for (let r = 1; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let best = null;
      for (let dc = -1; dc <= 1; dc++) {
        const pc = c + dc;
        if (pc < 0 || pc >= COLS) continue;
        const prev = dp[r-1][pc];
        if (!prev) continue;
        const cost = prev.cost + Math.abs(grid[r][c] - grid[r-1][pc]);
        if (best == null || cost < best.cost) {
          best = { cost, from: { r: r-1, c: pc } };
        }
      }
      dp[r][c] = best;
    }
  }
  let bestEnd = null, bestEndRC = null;
  for (let c = 0; c < COLS; c++) {
    const cell = dp[ROWS-1][c];
    if (!cell) continue;
    if (bestEnd == null || cell.cost < bestEnd) {
      bestEnd = cell.cost; bestEndRC = { r: ROWS-1, c };
    }
  }
  const bestPath = [];
  if (bestEndRC) {
    let cur = bestEndRC;
    while (cur) {
      bestPath.push({ r: cur.r, c: cur.c });
      const f = dp[cur.r][cur.c].from;
      cur = f ? { r: f.r, c: f.c } : null;
    }
    bestPath.reverse();
  }
  return { bestPath, bestScore: bestEnd };
}

// Global state
const Phase = { Idle: 'idle', Preparing: 'preparing', Playing: 'playing', Ended: 'ended' };
let phase = Phase.Idle;
let grid = null; // array[ROWS][COLS]
let prepRemaining = PREP_SECONDS;
let gameRemaining = GAME_SECONDS;
let prepInterval = null;
let gameInterval = null;
let participants = new Set(); // socket ids allowed to play in current game
const players = new Map(); // socket.id -> { id, name, canPlay, status, path, score, finishedAt }
let optimal = null;

function broadcastState() {
  io.emit('state', {
    phase,
    rows: ROWS,
    cols: COLS,
    grid, // null in idle
    prepRemaining,
    gameRemaining,
  });
  broadcastPlayers();
}

function broadcastPlayers() {
  const list = Array.from(players.values()).map(p => ({
    id: p.id,
    name: p.name,
    status: p.status, // 'waiting' | 'playing' | 'finished' | 'spectator'
    score: p.score,
    finishedAt: p.finishedAt || null,
    canPlay: !!p.canPlay,
  }));
  io.emit('players', list);
}

function startPreparation() {
  if (phase !== Phase.Idle) return;
  grid = makeGrid();
  optimal = null;
  prepRemaining = PREP_SECONDS;
  gameRemaining = GAME_SECONDS;
  phase = Phase.Preparing;
  // lock current connected as participants
  participants = new Set(Array.from(players.keys()));
  for (const [id, p] of players) {
    p.path = [];
    p.score = 0;
    p.finishedAt = null;
    if (participants.has(id)) {
      p.canPlay = true; p.status = 'waiting';
    } else {
      p.canPlay = false; p.status = 'spectator';
    }
  }
  broadcastState();
  if (prepInterval) clearInterval(prepInterval);
  prepInterval = setInterval(() => {
    prepRemaining--;
    broadcastState();
    if (prepRemaining <= 0) {
      clearInterval(prepInterval); prepInterval = null;
      startPlaying();
    }
  }, 1000);
}

function startPlaying() {
  phase = Phase.Playing;
  gameRemaining = GAME_SECONDS;
  for (const [id, p] of players) {
    if (participants.has(id)) {
      p.status = 'playing';
    } else {
      p.status = 'spectator';
    }
  }
  broadcastState();
  if (gameInterval) clearInterval(gameInterval);
  gameInterval = setInterval(() => {
    gameRemaining--;
    broadcastState();
    if (gameRemaining <= 0) {
      clearInterval(gameInterval); gameInterval = null;
      endGame();
    }
  }, 1000);
}

function endGame() {
  phase = Phase.Ended;
  // compute optimal
  optimal = computeOptimalPath(grid);
  // ranking
  const finished = Array.from(players.values())
    .filter(p => p.canPlay && p.status === 'finished')
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score; // asc
      return (a.finishedAt || 0) - (b.finishedAt || 0); // first found
    })
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score }));
  const nonClasse = Array.from(players.values())
    .filter(p => p.canPlay && p.status !== 'finished')
    .map(p => ({ id: p.id, name: p.name }));

  io.emit('end', { optimal, finished, nonClasse });
  broadcastState();
}

function resetToIdle() {
  if (phase !== Phase.Idle) return;
  grid = null; optimal = null; participants.clear();
  prepRemaining = PREP_SECONDS; gameRemaining = GAME_SECONDS;
  for (const [, p] of players) {
    p.path = []; p.score = 0; p.finishedAt = null; p.status = 'spectator'; p.canPlay = false;
  }
  broadcastState();
}

function ensureUniqueName(name) {
  const existing = new Set(Array.from(players.values()).map(p => p.name));
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name}#${i}`)) i++;
  return `${name}#${i}`;
}

io.on('connection', (socket) => {
  players.set(socket.id, { id: socket.id, name: `Joueur-${socket.id.slice(0,4)}`, canPlay: false, status: 'spectator', path: [], score: 0, finishedAt: null });
  broadcastPlayers();
  // send initial state
  socket.emit('state', { phase, rows: ROWS, cols: COLS, grid, prepRemaining, gameRemaining });

  socket.on('join', (name, ack) => {
    let n = (name || '').trim();
    if (!n) n = `Joueur-${socket.id.slice(0,4)}`;
    n = ensureUniqueName(n);
    const p = players.get(socket.id);
    if (p) { p.name = n; }
    if (phase === Phase.Idle) {
      p.status = 'spectator'; p.canPlay = false;
    } else {
      // join mid-game as spectator
      p.status = 'spectator'; p.canPlay = false;
    }
    broadcastPlayers();
    ack && ack({ ok: true, name: n });
  });

  socket.on('start', () => {
    if (phase !== Phase.Idle) return;
    startPreparation();
  });

  socket.on('reset', () => {
    if (phase !== Phase.Idle) return;
    resetToIdle();
  });

  socket.on('move', (to, ack) => {
    const p = players.get(socket.id);
    if (!p || phase !== Phase.Playing || !p.canPlay || p.status === 'finished') {
      return ack && ack({ ok: false });
    }
    const { r, c } = to || {};
    if (typeof r !== 'number' || typeof c !== 'number' || r < 0 || r >= ROWS || c < 0 || c >= COLS) {
      return ack && ack({ ok: false });
    }
    if (!canMove(p.path, { r, c })) {
      return ack && ack({ ok: false });
    }
    // Accept move
    p.path.push({ r, c });
    p.score = computeScore(grid, p.path);
    if (r === ROWS - 1) {
      p.status = 'finished'; p.finishedAt = Date.now();
    }
    broadcastPlayers();
    ack && ack({ ok: true, score: p.score, path: p.path });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    participants.delete(socket.id);
    broadcastPlayers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
