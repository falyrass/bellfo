(function($) {
  'use strict';
  // ----------------------------
  // Constantes et paramètres
  // ----------------------------
  const ROWS = 11;
  const COLS = 8; // 8 colonnes pour toutes les lignes
  const PREP_SECONDS = 45;
  const GAME_SECONDS = 60;

  // Etat du jeu
  const GameState = Object.freeze({
    Idle: 'idle',
    Preparing: 'preparing',
    Playing: 'playing',
    Ended: 'ended'
  });

  // Socket.IO
  const socket = window.io ? window.io() : null;
  let myId = null;
  let myName = null;
  let canPlay = false;

  // Classe Point pour lier logique et DOM
  class Point {
    constructor(value, row, col, $el) {
      this.value = value;
      this.row = row;
      this.col = col;
      this.$el = $el;
      this.id = `${row}-${col}`;
    }
  }

  // ----------------------------
  // Variables UI
  // ----------------------------
  let state = GameState.Idle;
  let grid = []; // grid[row][col] = Point | null
  let playerPath = []; // Points
  let playerScore = 0;
  let prepRemaining = PREP_SECONDS;
  let gameRemaining = GAME_SECONDS;
  let soundCtx = null;
  let domGridReady = false;
  let lastGridSig = null;

  // ----------------------------
  // Utilitaires
  // ----------------------------
  function range(n) { return Array.from({ length: n }, (_, i) => i); }
  function formatTime(s) { const m = Math.floor(s/60).toString().padStart(2,'0'); const r = (s%60).toString().padStart(2,'0'); return `${m}:${r}`; }
  function isTopRow(row) { return row === 0; }
  function isBottomRow(row) { return row === ROWS - 1; }
  function beep(freq = 420, dur = 0.07, gain = 0.02) {
    try {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      if (!soundCtx) soundCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = soundCtx; const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq; g.gain.value = gain; o.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime; o.start(now); o.stop(now + dur);
    } catch(_) {}
  }
  function setStatus(msg, cls = '') { const $s = $('#status'); $s.removeClass('warn error ok'); if (cls) $s.addClass(cls); $s.text(msg || ''); }
  function resetTimersUI() { $('#prep-timer').text(formatTime(prepRemaining)); $('#game-timer').text(formatTime(gameRemaining)); }
  function updateTimersUI() { $('#prep-timer').text(formatTime(prepRemaining)); $('#game-timer').text(formatTime(gameRemaining)); }
  function updateScoreUI() { $('#score').text(playerScore); }
  function updateOptimalScoreUI(v) { $('#optimal-score').text(v == null ? '—' : v); }
  function lockBoardInteractions(lock) { const $b = $('#board'); $b.toggleClass('locked', !!lock); $b.find('.node').toggleClass('locked', !!lock); }
  function showNumbers(show) { $('#board').toggleClass('hidden-values', !show); $('#board .node').toggleClass('hidden-number', !show); }
  function clearPathHighlights() { $('#board .node').removeClass('path active optimal'); }

  // ----------------------------
  // Génération du terrain (DOM)
  // ----------------------------
  function generateGrid() {
    grid = []; playerPath = []; playerScore = 0; updateScoreUI(); updateOptimalScoreUI(null);
    const $board = $('#board'); $board.empty();
    for (let r = 0; r < ROWS; r++) {
      const $row = $('<div>').addClass('row');
      if (isTopRow(r)) $row.addClass('top'); else if (isBottomRow(r)) $row.addClass('bottom'); else $row.addClass('mid');
      const rowCells = [];
      for (let c = 0; c < COLS; c++) {
        const $cell = $('<div>').addClass('cell');
        $row.append($cell); rowCells.push($cell);
      }
      $('#board').append($row);
      grid[r] = Array(COLS).fill(null);
      const colsForRow = range(COLS);
      for (const c of colsForRow) {
        const $node = $('<button type="button" aria-label="Point">').addClass('node hidden-number');
        $node.attr('data-row', r).attr('data-col', c);
        rowCells[c].append($node);
        grid[r][c] = new Point(0, r, c, $node);
      }
    }
  }

  function assignValuesFromServer(serverGrid) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c]; if (!p) continue;
        const v = serverGrid[r][c]; p.value = v; p.$el.text(String(v));
      }
    }
  }

  // ----------------------------
  // Interactions
  // ----------------------------
  function onNodeClick(e) {
    if (state !== GameState.Playing) return;
    if (!canPlay) return;
    const $btn = $(e.currentTarget); if ($btn.hasClass('locked')) return;
    const r = parseInt($btn.attr('data-row'), 10); const c = parseInt($btn.attr('data-col'), 10);
    socket.emit('move', { r, c }, (res) => {
      if (!res || !res.ok) { invalidClickFeedback($btn); return; }
      const serverPath = res.path || [];
      applyServerPathToClient(serverPath);
      playerScore = res.score ?? playerScore; updateScoreUI();
    });
  }

  function invalidClickFeedback($el) { $el.addClass('invalid'); beep(220, 0.06, 0.03); setTimeout(() => $el.removeClass('invalid'), 220); }

  function applyServerPathToClient(serverPath) {
  // Do not remove .optimal here so optimal remains once displayed
  $('#board .node').removeClass('path active');
    const local = [];
    for (const step of serverPath) {
      const node = grid[step.r][step.c];
      if (node) { node.$el.addClass('path active'); local.push(node); }
    }
    playerPath = local; if (playerPath.length) beep(660, 0.05, 0.02);
  }

  // ----------------------------
  // Multijoueur (Socket)
  // ----------------------------
  function renderPlayers(list) {
    const $ul = $('#players-list').empty();
    list.forEach(p => {
      const li = $('<li>');
      const left = $('<div class="left">').append($('<span class="name">').text(p.name));
      const right = $('<div class="right">');
      if (p.status === 'finished') right.append($('<span class="score">').text(p.score));
      else right.append($('<span class="status">').text(p.status));
      li.append(left).append(right);
      $ul.append(li);
    });
  }

  function endGameClient(optimal) {
    state = GameState.Ended;
    lockBoardInteractions(true);
    if (optimal && optimal.bestPath) {
      updateOptimalScoreUI(optimal.bestScore);
      // Keep both the player's path and overlay optimal without clearing
      optimal.bestPath.forEach(step => {
        const node = grid[step.r][step.c]; if (node) node.$el.addClass('optimal');
      });
    }
  }

  // ----------------------------
  // Démarrage / Réinitialisation (pilotés serveur)
  // ----------------------------
  function resetViewToIdle() {
    state = GameState.Idle; playerScore = 0; updateScoreUI();
  generateGrid(); showNumbers(false); lockBoardInteractions(true);
    prepRemaining = PREP_SECONDS; gameRemaining = GAME_SECONDS; resetTimersUI();
    setStatus('Cliquez sur Commencer pour lancer une nouvelle partie.');
    updateOptimalScoreUI(null);
  domGridReady = false; lastGridSig = null;
  }

  function startGame() { socket && socket.emit('start'); }

  // ----------------------------
  // Wiring DOM
  // ----------------------------
  function bindEvents() {
    $('#board').on('click', '.node', onNodeClick);
    $('#start-btn').on('click', () => { if (state === GameState.Idle) startGame(); });
    $('#reset-btn').on('click', () => { if (state === GameState.Idle) socket && socket.emit('reset'); });
    $('#pseudo-form').on('submit', (e) => {
      e.preventDefault(); const v = String($('#pseudo-input').val() || '').trim(); if (!v) return;
      socket.emit('join', v, (res) => { if (res && res.ok) { myName = res.name; $('#pseudo-modal').addClass('hidden'); } });
    });
  }

  $(function() {
    bindEvents();
    resetViewToIdle();
    const $legend = $('<div class="legend">')
      .append('<span class="badge"><span class="dot player"></span> Votre chemin</span>')
      .append('<span class="badge"><span class="dot opt"></span> Chemin optimal</span>');
    $('.board').after($legend);
    $('#pseudo-modal').removeClass('hidden');

    if (socket) {
      socket.on('connect', () => { myId = socket.id; });
      socket.on('state', (s) => {
        state = s.phase; prepRemaining = s.prepRemaining ?? PREP_SECONDS; gameRemaining = s.gameRemaining ?? GAME_SECONDS; updateTimersUI();
        if (s.grid) {
          // Build or update grid only if it changed (prevents wiping highlights each tick)
          const sig = Array.isArray(s.grid) ? s.grid.flat().join(',') : null;
          if (!domGridReady || lastGridSig !== sig) {
            generateGrid();
            assignValuesFromServer(s.grid);
            domGridReady = true;
            lastGridSig = sig;
          }
          showNumbers(state !== GameState.Idle);
          lockBoardInteractions(state !== GameState.Playing);
        } else {
          // No grid (idle). Reset view if previously built.
          if (domGridReady) {
            resetViewToIdle();
            domGridReady = false;
            lastGridSig = null;
          } else {
            showNumbers(false);
            lockBoardInteractions(true);
          }
        }
        if (state === GameState.Preparing) setStatus(`Observation: mémorisez les valeurs (${prepRemaining}s).`, 'warn');
        else if (state === GameState.Playing) setStatus('C’est parti ! Sélectionnez un point de la ligne 1.', 'ok');
        else if (state === GameState.Idle) setStatus('Cliquez sur Commencer pour lancer une nouvelle partie.');
      });
      socket.on('players', (list) => {
        renderPlayers(list);
        const me = list.find(p => p.id === myId); canPlay = !!(me && me.canPlay);
      });
      socket.on('end', (payload) => {
        const { optimal, finished, nonClasse } = payload || {};
        endGameClient(optimal);
        let txt = 'Fin de partie. Classement: ';
        if (finished && finished.length) txt += finished.map(e => `${e.rank}. ${e.name} (${e.score})`).join('  |  ');
        else txt += '—';
        if (nonClasse && nonClasse.length) txt += `  —  Non classés: ${nonClasse.map(e => e.name).join(', ')}`;
        setStatus(txt);
      });
    }
  });

})(jQuery);
