import {PlaytestApi} from './api.js';
import {cpSlice, characterCount, chooseCard, handLayout} from './logic.js';
import {TablePresentation} from './table.js?v=story-sheet-2';
import {HandView} from './hand.js';
import {createCardFace} from './card-face.js?v=card-face-2';
import {SceneBoard,canTarget,sceneWindow} from './scene-board.js?v=element-v4';
const workshopCards = new Map();
const $ = id => document.getElementById(id);
// The production story route is used by the shipped table.  PlaytestApi keeps
// its legacy default for isolated unit tests and old browser clients.
const api = new PlaytestApi(undefined, undefined, '/v1/games/current/play');
let game = null, busy = false, online = false, chosenCard = null, chosenOpportunity = null, hoverCard = null, aiFillBusy = false;
let localTypeTakeover = null;
let draftKey = '', errorMessage = '';
let workStage = '';
let animateHand=false, discardTransfer=false;
let toastTimer = null;
const handView=new HandView($('hand'),createHandCard,updateHandCard);
const presentation = new TablePresentation(() => render());
const board = new SceneBoard({getGame:()=>game,selectCard:id=>{chosenCard=id;chosenOpportunity=null;hoverCard=id;updateHandLayout();},submit:send,refresh:renderPreview,onTypeTakeover:resolveTypeTakeover});
api.onView = (view,meta) => { accept(view,meta?.snapshot); online=true; render(); };
api.onStage = stage => { workStage=stage; render(); };
const names = {system:'故事开头', human:'你', 'ai-a':'艾琳', 'ai-b':'布莱恩', 'ai-c':'柯林'};
const categories = {character:'角色',thing:'物品',place:'地点',event:'事件',aspect:'特征'};
const symbols = {C01:'♞',T06:'⚿',P05:'⌂',E06:'➶',A23:'◇'};
function previousStoryLine(){
  const text=game?.history?.at(-1)?.text?.trim();
  if(game?.opening_pending || !text)return '很久很久以前，有一位冒牌勇者';
  const sentences=text.match(/[^。！？!?]+[。！？!?]?/gu)||[text];
  return (sentences.at(-1)||text).replace(/[。！？!?]+$/,'').trim()||'很久很久以前，有一位冒牌勇者';
}
function resultToast(result, view){
  if(!result)return '';
  const drawNote=result.interrupted_draw?' · 被打断者抽取1张故事牌':'';
  if(result.failed_submission || result.kind==='handoff')return `叙事权交给${names[view.narrator] || '下一位讲述者'}${drawNote}`;
  if(result.human_won)return `${view.transition_required?'接话成功 · 叙事权交给你':'叙事权保留给你'}${drawNote}`;
  if(result.winner)return `叙事权交给${names[result.winner] || '新的讲述者'}${drawNote}`;
  return `叙事权由${names[view.narrator] || '当前讲述者'}保留${drawNote}`;
}
function showResultToast(result, view){
  const message=resultToast(result,view);
  if(!message)return;
  const toast=$('game-toast');
  toast.textContent=message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{toast.classList.remove('show');toastTimer=null;},1800);
}
function selectedName(){return chosenCard===game?.ending_card?.id?'结局':game?.followup_card?.name || game?.hand.find(c=>c.id===chosenCard)?.name || '';}
const phases = {WAIT_EXCHANGE_DISCARD:'换牌 · 待弃牌',WAIT_ZERO_DRAW:'失权抽牌选择',WAIT_GROUP_DISCARD:'集体换牌',WAIT_STALEMATE:'停滞处理',WAIT_FOLLOWUP:'用打断牌补充一句',WAIT_RESPONSES:'等待确认',WAIT_ACTION:'轮到你叙述',WAIT_REVISION:'修改叙述',SHOW_RESULT:'回合已结算',SLICE_COMPLETE:'试玩已完成',TECH_PAUSED:'等待处理',WAIT_TRANSITION:'叙事者推进过渡',WAIT_DIRECTOR_REVISION:'修改过渡',ENDING_READY:'结局资格已解锁'};
const messages = {PREVIEW_ONLY:'当前是布局预览，支持选牌但不会推进对局。接话需在正式试玩服务中进行。',STALE_VERSION:'对局已有更新，请同步后重新选择。',STALE_SEGMENT:'这段叙述已更新，请同步后重新选择。',INVALID_OPPORTUNITY:'该打断位置已失效，请重新同步。',EMPTY_TEXT:'请先写下你的叙述。',TEXT_TOO_LONG:'叙述不能超过 80 字。',REVISION_TARGET_LOCKED:'修改时需要保留原来的目标牌。',CANDIDATE_REQUIRED:'请先选择一张候选故事牌，再提交过渡。',HUMAN_INPUT_REQUIRED:'请先输入补充句，或点击“让 AI 代理”。',PLAYTEST_DISABLED:'该服务没有开放开发试玩。',CATALOG_VERSION_UNAVAILABLE:'牌表版本已变更，请重新开场。'};
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function options() { return game?.segment?.opportunities || []; }
function selection() { return options().find(o => o.id === chosenOpportunity); }
function isAuthoring() { return ['WAIT_ACTION','WAIT_REVISION','WAIT_FOLLOWUP'].includes(game?.phase) || (game?.phase==='WAIT_TRANSITION' && game?.narrator==='human') || (game?.phase==='ENDING_READY' && chosenCard===game?.ending_card?.id); }
function textLimit() {return game?.phase==='ENDING_READY'?120:80;}
function choosingTransition() { return game?.phase==='WAIT_TRANSITION' && game.narrator==='human'; }
function choosingDiscard(){return game?.card_flow?.kind==='exchange'||(game?.card_flow?.kind==='group'&&game.card_flow.select_discard);}
function canUse(cardId) {
  if (!online || busy || presentation.playing) return false;
  if(cardId===game?.ending_card?.id)return !!game.ending_playable;
  if(board.dialog.open)return false;
  if(board.drag?.active)return false;
  if(choosingDiscard())return game.hand.some(c=>c.id===cardId);
  if(game?.mode==='cloud' && game.segment && !game.segment.cloud_ready)return false;
  if(game?.phase==='WAIT_FOLLOWUP')return false;
  if(choosingTransition())return true;
  if(canTarget(game))return game.hand.some(c=>c.id===cardId);
  if (isAuthoring()) return game.narrator==='human' && (!game.candidate || game.candidate.id===cardId) && (!game.revision_target || game.revision_target === cardId);
  return game?.phase === 'WAIT_RESPONSES' && options().some(o => o.card_id === cardId);
}
function accept(view,snapshot=false) {
  const previous = game;
  animateHand=!snapshot&&game?.id===view?.id&&game?.revision!==view?.revision;
  discardTransfer=!!game?.card_flow;
  presentation.accept(game, view, snapshot);
  const changed = game?.segment?.id !== view?.segment?.id || game?.phase !== view?.phase || game?.id !== view?.id;
  game = view;
  if(!snapshot && changed && view?.phase==='SHOW_RESULT' && view.result?.id && view.result.id!==previous?.result?.id)
    showResultToast(view.result,view);
  if (changed) { chosenCard = game?.card_flow ? null : game?.followup_card?.id || game?.revision_target || game?.candidate?.id || null; chosenOpportunity = null; hoverCard = null; }
  if (chosenCard && chosenCard!==game?.ending_card?.id && chosenCard!==game?.followup_card?.id && !game?.hand.some(c => c.id === chosenCard)) chosenCard = null;
  if (chosenOpportunity && !options().some(o => o.id === chosenOpportunity)) chosenOpportunity = null;
  const nextDraftKey = game ? `ouat.draft.${game.id}.${game.round}` : '';
  if (nextDraftKey !== draftKey) { draftKey = nextDraftKey; $('narration').value = draftKey ? localStorage.getItem(draftKey) || '' : ''; }
}
async function perform(task) {
  if (busy) return;
  busy = true; errorMessage = ''; render();
  try { accept(await task()); online = true; }
  catch (error) {
    if(api.cached())accept(api.cached());
    online = error.message === 'PREVIEW_ONLY';
    errorMessage = error.message.startsWith('AI_') ? `云端判定未完成（${error.message}）。没有扣牌，也没有退回样例判定。点击同步可重试待发请求。` : messages[error.message] || '暂时无法同步。当前为只读缓存；检查服务和网络后，打开右上角“设置”，点击 ↻ 同步重试。';
  } finally { busy = false; workStage=''; render(); }
}
async function sync() {
  return perform(async () => {
    const current = await api.sync({autoJudge:false});
    localTypeTakeover = null;
    // Old browser sessions are valid guests but their saved row can still be
    // on the retired flow.  Start the current fair-v3 opening automatically
    // so a refresh never drops the player back into the legacy table.
    if (current && current.rules_version !== 'fair-v3') {
      return api.command('reset', current.revision);
    }
    const judged = current ? await api.autoJudge(current) : null;
    return judged || api.command('start',0);
  });
}
function typeTakeoverRelation(card,element) {
  const label=categories[element.category]||'要素';
  return `类型接话：${element.text}与「${card.name}」同属${label}类型；补写需自然关联该要素。`;
}
function resolveTypeTakeover({scene,element,cardId}) {
  const current=game,card=current?.hand?.find(item=>item.id===cardId),segment=current?.segment;
  if(!current||!card||!segment||current.phase!=='WAIT_RESPONSES'||!segment.cloud_ready)return false;
  const relation=typeTakeoverRelation(card,element);
  const fields={segment_id:segment.id,scene_id:scene.id,element_id:element.id,card_id:cardId,relation_text:relation};
  const queued=api.queue('attempt_takeover',current.revision,fields);
  if(!queued)return false;
  localTypeTakeover={serverRevision:current.revision,command:queued};
  const next=JSON.parse(JSON.stringify(current));
  next.history=[...(current.history||[]),{id:segment.id,author:segment.narrator,text:segment.text}];
  next.result={id:segment.id,kind:segment.kind,winner:'human',retained:segment.text,cancelled:'',played:[{participant:'human',card_id:cardId,card}],human_applied:true,human_won:true,winner_reason:'真人合法接话优先于 AI。'};
  next.hand=current.hand.filter(item=>item.id!==cardId);
  next.used_count=(current.used_count||0)+1;
  const canForceDraw=((current.deck_count||0)+(current.discard_count||0))>0;
  next.participants=(current.participants||[]).map(person=>{
    if(person.id==='human')return {...person,hand_count:Math.max(0,(person.hand_count||0)-1)};
    if(canForceDraw&&person.id===segment.narrator&&segment.narrator!=='human')return {...person,hand_count:(person.hand_count||0)+1};
    return person;
  });
  next.narrator='human';next.phase='WAIT_FOLLOWUP';next.segment=null;next.round=(current.round||1)+1;
  next.transition_required=true;next.candidate=null;next.revision_target=null;next.followup_card=card;
  next.followup_match_type='category';next.followup_relation={relation,target_element:element,scene_text:segment.text};
  next.takeover_feedback=null;next.feedback=null;next.revision=(current.revision||0)+1;
  api.cache(next);
  return true;
}
function send(type, fields = {}) {
  if(localTypeTakeover){
    return perform(async()=>{
      const committed=await api.flush();
      // The locally applied result is only a projection until its queued
      // command is persisted.  If the queue disappeared (for example after
      // a stale-session cleanup), fail with the normal resync error instead
      // of dereferencing a missing server view and showing an opaque error.
      if(!committed){
        localTypeTakeover=null;
        throw new Error('STALE_VERSION');
      }
      localTypeTakeover=null;
      return api.command(type,committed.revision,fields);
    });
  }
  return perform(() => api.command(type, game?.revision || 0, fields));
}
function renderParticipants() {
  $('participants').replaceChildren(...game.participants.map(person => {
    const node = el('div', `participant ${person.id === game.narrator ? 'narrating' : ''}`);
    node.dataset.seat = person.id;
    node.append(el('span','avatar', person.id === 'human' ? 'YOU' : person.name.slice(0,1)));
    const info = el('div','participant-info');
    info.append(el('span','participant-name',person.name),el('span','participant-role',person.id === game.narrator ? '正在讲述' : '聆听故事'));
    node.append(info);
    if (person.id === 'human') {
      node.append(el('span','hand-mini',`${person.hand_count} 张`));
    } else {
      const count = Math.max(0, Math.floor(Number(person.hand_count) || 0));
      const backs = el('div','opponent-hand');
      backs.setAttribute('role','img');
      backs.setAttribute('aria-label',`${person.name}有 ${count} 张手牌`);
      backs.title = `${count} 张手牌`;
      backs.append(el('span','opponent-count',`${count}张`));
      for (let i = 0; i < count; i++) {
        const back = el('span','opponent-card');
        const offset = i - (count - 1) / 2;
        back.setAttribute('aria-hidden','true');
        back.style.setProperty('--back-x',`${offset * Math.min(9, 42 / Math.max(1, count - 1))}px`);
        back.style.setProperty('--back-y',`${Math.abs(offset) * 1.5}px`);
        back.style.setProperty('--back-angle',`${offset * Math.min(7, 32 / Math.max(1, count - 1))}deg`);
        backs.append(back);
      }
      node.append(backs);
    }
    return node;
  }));
  $('deck-count').textContent = game.deck_count;
  $('used-count').textContent = game.used_count;
  $('discard-count').textContent = game.discard_count||0;
}
function renderStory() {
  const container = $('story-text'); container.replaceChildren();
  if (game.segment) {
    const segment = game.segment;
    const point = selection();
    const preview = hoverCard || chosenCard;
    const all = preview ? options().filter(o=>o.card_id===preview) : options();
    const ranges = new Map();
    for (const o of all) {
      if(o.match_type==='category')continue;
      const key = `${o.start_cp}:${o.end_cp}`;
      if (!ranges.has(key) || o.card_id === preview) ranges.set(key,o);
    }
    let cursor = 0;
    const appendText = (start, end) => {
      if (end <= start) return;
      if (!['transition-v2','fair-v3'].includes(game.rules_version) && point && start < point.boundary_cp && end > point.boundary_cp) {
        container.append(document.createTextNode(cpSlice(segment.text,start,point.boundary_cp)));
        container.append(el('span','cancelled-preview',cpSlice(segment.text,point.boundary_cp,end)));
      } else container.append(el('span',!['transition-v2','fair-v3'].includes(game.rules_version) && point && start >= point.boundary_cp ? 'cancelled-preview' : '',cpSlice(segment.text,start,end)));
    };
    for (const o of [...ranges.values()].sort((a,b)=>a.start_cp-b.start_cp)) {
      if (o.start_cp < cursor) continue;
      appendText(cursor,o.start_cp);
      const button = el(game.rules_version==='fair-v3'?'span':'button',`word available ${o.card_id === preview ? 'preview' : ''} ${o.id === chosenOpportunity ? 'selected' : ''} ${!['transition-v2','fair-v3'].includes(game.rules_version) && point && o.start_cp >= point.boundary_cp ? 'cancelled-preview' : ''}`,o.evidence);
      button.dataset.opportunity = o.id;
      button.setAttribute('aria-label',game.rules_version==='fair-v3'?`接话依据：${o.evidence}`:`${o.evidence}，打断位置 ${o.boundary_cp}`);
      if(game.rules_version!=='fair-v3')button.setAttribute('aria-pressed',String(o.id === chosenOpportunity));
      // Position selection follows card selection; inspecting words alone never submits.
      button.disabled = busy || !online || presentation.playing || chosenCard !== o.card_id;
      if(game.rules_version!=='fair-v3')button.addEventListener('click',()=>{ chosenOpportunity = o.id; renderPreview(); });
      container.append(button); cursor = o.end_cp;
    }
    appendText(cursor,Array.from(segment.text).length);
    $('narrator-label').textContent = `${names[segment.narrator]} · ${segment.kind==='transition' ? (segment.authoring==='ai' ? 'AI 代理过渡' : '你的过渡') : segment.kind==='followup' ? (segment.authoring==='ai' ? 'AI 代理补充' : '你的补充') : segment.narrator==='human' ? '你的叙述' : 'AI 出牌叙述'}`;
    $('pending-label').textContent = '尚未写入正式故事';
    $('story-caption').textContent = segment.kind==='followup'?(segment.authoring==='ai'?'AI 代理已生成补充 · 确认写入，不重复扣牌。':'接话补充 · 确认写入，不重复扣牌。'):point ? `过渡全文保留；胜出后用打断牌补充一句，再选择下一张候选牌。` : ['transition-v2','fair-v3'].includes(game.rules_version) && segment.kind==='active_play' ? `主动出牌「${segment.target.name}」· 本段不可打断，确认后扣牌。` : segment.kind==='transition' ? `${segment.authoring==='ai'?'AI 代理过渡':'你的过渡'} · 本段可以打断，不会主动扣除候选牌。` : segment.narrator === 'human' ? `主动牌「${segment.target.name}」使用最早合法位置。确认继续后统一结算。` : '点选下方发光手牌，再选择对应的词语。';
  } else if (game.phase === 'SHOW_RESULT') {
    const result = game.result;
    container.append(el('p',result.retained ? '' : 'result-empty',result.retained || (result.kind==='handoff' ? game.history.at(-1)?.text || '故事等待下一位讲述者。' : '这次叙述未生效，手牌保持不变。')));
    if (result.cancelled) {
      const cancelled = el('div','cancelled-result','以下后文已取消，不属于正式故事');
      cancelled.append(el('s','',result.cancelled)); container.append(cancelled);
    }
    $('narrator-label').textContent = result.kind==='handoff'?'上一段 · 正式故事':'已写入故事'; $('pending-label').textContent = '结算完成';
    $('story-caption').textContent = '只有保留下来的内容，才会成为接下来叙述的事实。';
  } else {
    const previous = game.history.at(-1);
    const previousText = game.opening_pending && previous?.author==='system' ? '很久很久以前，有一位冒牌勇者。' : previous?.text;
    container.append(el('p','',previousText || '故事正等你继续。'));
    $('narrator-label').textContent = '上一段 · 正式故事'; $('pending-label').textContent = '已保存';
    $('story-caption').textContent = game.phase==='TECH_PAUSED' ? '本段未通过裁判，没有写入正式故事，也没有扣牌。' : game.phase==='WAIT_TRANSITION' && game.narrator==='human' ? '接下来由你承接正式故事；也可以让 AI 代理，并朝你的秘密结局逐步推进。' : game.phase==='WAIT_DIRECTOR_REVISION' ? '上一段过渡未通过，需要保持候选与方向后修改。' : isAuthoring() ? '顺着这段故事往下写，不要把已取消的后文当作事实。' : game.card_flow?'先完成牌桌上的抽换牌选择，再继续故事。':'故事已保存。';
  }
}
function renderHistory() {
  const host = $('history'); host.replaceChildren();
  const history = game.history.slice(0, game.phase === 'SHOW_RESULT' || isAuthoring() || ['WAIT_TRANSITION','WAIT_DIRECTOR_REVISION','ENDING_READY','TECH_PAUSED'].includes(game.phase) ? -1 : undefined);
  if (!history.length && !game.ending_attempts?.length) return;
  const details = el('details'); details.open = true; details.append(el('summary','',`此前的故事 · ${history.length} 段正式记录`));
  for (const item of history) { const p = el('p','',item.text); p.prepend(el('small','',names[item.author])); details.append(p); }
  for(const attempt of game.ending_attempts||[]){const p=el('p','',attempt.text);p.prepend(el('small','',`${names[attempt.author]} · 结局尝试未生效`));details.append(p);}
  host.append(details);
}
function renderDecision() {
  const node = $('decision'); node.replaceChildren(); node.hidden=false; node.classList.toggle('ready',!!selection());
  if(game.card_flow){
    const kind=game.card_flow.kind;
    node.append(el('strong','',kind==='zero'?'刚刚失去叙事权，选择是否抽一张':kind==='stalemate'?'故事暂时停滞，牌源不足以集体换牌':kind==='group'?'集体换牌 · 选择一张弃牌':'换牌 · 选择一张弃牌'),el('p','',choosingDiscard()?'可选原手牌或刚抽到的新牌；抽牌已保存，不能取消或退出重抽。':kind==='zero'?'本次选择完成后，才会继续下一段故事。':'继续将重新计算四次无进展交权，也可选择无胜者结束。'));
    renderButtons();return;
  }
  if(game.phase==='WAIT_FOLLOWUP' || game.segment?.kind==='followup'){
    node.append(el('strong','',`用「${game.followup_card?.name || game.segment?.target?.name}」补充一句`),el('p','',game.segment?.authoring==='ai'?'AI 代理已完成补充，确认后写入正式故事。':game.narrator==='human'?'你可以自己补写，也可以让 AI 代理；必须体现牌义并关联完整过渡，通过后再选候选牌。':'须体现该牌概念并关联完整过渡；通过后再选候选牌，不重复扣牌。'));renderButtons();return;
  }
  if(game.phase==='WAIT_TRANSITION'){
    const chosen=game.hand.find(c=>c.id===chosenCard);
    node.append(el('strong','',game.narrator==='human' ? (game.hand.length?(chosen?`候选牌「${chosen.name}」已选，可由你输入过渡或让 AI 代理。`:'先选一张候选牌，再写过渡或让 AI 代理。'):'故事牌已用尽，请输入最后一段过渡。') : game.hand.length?(chosen?`下一张候选：${chosen.name} · AI 正在准备过渡。`:'等待 AI 选择候选牌并推进故事。'):'最后一张牌已打出，仍须完成一次可打断过渡。'),el('p','',game.public_commitments?.length?`本段须兑现已打出的：${game.public_commitments.map(c=>c.name).join('、')}。候选牌不扣除。`:'过渡可以跨越旅途、时间和地点，持续把故事推向叙事者的秘密结局。'));renderButtons();return;
  }
  if(game.phase==='WAIT_REVISION' && game.revision_kind==='transition'){
    node.append(el('strong','','过渡需要修改'),el('p','','保留候选牌和故事方向后重新输入，也可以让 AI 代理修改。'));renderButtons();return;
  }
  if(game.phase==='WAIT_DIRECTOR_REVISION'){
    node.append(el('strong','','过渡未通过，需要修改。'),el('p','',game.feedback+' 保留原候选，仅允许本次修改。'));renderButtons();return;
  }
  if(game.phase==='ENDING_READY'){
    node.append(el('strong','',game.feedback||'故事牌已打完，可以尝试结局。'),el('p','',game.narrator==='human'?'点选手牌中的结局牌，写出承接上文的收束。结局不可被打断，检查通过后确认结束。':'等待讲述者完成结局。'));renderButtons();return;
  }
  if(game.phase==='FINISHED'){node.append(el('strong','',game.result.winner?`${names[game.result.winner]}完成结局，故事结束。`:'故事结束 · 无胜者'));renderButtons();return;}
  if(game.segment?.kind==='ending' && game.segment.cloud_ready){node.append(el('strong','','结局检查通过'),el('p','','确认后打出结局牌并结束对局。'));renderButtons();return;}
  if(['transition-v2','fair-v3'].includes(game.rules_version) && game.segment?.kind==='active_play' && game.segment.cloud_ready){
    node.append(el('strong','','主动出牌段 · 不可打断'),el('p','','已检查叙述及目标牌。确认后全文生效并扣除主动牌，随后必须进入过渡。'));renderButtons();return;
  }
  if(game.mode==='cloud'&&game.segment&&!game.segment.cloud_ready){node.append(el('strong','','本段尚待云端判定。'),el('p','','正在等待有效判定。失败后点击同步可重试；判定齐全后才能确认。'));renderButtons();return;}
  if(game.phase==='TECH_PAUSED'){node.append(el('strong','','本次流程已暂停。'),el('p','',game.feedback));renderButtons();return;}
  if(canTarget(game)){
    node.append(el('strong','',chosenCard?'请选择场上的要素，说明这张牌与它的关系。':'拖动一张手牌，指定场上的要素。'),el('p','',game.takeover_feedback||'可尝试任意故事牌；通过后获得叙事权，再补写一句。'));
    renderButtons();return;
  }
  const point = selection();
  if (game.phase === 'WAIT_RESPONSES' && game.narrator !== 'human') {
    const card = game.hand.find(c=>c.id === chosenCard);
    node.append(el('strong','',point ? `申请用「${card.name}」接过故事` : card ? `「${card.name}」可以在这里打断` : options().length ? '故事里，出现了你的机会。' : '这段故事暂时没有你的打断机会。'));
    node.append(el('p','', point ? (game.human_interrupt_priority?'你的合法接话始终优先于 AI；确认前仍可改选。':'申请不等于胜出。所有听众确认后统一仲裁；现在仍可自由改选。') : card ? '确认接话后参与竞争；过渡全文保留，胜出后补充一句。' : options().length ? '先选择一张发光手牌，再确认接话；原文高亮仅说明依据。' : '你可以确认继续，不会自动代你放过。'));
    if (card && game.rules_version!=='fair-v3') {
      const row = el('div','positions');
      options().filter(o=>o.card_id===chosenCard).forEach((o,index)=>{
        const button=el('button','position',o.match_type==='category'?'类别接话 · 无需原文匹配':`位置 ${index+1} · ${o.evidence}`);
        button.dataset.position = o.id; button.setAttribute('aria-pressed',String(o.id===chosenOpportunity)); button.disabled = busy || !online || presentation.playing;
        button.addEventListener('click',()=>{chosenOpportunity=o.id;renderPreview();}); row.append(button);
      }); node.append(row);
      if (point) node.append(el('p','',(point.match_type==='category'?'类别接话：补充句自然包含此概念即可。':point.match_type==='bridge'?'承接机会：胜出后须在下一段兑现此牌。':'事实匹配：')+point.reason));
    }
    if(point && game.rules_version==='fair-v3')node.append(el('p','',point.match_type==='category'?point.reason:`${point.match_type==='bridge'?'承接机会':'事实匹配'}：${point.evidence}`));
  } else if (game.phase === 'WAIT_RESPONSES') {
    node.append(el('strong','','你的叙述已展示，等待你确认结算。'),el('p','','样例听众已按各自机会选择申请或放过；确认前不公开他们的选择，也不扣牌。'));
  } else if (isAuthoring()) {
    node.append(el('strong','',chosenCard ? `主动出牌：${game.followup_card?.name || game.hand.find(c=>c.id===chosenCard)?.name || ''}` : '选择手牌，让它成为这段故事的一部分。'),el('p','',game.rules_version==='fair-v3'?'主动牌参与本段情节；提交后先判定，再确认扣牌。':'主动牌固定使用最早合法位置。提交叙述只进入确认阶段，不会立即扣牌。'));
  } else if (game.phase === 'SHOW_RESULT') {
    node.hidden=true;
    renderButtons();
    return;
  } else node.append(el('strong','','这一段试玩已完成。'),el('p','','当前切片在清空持权者手牌或 20 段后停止，不会把停止当作胜利。可以重新开场再试。'));
  renderButtons();
}
function renderButtons() {
  const primary=$('primary'), secondary=$('secondary'); const active=online&&!busy&&!presentation.playing;
  const skip=$('skip-transition');
  const canSkip=canTarget(game)&&game?.narrator!=='human';
  skip.hidden=!canSkip;skip.disabled=!active||board.dialog.open||!!board.drag;
  skip.onclick=()=>send('respond',{segment_id:game.segment.id,opportunity_id:null});
  const optionalTargeting=game?.phase==='WAIT_RESPONSES'&&game.segment?.kind==='transition'&&game.narrator==='human';
  primary.hidden=canTarget(game)&&!optionalTargeting;
  for(const type of ['begin_exchange','pass_turn']){const button=$(type);const allowed=!!game?.card_actions?.[type];button.hidden=type==='pass_turn'&&!allowed;button.disabled=!active||!allowed;}
  const drawFlow=game?.card_flow;
  const canDraw=drawFlow?.kind==='zero'&&drawFlow.can_draw;
  $('draw-pile').disabled=!active||!canDraw;
  $('draw-pile').title=canDraw?'抽一张故事牌':drawFlow?.kind==='zero'&&!drawFlow.can_draw?'牌源不足，无法抽牌':'零手牌失去叙事权时可选择抽一张';
  $('begin_exchange').title=game?.card_actions?.begin_exchange?'先抽一张，再选择弃一张并交出叙事权':'轮到你主动出牌、没有待完成过渡且有牌可换时可用';
  secondary.hidden=true; secondary.onclick=null;
  if (!game) { primary.disabled=true; return; }
  if(game.card_flow){
    const flow=game.card_flow, fields={flow_id:flow.id};
    primary.disabled=!active;secondary.disabled=!active;
    if(choosingDiscard()){
      primary.textContent=flow.kind==='exchange'?'确认弃牌并交权':'确认集体弃牌';
      const selected=game.hand.find(c=>c.id===chosenCard);
      if(selected)primary.textContent=`弃「${selected.name}」${flow.kind==='exchange'?'并交权':''}`;
      primary.disabled=!active||!game.hand.some(c=>c.id===chosenCard);
      primary.onclick=()=>send(flow.kind==='exchange'?'discard_exchange':'choose_group_discard',{...fields,card_id:chosenCard});
    }else if(flow.kind==='zero'){
      primary.textContent='抽一张';primary.disabled=!active||!flow.can_draw;primary.onclick=()=>send('resolve_zero_hand_draw',{...fields,choice:'draw'});
      secondary.hidden=false;secondary.textContent='保持零牌';secondary.onclick=()=>send('resolve_zero_hand_draw',{...fields,choice:'keep'});
    }else if(flow.kind==='stalemate'){
      primary.textContent='继续游戏';primary.onclick=()=>send('resolve_stalemate',{...fields,choice:'continue'});
      secondary.hidden=false;secondary.textContent='无胜者结束';secondary.onclick=()=>send('resolve_stalemate',{...fields,choice:'end'});
    }else{primary.textContent='等待其他人弃牌';primary.disabled=true;}
    return;
  }
  if(game.phase==='ENDING_READY' && !isAuthoring()){
    primary.textContent=game.narrator==='human'?'点选结局牌':'生成结局';primary.disabled=!active||game.narrator==='human';primary.onclick=()=>send('generate');return;
  }
  if(game.phase==='WAIT_TRANSITION'){
    if(game.narrator==='human'){
      const count=characterCount($('narration').value),needsCandidate=game.hand.length>0;
      primary.textContent=busy?'正在检查过渡…':'提交过渡';
      primary.disabled=!active||count===0||count>textLimit()||(needsCandidate&&!chosenCard);
      primary.onclick=()=>send('narrate',{card_id:chosenCard||null,text:$('narration').value});
      secondary.hidden=false;secondary.textContent=busy?'等待 AI 代理…':'让 AI 代理过渡';secondary.disabled=!active||(needsCandidate&&!chosenCard);
      secondary.onclick=()=>send('generate',{card_id:chosenCard||null});
    }else{
      primary.textContent=busy?'AI 正在推进故事…':game.hand.length?'生成 AI 过渡':'生成最后一次过渡';primary.disabled=!active;
      primary.onclick=()=>send('generate');
    }
    return;
  }
  if(game.phase==='WAIT_DIRECTOR_REVISION'){
    primary.textContent=busy?'AI 正在修改并判定…':'让 AI 代理修改一次';primary.disabled=!active;primary.onclick=()=>send('generate');return;
  }
  if (game.phase === 'WAIT_RESPONSES') {
    if(game.mode==='cloud'&&!game.segment.cloud_ready){primary.textContent=busy?'云端裁判判定中…':'请先判定本段';primary.disabled=true;return;}
    const author=game.narrator==='human', hasOptions=options().length>0;
    primary.textContent=busy?'正在保存…':game.segment.kind==='ending'?'确认结局 · 结束故事':author||!hasOptions?'确认继续':'确认接话';
    primary.disabled=!active||(!author&&hasOptions&&!selection());
    primary.onclick=()=>send('respond',{segment_id:game.segment.id,opportunity_id:chosenOpportunity});
    if(!author&&hasOptions) { secondary.hidden=false;secondary.textContent='放过这段';secondary.disabled=!active;secondary.onclick=()=>send('respond',{segment_id:game.segment.id,opportunity_id:null}); }
  } else if(game.phase==='WAIT_REVISION' && game.revision_kind==='transition' && game.narrator==='human') {
    const count=characterCount($('narration').value),target=game.candidate?.id || chosenCard;
    primary.textContent=busy?'正在检查过渡…':'提交修改';primary.disabled=!active||!target||count===0||count>textLimit();
    primary.onclick=()=>send('narrate',{card_id:target,text:$('narration').value});
    secondary.hidden=false;secondary.textContent=busy?'等待 AI 代理…':'让 AI 代理修改';secondary.disabled=!active;
    secondary.onclick=()=>send('generate',{delegate:true});
  } else if(game.phase==='WAIT_FOLLOWUP' && game.narrator==='human') {
    const count=characterCount($('narration').value),target=game.followup_card?.id;
    primary.textContent=busy?'正在检查补充…':'提交补充';primary.disabled=!active||!target||count===0||count>textLimit();
    primary.onclick=()=>send('narrate',{card_id:target,text:$('narration').value});
    secondary.hidden=false;secondary.textContent=busy?'等待 AI 代理…':'让 AI 代理补写';secondary.disabled=!active;
    secondary.onclick=()=>send('generate',{delegate:true});
  } else if(isAuthoring()) {
    const count=characterCount($('narration').value);
    primary.textContent=busy?'正在检查…':game.phase==='ENDING_READY'?'提交结局':'提交叙述';primary.disabled=!active||!chosenCard||count===0||count>textLimit();
    primary.onclick=()=>send('narrate',{card_id:chosenCard,text:$('narration').value});
  } else if(game.phase==='SHOW_RESULT') {
    primary.textContent=busy?'正在恢复…':game.narrator==='human'?'继续 · 由我讲述':'继续 · 下一段';primary.disabled=!active;primary.onclick=()=>send('continue');
  } else {primary.textContent='重新开场';primary.disabled=!active;primary.onclick=()=>$('reset-dialog').showModal();}
}
function createHandCard(card){
  const node=el('button',`hand-card ${card.ending?'ending-card':'story-card'}`);
  node.dataset.card=card.id;
  for(const name of ['interrupt-badge','card-category','card-art','card-name','card-desc','card-status'])node.append(el('span',name));
  node.addEventListener('pointerenter',()=>{hoverCard=card.id;renderPreview();});
  node.addEventListener('pointerleave',()=>{hoverCard=null;renderPreview();});
  node.addEventListener('focus',()=>{hoverCard=card.id;renderPreview();});
  node.addEventListener('blur',()=>{hoverCard=null;updateHandLayout();});
  node.addEventListener('click',()=>{
    if(node.classList.contains('in-transit')||!canUse(card.id))return;
    if(chosenCard===card.id){
      const locked=isAuthoring()&&!choosingDiscard()&&
        (game.candidate?.id===card.id||game.revision_target===card.id||game.followup_card?.id===card.id);
      if(locked)return;
      chosenCard=null;chosenOpportunity=null;hoverCard=null;
      render();return;
    }
    if(card.ending){chosenCard=card.id;chosenOpportunity=null;render();$('narration').focus();return;}
    if(isAuthoring()||choosingTransition()||choosingDiscard()||canTarget(game)){chosenCard=card.id;chosenOpportunity=null;}
    else{const choice=chooseCard(options(),card.id);chosenCard=choice.cardId;chosenOpportunity=choice.opportunityId;}
    renderPreview();
  });
  return node;
}
function updateHandCard(node,card){
  const artwork=workshopCards.get(card.id);
  const faceData={id:card.id,kind:card.ending?'ending':'story',theme:card.ending?'ending':card.category,
    name:card.ending?(artwork?.name || '结局'):card.name,description:card.semantic_core,
    interrupt:!!card.category_interrupt,art:artwork?.art};
  const signature=JSON.stringify(faceData);
  if(node.dataset.faceSignature!==signature){
    const face=createCardFace(faceData,{showArt:true});
    face.setAttribute('aria-hidden','true');
    node.querySelector('.ouat-card')?.remove();node.prepend(face);
    node.dataset.faceSignature=signature;node.classList.add('workshop-hand-card');
  }
  const usable=canUse(card.id),count=options().filter(o=>o.card_id===card.id).length;
  node.classList.toggle('usable',usable);node.classList.toggle('picked',chosenCard===card.id);
  node.setAttribute('aria-label',card.ending?'结局牌':card.name);node.setAttribute('aria-disabled',String(!usable));node.setAttribute('aria-pressed',String(chosenCard===card.id));
  node.title=card.semantic_core+(card.category_interrupt?' · 兼具同类别接话能力':'');
  const set=(name,text)=>{const child=node.querySelector('.'+name);if(child.textContent!==text)child.textContent=text;};
  set('interrupt-badge',card.category_interrupt?'↪ 类别接话':'');node.querySelector('.interrupt-badge').hidden=!card.category_interrupt;
  set('card-category',card.ending?'秘密结局':categories[card.category]);
  set('card-art',card.ending?'':symbols[card.id]||'✧');node.querySelector('.card-art').hidden=!!card.ending;
  set('card-name',card.ending?'结局':card.name);set('card-desc',card.semantic_core);
  set('card-status',card.ending?(game.phase==='FINISHED'?'故事已结束':game.hand.length?`还剩 ${game.hand.length} 张故事牌`:game.ending_playable?'点选并写下结局':'等待叙事权与过渡完成'):choosingDiscard()?'点选后确认弃牌':game.phase==='WAIT_FOLLOWUP'?'先完成接话补充':choosingTransition()?'点选下一张候选牌':isAuthoring()?'目标牌（过渡后锁定）':count?`${count} 个接话机会`:'等待故事中的机会');
  if(canTarget(game)&&!card.ending)set('card-status','拖向要素或点选 · 说明关系后判定');
  if(choosingTransition()&&!card.ending)set('card-status','候选牌 · 过渡后才会正式打出');
}
function renderHand() {
  const cards=[...game.hand,...(game.ending_card?[{...game.ending_card,ending:true}]:[])];
  handView.sync(game.id,cards,{animate:animateHand,removedTo:discardTransfer?$('discard-pile'):$('story-text')});
  animateHand=false;
  $('hand-count').textContent=`${game.hand.length} + 结局`;
  $('hand-hint').textContent=choosingDiscard()?'选择一张故事牌弃掉，结局牌保留。':choosingTransition()?(game.narrator==='human'?'先选候选牌，再输入过渡或让 AI 代理。候选牌不会在过渡阶段扣除。':'AI 将选择候选牌并推进故事。'):isAuthoring()?'先选牌，再讲述。只有确认结算才会扣牌。':'亮起的手牌，正在等待你的选择。';
  updateHandLayout();handView.entered($('draw-pile'));
}
function updateHandLayout() {
  if(!game)return;
  const host=$('hand');
  // HandView keeps the ending last; every card shares one layout and focus queue.
  const nodes=[...host.querySelectorAll('.hand-card')];
  const focus=nodes.findIndex(node=>node.dataset.card===(hoverCard||chosenCard));
  const layouts=handLayout(nodes.length,focus);
  const extent=Math.max(1,...layouts.map(l=>Math.abs(l.x)));
  const cardWidth=Math.max(110,...nodes.map(node=>node.offsetWidth));
  const fanWidth=host.clientWidth-28;
  host.style.setProperty('--fan-center',`${14+fanWidth/2}px`);
  const fit=Math.min(1,Math.max(0,(fanWidth-cardWidth*1.12)/2)/extent);
  nodes.forEach((node,i)=>{
    const layout=layouts[i];node.style.setProperty('--x',`${layout.x*fit}px`);node.style.setProperty('--y',`${layout.y}px`);node.style.setProperty('--angle',`${layout.angle}deg`);node.style.setProperty('--scale',layout.scale);node.style.setProperty('--layer',layout.layer);
    node.classList.toggle('focused',i===focus);
    node.classList.toggle('picked',node.dataset.card===chosenCard);node.setAttribute('aria-pressed',String(node.dataset.card===chosenCard));
  });
}
function renderPreview() {
  if(!game)return;
  const focused = document.activeElement;
  const focusKey = focused?.dataset.opportunity ? ['opportunity',focused.dataset.opportunity] : focused?.dataset.position ? ['position',focused.dataset.position] : null;
  renderStory();renderDecision();renderHand();
  $('target-label').textContent=chosenCard?`目标牌 · ${selectedName()}`:'尚未选择目标牌';
  updateCount();
  board.render(game,!online||busy||presentation.playing,chosenCard);
  if(focusKey) document.querySelector(`[data-${focusKey[0]}="${CSS.escape(focusKey[1])}"]`)?.focus({preventScroll:true});
}
function render() {
  $('error').hidden=!errorMessage;$('error').textContent=errorMessage;
  $('sync').disabled=busy;$('reset').disabled=busy||!online;
  $('save-state').textContent=busy?(game?.mode==='cloud'?'正在提交或等待云端判定，完成后再确认结算…':'正在与牌桌同步…'):!online?'离线只读 · 恢复同步后才能操作':'已同步 · 刷新可恢复 · 预览不扣牌';
  if(!game)return;
  const cloud=game.mode==='cloud';
  $('cloud-judge').hidden=['transition-v2','fair-v3'].includes(game.rules_version)||game.phase!=='WAIT_RESPONSES'||game.segment?.cloud_ready;
  $('cloud-judge').disabled=busy||!online;
  $('cloud-judge').textContent=busy?'等待云端裁判，请稍候…':'使用云端裁判判定本段';
  $('mode-note').textContent=game.mode==='fixture'?'本地 UI 模拟 · 样例判定，不调用云端':(['transition-v2','fair-v3'].includes(game.rules_version)?`强制过渡 v0.2 · 云端叙事代理与裁判 · AI 策略暂为固定选择${game.ai_metrics?' · 上次判定 '+(game.ai_metrics.latency_ms/1000).toFixed(1)+' 秒':''}`:cloud?`云端裁判 · Qwen / v1.2 · 叙述与 AI 策略仍为样例${game.ai_metrics?' · 上次判定 '+(game.ai_metrics.latency_ms/1000).toFixed(1)+' 秒':''}`:'样例模式 · 固定开场 / 可点击下方按钮切换真实裁判');
  if(!['transition-v2','fair-v3'].includes(game.rules_version))$('mode-note').textContent='旧规则存档 · 重新开场可启用强制过渡。'+$('mode-note').textContent;
  if(game.rules_version==='fair-v3')$('mode-note').textContent=`真人接话优先 · 无名人物 · 结局可提交${game.ai_metrics?' · 上次判定 '+(game.ai_metrics.latency_ms/1000).toFixed(1)+' 秒':''}`;
  if(game.element_takeover_version===1)$('mode-note').textContent='要素接话 · 叙事者推进过渡 · 可委托 AI · 真人优先';
  else $('mode-note').textContent+=' · 旧存档：重新开场可体验要素接话';
  document.querySelector('footer span:last-child').textContent=game.mode==='fixture'?'本地 UI 模拟 · 不调用云端':(['transition-v2','fair-v3'].includes(game.rules_version)?'主动出牌受保护 · 过渡可以打断':cloud?'真实云端裁判 · 样例叙述与策略':'样例裁判 ≠ v1.2 AI 裁判');
  $('compose-lead').textContent=previousStoryLine();
  const composerHint=document.querySelector('#composer>p');
  composerHint.textContent=game.opening_pending?'':game.phase==='WAIT_FOLLOWUP'?`请用「${game.followup_card?.name}」补充上一句；也可以让 AI 代理。`:game.phase==='WAIT_TRANSITION'&&game.narrator==='human'?'请承接上一句，写一段可跨越时间、地点或旅途的过渡；也可以让 AI 代理。':game.phase==='WAIT_REVISION'&&game.revision_kind==='transition'?'请修改上一段过渡，保留候选牌和故事方向；也可以重新让 AI 代理。':['transition-v2','fair-v3'].includes(game.rules_version)?'请为已选候选牌写出具体行动，本段不可被打断。':cloud?'请承接上一句继续写故事。云端裁判判断牌义是否成立。':'请承接上一句继续写故事。样例模式需要直接写出牌名。';
  if(game.phase==='ENDING_READY')document.querySelector('#composer>p').textContent=`结局要求：${game.ending} 请承接正式故事收束，最多120字。`;
  composerHint.hidden=!composerHint.textContent;
  if(game.phase==='WAIT_FOLLOWUP'&&game.followup_relation)document.querySelector('#composer>p').textContent+=` 须兑现与「${game.followup_relation.target_element.text}」的关系：${game.followup_relation.relation}`;
  $('chapter-number').textContent=`第 ${game.round} 章`;
  $('chapter-title').textContent=game.round===1?'钟声之后':'故事的下一页';
  $('phase-label').textContent=game.phase==='FINISHED'?'故事已结束':phases[game.phase]||game.phase;
  $('priority-order').hidden=game.rules_version!=='fair-v3';
  $('priority-order').textContent=(game.human_interrupt_priority?'你始终优先 · AI 顺序：':'接话优先：')+(game.takeover_priority||[]).filter(p=>!game.human_interrupt_priority||p!=='human').map(p=>names[p]).join(' → ');
  $('composer').hidden=!isAuthoring()||game.narrator!=='human';$('narration').disabled=busy||!online;
  $('fill-example').disabled=busy||aiFillBusy||!online||!chosenCard;
  renderParticipants();renderHistory();renderStory();renderHand();renderDecision();updateCount();
  $('feedback').textContent=game.feedback||'';
  $('target-label').textContent=chosenCard?`目标牌 · ${selectedName()}`:'尚未选择目标牌';
  presentation.render(game, busy);
  board.render(game,!online||busy||presentation.playing,chosenCard);
  const guide=document.querySelector('.guide ol');
  $('relation-error').textContent=errorMessage;
  $('relation-retry').hidden=online||busy;
  if(game.element_takeover_version===1){
    const selected=chosenCard&&game.hand.find(card=>card.id===chosenCard);
    const steps=selected?.category_interrupt
      ? ['阅读过渡并浏览句子','拖到同类发光要素，直接获得叙事权','获得叙事权后补写故事']
      : ['阅读过渡并浏览句子','拖牌指定场上要素','解释关系，通过后补写'];
    guide.replaceChildren(...steps.map(text=>el('li','',text)));
  }
  if(workStage==='attempt_takeover')$('phase-label').textContent='正在结算接话…';
  if(busy && ['generate','judge'].includes(workStage)){
    const label=workStage==='generate'?'正在承接故事…':game.segment?.kind==='transition'?'正在判断接话机会…':'正在检查叙述合理性…';
    $('phase-label').textContent=label;
    $('primary').textContent=label;
    $('primary').disabled=true;
    if(workStage==='judge'){
      $('pending-label').textContent='可先阅读 · 尚未通过判定';
      $('decision').replaceChildren(el('strong','',label),el('p','','文字已生成，可以先阅读；判定完成后开放操作。'));
    }
  }
}
function updateCount(){const count=characterCount($('narration').value);$('count').textContent=`${count} / ${textLimit()}`;$('count').classList.toggle('long',count>textLimit());$('fill-example').disabled=busy||aiFillBusy||!online||!chosenCard||game?.phase==='ENDING_READY';renderButtons();}
$('narration').addEventListener('input',()=>{try{if(draftKey)localStorage.setItem(draftKey,$('narration').value);}catch{errorMessage='草稿无法保存在此浏览器，请勿关闭页面。';$('error').hidden=false;$('error').textContent=errorMessage;}updateCount();});
async function fillWithAi(){
  const card=game?.followup_card || game?.hand.find(c=>c.id===chosenCard);
  if(!card || busy || aiFillBusy || !online || game?.phase==='ENDING_READY')return;
  const button=$('fill-example');
  aiFillBusy=true;button.disabled=true;button.textContent='AI正在填充…';
  try{
    await new Promise(resolve=>setTimeout(resolve,220));
    if(!game || !online)return;
    const lead=game.phase==='WAIT_FOLLOWUP'?'那道线索让众人继续前进，':'众人循着线索继续前进，';
    $('narration').value=`${lead}${card.name}成为这次行动的关键。他们停下脚步，决定先查清事情的来由。`;
    $('narration').dispatchEvent(new Event('input'));
    $('narration').focus();
  } finally {
    aiFillBusy=false;button.textContent='由AI进行填充';updateCount();
  }
}
$('fill-example').addEventListener('click',fillWithAi);
$('sync').addEventListener('click',sync);
$('relation-retry').addEventListener('click',sync);
$('draw-pile').addEventListener('click',()=>{
  const flow=game?.card_flow;
  if(online&&!busy&&!presentation.playing&&flow?.kind==='zero'&&flow.can_draw)
    send('resolve_zero_hand_draw',{flow_id:flow.id,choice:'draw'});
});
for(const type of ['begin_exchange','pass_turn'])$(type).addEventListener('click',()=>send(type));
$('cloud-judge').addEventListener('click',()=>send('judge',{segment_id:game.segment.id}));
$('reset').addEventListener('click',()=>$('reset-dialog').showModal());
$('reset-dialog').addEventListener('close',()=>{if($('reset-dialog').returnValue==='reset')send('reset');});
window.addEventListener('online',sync);
window.addEventListener('resize',updateHandLayout);
// Artwork loading never blocks restoring or playing the game.
fetch(new URL('./assets/card-ui/catalog.json',import.meta.url),{cache:'no-store'})
  .then(response=>{if(!response.ok)throw new Error('Card catalog unavailable');return response.json();})
  .then(cards=>{for(const card of cards)workshopCards.set(card.id,card);if(game)renderHand();})
  .catch(()=>{/* The reusable face retains its category frame and text fallback. */});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
try {accept(api.cached());render();await sync();}catch{errorMessage='浏览器存储不可用。请允许本站保存试玩身份后刷新。';render();}finally{document.body.classList.remove('app-loading');}
