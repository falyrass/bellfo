/*
  Chemin minimal — Graphe pondéré (Single Player)
  HTML/CSS/JS/jQuery (slim)
  - 11 lignes, 8 colonnes
  - 45s observation, 60s de jeu
  - Déplacement: N -> N+1, même colonne ou adjacente
  - Score: premier = valeur; puis +|diff|
*/

(function($) {
  'use strict';

  const ROWS = 11;
  const COLS = 8;
  const PREP_SECONDS = 45;
  const GAME_SECONDS = 60;

  const GameState = Object.freeze({ Idle: 'idle', Preparing: 'preparing', Playing: 'playing', Ended: 'ended' });

  class Point { constructor(value,row,col,$el){ this.value=value; this.row=row; this.col=col; this.$el=$el; this.id=`${row}-${col}`; } }

  let state = GameState.Idle;
  let grid = [];
  let usedValues = [];
  let playerPath = [];
  let playerScore = 0;
  let prepTimer = null, gameTimer = null;
  let prepRemaining = PREP_SECONDS, gameRemaining = GAME_SECONDS;
  let soundCtx = null;
  // Audio préchargé
  const CLICK_SOUND_URL = 'assets/sounds/pop-cartoon-328167.mp3';
  let clickAudio = null; // instance principale

  function preloadClickSound(){
    try {
      clickAudio = new Audio(CLICK_SOUND_URL);
      clickAudio.preload = 'auto';
      clickAudio.load();
    } catch(_) { /* ignore */ }
  }

  function playClickSound(){
    if(!clickAudio){ return; }
    try {
      // Pour permettre plusieurs lectures rapprochées sans attendre la fin,
      // on clone le node (sinon currentTime=0 peut être bloqué si en cours de lecture)
      const node = clickAudio.cloneNode();
      node.play().catch(()=>{});
    } catch(_) { /* ignore */ }
  }

  // Met à jour l'état des boutons (Start / Reset)
  function refreshButtons(){
    const disabled = (state === GameState.Preparing || state === GameState.Playing);
    $('#start-btn').prop('disabled', disabled);
    $('#reset-btn').prop('disabled', disabled);
  }

  const range = (n)=>Array.from({length:n},(_,i)=>i);
  const shuffle = (a)=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const formatTime = (s)=>{ const m=String(Math.floor(s/60)).padStart(2,'0'); const r=String(s%60).padStart(2,'0'); return `${m}:${r}`; };
  const isTopRow = (r)=> r===0;
  const isBottomRow = (r)=> r===ROWS-1;
  const canMove = (from,to)=>{ if(!from||!to) return false; if(to.row!==from.row+1) return false; return Math.abs(to.col-from.col)<=1; };
  function beep(freq=420,dur=0.07,gain=0.02){ try{ if(!window.AudioContext&&!window.webkitAudioContext) return; if(!soundCtx) soundCtx=new (window.AudioContext||window.webkitAudioContext)(); const ctx=soundCtx,o=ctx.createOscillator(),g=ctx.createGain(); o.type='sine'; o.frequency.value=freq; g.gain.value=gain; o.connect(g); g.connect(ctx.destination); const now=ctx.currentTime; o.start(now); o.stop(now+dur);}catch(_){} }
  function setStatus(msg,cls=''){ const $s=$('#status'); $s.removeClass('warn error ok'); if(cls) $s.addClass(cls); $s.text(msg||''); }
  function resetTimersUI(){ $('#prep-timer').text(formatTime(PREP_SECONDS)); $('#game-timer').text(formatTime(GAME_SECONDS)); }
  function updateTimersUI(){ $('#prep-timer').text(formatTime(prepRemaining)); $('#game-timer').text(formatTime(gameRemaining)); }
  function updateScoreUI(){ $('#score').text(playerScore); }
  function updateOptimalScoreUI(v){ $('#optimal-score').text(v==null?'—':v); }
  function lockBoardInteractions(lock){ const $b=$('#board'); $b.toggleClass('locked',!!lock); $b.find('.node').toggleClass('locked',!!lock); }
  function showNumbers(show){ $('#board').toggleClass('hidden-values',!show); $('#board .node').toggleClass('hidden-number',!show); }
  function clearPathHighlights(){ $('#board .node').removeClass('path optimal active'); }

  function generateGrid(){
    grid=[]; playerPath=[]; playerScore=0; updateScoreUI(); updateOptimalScoreUI(null);
    const $board=$('#board'); $board.empty();
    for(let r=0;r<ROWS;r++){
      const $row=$('<div>').addClass('row'); if(isTopRow(r)) $row.addClass('top'); else if(isBottomRow(r)) $row.addClass('bottom'); else $row.addClass('mid');
      const rowCells=[]; for(let c=0;c<COLS;c++){ const $cell=$('<div>').addClass('cell'); $row.append($cell); rowCells.push($cell); }
      $board.append($row); grid[r]=Array(COLS).fill(null);
      for(const c of range(COLS)){
        const $node=$('<button type="button" aria-label="Point">').addClass('node hidden-number').attr('data-row',r).attr('data-col',c);
        rowCells[c].append($node); grid[r][c]=new Point(0,r,c,$node);
      }
    }
  }

  function assignValues(){ const total=ROWS*COLS; usedValues=shuffle(range(total).map(i=>i+1)); let k=0; for(let r=0;r<ROWS;r++){ for(let c=0;c<COLS;c++){ const p=grid[r][c]; const v=usedValues[k++]; p.value=v; p.$el.text(String(v)); } } }

  function clearAllTimers(){ if(prepTimer){clearInterval(prepTimer);prepTimer=null;} if(gameTimer){clearInterval(gameTimer);gameTimer=null;} }
  function startPreparationPhase(){
    state=GameState.Preparing;
    setStatus(`Observation: mémorisez les valeurs (${PREP_SECONDS} s).`,'warn');
    showNumbers(true);
    lockBoardInteractions(true);
    prepRemaining=PREP_SECONDS; gameRemaining=GAME_SECONDS; updateTimersUI();
    refreshButtons();
    prepTimer=setInterval(()=>{ prepRemaining--; updateTimersUI(); if(prepRemaining<=0){ clearInterval(prepTimer); prepTimer=null; startPlayingPhase(); } },1000);
  }
  function startPlayingPhase(){
    state=GameState.Playing;
    setStatus('C’est parti ! Sélectionnez un point de la ligne 1.','ok');
    showNumbers(true);
    lockBoardInteractions(false);
    gameRemaining=GAME_SECONDS; updateTimersUI();
    refreshButtons();
    gameTimer=setInterval(()=>{ gameRemaining--; updateTimersUI(); if(gameRemaining<=0){ clearInterval(gameTimer); gameTimer=null; endGame(false,'Temps écoulé.'); } },1000);
  }
  function endGame(reached,msg){
    if(state===GameState.Ended) return;
    state=GameState.Ended;
    clearAllTimers();
    lockBoardInteractions(true);
    const {bestPath,bestScore}=computeOptimalPath();
    updateOptimalScoreUI(bestScore);
    $('#board .node').removeClass('active');
    for(const p of playerPath) p.$el.addClass('path');
    for(const p of bestPath) p.$el.addClass('optimal');
    if(reached) setStatus(`${msg||'Arrivée atteinte !'} Votre score: ${playerScore}. Score optimal: ${bestScore}.`);
    else setStatus(`${msg||'Partie terminée.'} Votre score: ${playerScore}. Score optimal: ${bestScore}.`,'warn');
    refreshButtons(); // Réactiver les boutons en fin de partie
  }

  function onNodeClick(e){ if(state!==GameState.Playing) return; const $btn=$(e.currentTarget); if($btn.hasClass('locked')) return; const r=parseInt($btn.attr('data-row'),10); const c=parseInt($btn.attr('data-col'),10); const p=grid[r][c]; if(!p) return; if(playerPath.length===0){ if(!isTopRow(r)){ invalidClickFeedback($btn); return; } addToPath(p); return; } const last=playerPath[playerPath.length-1]; if(!canMove(last,p)){ invalidClickFeedback($btn); return; } addToPath(p); if(isBottomRow(p.row)) endGame(true,'Bravo, vous avez atteint la ligne 11.'); }
  function invalidClickFeedback($el){ $el.addClass('invalid'); beep(220,0.06,0.03); setTimeout(()=> $el.removeClass('invalid'),220); }
  function addToPath(p){
    p.$el.addClass('active');
    if(playerPath.length===0){
      // Premier point: pas de valeur ajoutée au score
      playerPath.push(p);
      updateScoreUI();
      p.$el.addClass('path');
    } else {
      const last=playerPath[playerPath.length-1];
      const delta=Math.abs(p.value-last.value);
      playerScore+=delta;
      playerPath.push(p);
      updateScoreUI();
      p.$el.addClass('path');
      // Animation visuelle du delta de score
      try {
        const off = p.$el.offset();
        const $board = $('#board');
        const boardOff = $board.offset();
        if(off && boardOff){
          const x = off.left - boardOff.left + p.$el.outerWidth()/2;
          const y = off.top - boardOff.top;
          const $fx = $('<div class="score-float">').text('+'+delta);
          $fx.css({ left: x + 'px', top: y + 'px' });
          $board.append($fx);
          setTimeout(()=> $fx.remove(), 950);
        }
      } catch(_) { /* ignore */ }
    }
  // Son joué pour chaque point (y compris le premier) depuis le cache
  playClickSound();
  }

  function computeOptimalPath(){
    const dp=Array.from({length:ROWS},()=>Array(COLS).fill(null));
    // Base: le premier point ne coûte rien (score basé uniquement sur les différences)
    for(let c=0;c<COLS;c++) dp[0][c] = { cost: 0, from: null };
    for(let r=1;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const p=grid[r][c]; let best=null;
        for(let dc=-1;dc<=1;dc++){
          const pc=c+dc; if(pc<0||pc>=COLS) continue;
          const prev=grid[r-1][pc]; const prevDp=dp[r-1][pc]; if(!prev||!prevDp) continue;
          const cost=prevDp.cost + Math.abs(p.value - prev.value);
          if(best==null || cost<best.cost) best={ cost, from:{ r:r-1, c:pc } };
        }
        dp[r][c]=best;
      }
    }
    let bestEnd=null,bestEndRC=null;
    for(let c=0;c<COLS;c++){ const cell=dp[ROWS-1][c]; if(!cell) continue; if(bestEnd==null||cell.cost<bestEnd){ bestEnd=cell.cost; bestEndRC={r:ROWS-1,c}; } }
    const bestPath=[];
    if(bestEndRC){ let cur=bestEndRC; while(cur){ const p=grid[cur.r][cur.c]; bestPath.push(p); const f=dp[cur.r][cur.c].from; cur=f?{r:f.r,c:f.c}:null; } bestPath.reverse(); }
    return {bestPath,bestScore:bestEnd};
  }

  function resetGame(){
    clearAllTimers();
    state=GameState.Idle;
    generateGrid(); assignValues(); resetTimersUI();
    setStatus('Cliquez sur Commencer pour lancer une nouvelle partie.');
    showNumbers(false); lockBoardInteractions(true);
    refreshButtons();
  }
  function startGame(){ if(state===GameState.Preparing||state===GameState.Playing) return; clearPathHighlights(); startPreparationPhase(); }

  function bindEvents(){ $('#board').on('click','.node',onNodeClick); $('#start-btn').on('click',startGame); $('#reset-btn').on('click',()=> resetGame()); }

  $(function(){
    preloadClickSound();
    bindEvents();
    resetGame();
    const $legend=$('<div class="legend">')
      .append('<span class="badge"><span class="dot player"></span> Votre chemin</span>')
      .append('<span class="badge"><span class="dot opt"></span> Chemin optimal</span>');
    $('.board').after($legend);
    refreshButtons();
  });

})(jQuery);
