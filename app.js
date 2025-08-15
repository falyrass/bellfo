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
  const PREP_SECONDS = 1;
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

  // Bouton principal unique (Nouvelle partie / Commencer)
  let buttonPhase = 'new';
  function updateMainButton(){
    const $b = $('#main-btn');
    if(!$b.length) return;
    if(state === GameState.Preparing || state === GameState.Playing){
      $b.hide();
    } else {
      $b.show();
      $b.text(buttonPhase === 'new' ? 'Nouvelle partie' : 'Commencer');
    }
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
  updateMainButton();
  // Nettoie overlay précédent s'il existe (pas d'affichage géant avant <=5s)
  $('#board .prep-overlay').remove();
    prepTimer=setInterval(()=>{ 
      prepRemaining--; 
      updateTimersUI();
      if(prepRemaining<=5 && prepRemaining>0){ showPrepCountdown(prepRemaining); }
      if(prepRemaining<=0){ 
        clearInterval(prepTimer); prepTimer=null; 
        removePrepCountdown();
        startPlayingPhase(); 
      }
    },1000);
  }
  function startPlayingPhase(){
    state=GameState.Playing;
    setStatus('C’est parti ! Sélectionnez un point de la ligne 1.','ok');
    showNumbers(true);
    lockBoardInteractions(false);
    gameRemaining=GAME_SECONDS; updateTimersUI();
  updateMainButton();
  // Affiche "GO" juste après la phase de préparation
  showGoMessage();
  updateClickableHighlights();
    gameTimer=setInterval(()=>{ 
      gameRemaining--; 
      updateTimersUI(); 
      if(gameRemaining<=5 && gameRemaining>0){ showGameCountdown(gameRemaining); }
      if(gameRemaining<=0){ 
        clearInterval(gameTimer); gameTimer=null; 
        removeGameCountdown();
        endGame(false,'Temps écoulé.'); 
      } 
    },1000);
  }
  function endGame(reached,msg){
    if(state===GameState.Ended) return;
    state=GameState.Ended;
    clearAllTimers();
    lockBoardInteractions(true);
  clearClickable();
    // Si le joueur n'a pas atteint la dernière ligne, score forcé à 0 avant toute évaluation
    if(!reached){
      playerScore = 0;
      updateScoreUI();
    }
    const {bestPath,bestScore}=computeOptimalPath();
    updateOptimalScoreUI(bestScore);
    $('#board .node').removeClass('active');
    for(const p of playerPath) p.$el.addClass('path');
    for(const p of bestPath) p.$el.addClass('optimal');
    if(reached) setStatus(`${msg||'Arrivée atteinte !'} Votre score: ${playerScore}. Score optimal: ${bestScore}.`);
    else setStatus(`${msg||'Partie terminée.'} Votre score: ${playerScore}. Score optimal: ${bestScore}.`,'warn');
  buttonPhase = 'new';
  updateMainButton();
  // Evaluation étoiles (7s)
  try { createStarEvaluation(playerScore, bestScore); } catch(_) { /* ignore */ }
  }

  function onNodeClick(e){ if(state!==GameState.Playing) return; const $btn=$(e.currentTarget); if($btn.hasClass('locked')) return; const r=parseInt($btn.attr('data-row'),10); const c=parseInt($btn.attr('data-col'),10); const p=grid[r][c]; if(!p) return; if(playerPath.length===0){ if(!isTopRow(r)){ invalidClickFeedback($btn); return; } addToPath(p); return; } const last=playerPath[playerPath.length-1]; if(!canMove(last,p)){ invalidClickFeedback($btn); return; } addToPath(p); if(isBottomRow(p.row)) endGame(true,'Bravo.'); }
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
  if(state===GameState.Playing && !isBottomRow(p.row)) updateClickableHighlights();
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
  clearClickable();
  removePrepCountdown();
  updateMainButton();
  }

  // Crée et affiche l'overlay d'évaluation avec étoiles selon l'écart de score
  function createStarEvaluation(score, optimal){
    if(optimal == null) return; // sécurité
  // Différence absolue entre le score joueur et l'optimal
  const diff = Math.abs(score - optimal);
    let stars=0;
    if(diff===0) stars=3; else if(diff>=1 && diff<=30) stars=2; else if(diff>=31 && diff<=60) stars=1; else stars=0;
    // Construire overlay
    const $overlay = $('<div class="star-eval-overlay" aria-hidden="true">');
    const $box = $('<div class="star-eval-box">');
    const $starsWrap = $('<div class="star-eval-stars" role="img" aria-label="Évaluation: '+stars+' étoile(s)">');
    const starSVG = (filled, delay)=>`<svg class="star ${filled?'filled glow':''}" viewBox="0 0 64 64" style="animation-delay:${delay}ms"><polygon points="32 4 40.9 22.6 61 25.3 46 39.4 49.8 59.5 32 49.4 14.2 59.5 18 39.4 3 25.3 23.1 22.6 32 4"/></svg>`;
    for(let i=0;i<3;i++){ $starsWrap.append(starSVG(i<stars, i*260)); }
    const titleMap={0:'Aucun éclat',1:'Peut mieux faire',2:'Très bien',3:'Parfait !'};
    const $title=$('<h2 class="star-eval-title">').text(titleMap[stars]);
  const $sub=$('<p class="star-eval-sub">').text(stars===3 ? 'Chemin optimal atteint.' : '');
    const $diff=$('<p class="star-eval-diff">').text('Score: '+score+' | Optimal: '+optimal);
    $box.append($starsWrap,$title,$sub,$diff);
    $overlay.append($box);
    $('body').append($overlay);
  // Retrait après 7s
  setTimeout(()=>{ $overlay.remove(); }, 7000);
  }

  // === Overlays de préparation ===
  function showPrepCountdown(n){
    removePrepCountdown();
    if(n<=0) return;
    const $ov = $('<div class="prep-overlay" aria-hidden="true">').append('<span>'+n+'</span>');
    $('#board').append($ov);
  }
  function removePrepCountdown(){ $('#board .prep-overlay').remove(); }
  function showGoMessage(){
    removePrepCountdown();
    const $ov = $('<div class="prep-overlay go" aria-hidden="true">').append('<span>GO</span>');
    $('#board').append($ov);
  setTimeout(()=>{ $ov.remove(); },1500);
  }

  // ====== Mise en surbrillance des points cliquables ======
  function clearClickable(){ $('#board .node.clickable').removeClass('clickable'); }
  function updateClickableHighlights(){
    clearClickable();
    if(state!==GameState.Playing) return;
    // Si aucun point choisi encore: tous les points de la première ligne
    if(playerPath.length===0){
      for(let c=0;c<COLS;c++){ grid[0][c].$el.addClass('clickable'); }
      return;
    }
    const last = playerPath[playerPath.length-1];
    if(isBottomRow(last.row)) return; // terminé
    const nextRow = last.row + 1;
    for(let dc=-1; dc<=1; dc++){
      const nc = last.col + dc; if(nc<0||nc>=COLS) continue;
      const point = grid[nextRow][nc]; if(point) point.$el.addClass('clickable');
    }
  }

  // === Compte à rebours final de la phase de jeu (5 dernières secondes) ===
  function showGameCountdown(n){
    removeGameCountdown();
    if(n<=0) return;
    // Réutilise le style existant .prep-overlay
    const $ov = $('<div class="prep-overlay game" aria-hidden="true">').append('<span>'+n+'</span>');
    $('#board').append($ov);
  }
  function removeGameCountdown(){ $('#board .prep-overlay.game').remove(); }

  function bindEvents(){
    $('#board').on('click','.node',onNodeClick);
    $(document).on('click','#main-btn',onMainButtonClick);
  }

  function onMainButtonClick(){
    if(state !== GameState.Idle) return;
    if(buttonPhase === 'new'){
      // Génère une nouvelle grille et passe à phase Commencer
      resetGame();
      buttonPhase = 'start';
      updateMainButton();
    } else if(buttonPhase === 'start') {
      startPreparationPhase();
    }
  }

  $(function(){
    preloadClickSound();
    bindEvents();
    resetGame();
    initRulesModal();
  // Bouton unique: d'abord "Nouvelle partie" -> clique régénère + passe à "Commencer" -> lance observation
    const $legend=$('<div class="legend">')
      .append('<span class="badge"><span class="dot player"></span> Votre chemin</span>')
      .append('<span class="badge"><span class="dot opt"></span> Chemin optimal</span>');
    $('.board').after($legend);
  updateMainButton();
  });

  // ====== Règles / Modale ======
  function initRulesModal(){
    const KEY='hideRules';
    const hide = localStorage.getItem(KEY)==='1';
    const $modal = $('#rules-modal');
    const $ok = $('#rules-ok-btn');
    const $chk = $('#rules-hide-checkbox');
    $('#show-rules-btn').on('click',()=>{ showRules(); });
    $ok.on('click',()=>{ if($chk.is(':checked')) localStorage.setItem(KEY,'1'); hideRules(); });
    function showRules(){ $modal.removeClass('hidden'); }
    function hideRules(){ $modal.addClass('hidden'); }
    if(!hide) showRules();
  }

})(jQuery);
