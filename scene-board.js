import {characterCount} from './logic.js';
export const roles = {subject:'主语',predicate:'谓语',object:'宾语',attribute:'定语',adverbial:'状语',complement:'补语'};
const categories = {character:'角色',thing:'物品',place:'地点',event:'事件',aspect:'特征',other:'其他'};
export const displayRoles = {subject:'主语',predicate:'谓语',object:'宾语',attribute:'定语',adverbial:'状语'};
/** A category interrupt is the one takeover path that needs no relation text. */
export const isTypeMatch = (card,element) => Boolean(card?.category_interrupt && element?.category && element.category!=='other' && card.category===element.category);
const nominalRoles = new Set(['subject','object','attribute']);
const nominalCategories = new Set(['character','thing','place']);
const displayRank = (element,index=0) => [nominalRoles.has(element.role)?0:1,nominalCategories.has(element.category)?0:1,element.role==='subject'?0:element.role==='object'?1:element.role==='attribute'?2:3,index,element.start_cp||0];
/** Flatten the eligible roles into the six generic target cells. */
export const displayElements = scene => {
  if(!scene)return [];
  const values=Object.keys(displayRoles).flatMap(role=>scene.slots?.[role]||[]).map((element,index)=>({element,index}));
  values.sort((a,b)=>{const ar=displayRank(a.element,a.index),br=displayRank(b.element,b.index);for(let i=0;i<ar.length;i++)if(ar[i]!==br[i])return ar[i]-br[i];return 0;});
  return values.slice(0,6).map(item=>item.element);
};
export const sceneWindow = game => game?.element_takeover_version===1 && game.phase==='WAIT_RESPONSES' && game.segment?.kind==='transition';
// A judged transition may be connected through a card-to-element action.  The
// action is optional; if nobody applies, the current narrator continues.
export const canTarget = game => sceneWindow(game) && !!game.segment.cloud_ready && !game.card_flow &&
  (game.narrator!=='human' || game.segment.authoring==='human');
export function relationKey(game, cardId, elementId) { return `ouat.draft.relation.${game.id}.${game.segment.id}.${cardId}.${elementId}`; }
export function highlightParts(text, scene) {
  const chars=Array.from(text);
  return [chars.slice(0,scene.start_cp).join(''),chars.slice(scene.start_cp,scene.end_cp).join(''),chars.slice(scene.end_cp).join('')];
}
const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};

/** One target owner for pointer, touch and click-to-target. Ordinary relations
 * are submitted to the server; matching category interrupts are settled by
 * the client and queued for persistence. */
export class SceneBoard {
  constructor({getGame,selectCard,submit,refresh,onTypeTakeover}) {
    Object.assign(this,{getGame,selectCard,submit,refresh,onTypeTakeover});
    this.index=0;this.segmentId=null;this.drag=null;this.selected=null;this.blocked=true;
    this.host=document.getElementById('scene-board');
    this.nav=make('nav','scene-navigation');this.nav.setAttribute('aria-label','句子场面');
    this.prev=make('button','','上一句');this.counter=make('span');this.next=make('button','','下一句');
    this.nav.append(this.prev,this.counter,this.next);
    this.grid=make('div','scene-grid');this.host.append(this.nav,this.grid);
    this.prev.onclick=()=>this.change(-1);this.next.onclick=()=>this.change(1);
    this.dialog=document.getElementById('relation-dialog');this.input=document.getElementById('relation-text');
    this.confirm=document.getElementById('relation-submit');this.cancelButton=document.getElementById('relation-cancel');
    this.cancelButton.onclick=()=>this.cancel();
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();if(!this.blocked)this.cancel();});
    this.input.addEventListener('input',()=>{this.saveDraft();this.updateDialog();});
    this.confirm.onclick=()=>this.commit();
    document.getElementById('hand').addEventListener('pointerdown',event=>this.down(event));
    window.addEventListener('pointermove',event=>this.move(event),true);
    // Capture the release at the window level: the pointer can leave the hand or
    // be released over a dialog, and the targeting line must still be removed.
    window.addEventListener('pointerup',event=>this.up(event),true);
    window.addEventListener('pointercancel',()=>this.abortDrag());
    window.addEventListener('blur',()=>this.abortDrag());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.abortDrag();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){this.abortDrag();if(!this.blocked)this.cancel();}});
    document.addEventListener('contextmenu',event=>{if(this.drag){event.preventDefault();this.abortDrag();}});
    document.getElementById('hand').addEventListener('click',event=>{
      if(this.suppressClick){event.stopImmediatePropagation();event.preventDefault();this.suppressClick=false;}
    },true);
    const ns='http://www.w3.org/2000/svg';
    this.arrow=document.createElementNS(ns,'svg');this.arrow.classList.add('target-arrow');this.arrow.setAttribute('aria-hidden','true');
    const defs=document.createElementNS(ns,'defs'),marker=document.createElementNS(ns,'marker');
    for(const [k,v] of Object.entries({id:'target-head',markerWidth:8,markerHeight:8,refX:6,refY:3,orient:'auto'}))marker.setAttribute(k,v);
    const head=document.createElementNS(ns,'path');head.setAttribute('d','M0,0 L6,3 L0,6 Z');head.setAttribute('fill','currentColor');marker.append(head);defs.append(marker);
    this.path=document.createElementNS(ns,'path');this.path.setAttribute('marker-end','url(#target-head)');this.arrow.append(defs,this.path);document.body.append(this.arrow);this.arrow.hidden=true;this.arrow.style.display='none';
  }
  render(game,blocked,cardId) {
    this.blocked=blocked;this.cardId=cardId;
    document.body.classList.toggle('element-table',game.element_takeover_version===1);
    document.body.classList.toggle('target-window',canTarget(game));
    if(this.segmentId!==game.segment?.id){
      this.clearDrag();this.close();this.index=0;this.segmentId=game.segment?.id;
      try{this.index=Number(sessionStorage.getItem(`ouat.scene.${game.id}.${this.segmentId}`))||0;}catch{}
      this.restored=false;
    }
    const scenes=game.segment?.scenes||[];this.index=Math.max(0,Math.min(this.index,scenes.length-1));
    this.host.hidden=!sceneWindow(game)||!scenes.length;
    this.lockNavigation();
    this.counter.textContent=`第 ${this.index+1} / ${scenes.length} 句`;
    const scene=scenes[this.index];
    const visible=displayElements(scene);
    // Do not recreate a pointer target during a drag.
    if(!this.drag){
      this.grid.replaceChildren();
      for(let slotIndex=0;slotIndex<6;slotIndex++){
        const element=visible[slotIndex];
        const slot=make('section','grammar-slot');slot.append(make('h3','',`要素 ${slotIndex+1}`));
        const list=make('div','element-list');slot.append(list);
        if(element){
          const button=make('button','element-card');button.dataset.element=element.id;button.dataset.category=element.category||'other';
          const roleLabel=roles[element.role]||'要素';
          button.append(make('small','element-type',`${roleLabel} · ${categories[element.category]}`),make('strong','',element.text));
          button.title=`${roleLabel} · ${categories[element.category]}：${element.text}${element.referent?'；指代 '+element.referent:''}`;
          button.setAttribute('aria-label',button.title);
          button.disabled=blocked||!canTarget(game)||!cardId||this.dialog.open;
          const card=game.hand.find(c=>c.id===cardId);
          button.classList.toggle('type-match',isTypeMatch(card,element));
          button.onclick=()=>this.choose(scene,element,cardId);
          list.append(button);
        }
        slot.classList.toggle('empty',!list.children.length);this.grid.append(slot);
      }
    }
    if(scene&&sceneWindow(game)){
      const host=document.getElementById('story-text'),parts=highlightParts(game.segment.text,scene);host.replaceChildren();
      host.append(document.createTextNode(parts[0]),make('mark','current-clause',parts[1]),document.createTextNode(parts[2]));
    }
    if(!this.restored&&canTarget(game)&&!blocked){
      this.restored=true;
      try{
        const saved=JSON.parse(localStorage.getItem(`ouat.draft.target.${game.id}.${game.segment.id}`)||'null');
        const savedScene=scenes.find(s=>s.id===saved?.sceneId);
        const element=savedScene&&Object.values(savedScene.slots).flat().find(e=>e.id===saved.elementId);
        const savedCard=game.hand.find(c=>c.id===saved.cardId);
        if(element&&savedCard&&!isTypeMatch(savedCard,element))this.open(savedScene,element,saved.cardId);
        else if(element&&savedCard&&isTypeMatch(savedCard,element)){
          localStorage.removeItem(relationKey(game,saved.cardId,element.id));
          localStorage.removeItem(`ouat.draft.target.${game.id}.${game.segment.id}`);
        }
      }catch{}
    }
    this.updateDialog();
  }
  lockNavigation(){const game=this.getGame(),scenes=game?.segment?.scenes||[];const locked=this.blocked||!!this.drag||this.dialog.open;this.prev.disabled=locked||this.index===0;this.next.disabled=locked||this.index>=scenes.length-1;const skip=document.getElementById('skip-transition');if(skip)skip.disabled=locked||!canTarget(game);}
  change(delta){if(this.blocked||this.drag||this.dialog.open)return;const game=this.getGame();this.index=Math.max(0,Math.min(this.index+delta,game.segment.scenes.length-1));try{sessionStorage.setItem(`ouat.scene.${game.id}.${game.segment.id}`,this.index);}catch{}this.refresh();}
  open(scene,element,cardId){
    const game=this.getGame();if(this.blocked||!canTarget(game))return;
    const card=game.hand.find(c=>c.id===cardId);if(!card)return;
    this.selected={scene,element,cardId};this.selectCard(cardId);
    document.getElementById('relation-title').textContent=`「${card.name}」 → 「${element.text}」`;
    document.getElementById('relation-context').textContent=`${roles[element.role]} · ${categories[element.category]}｜${scene.text}\n牌义：${card.semantic_core}`;
    this.input.value='';try{this.input.value=localStorage.getItem(relationKey(game,cardId,element.id))||'';}catch{}
    this.saveDraft();this.updateDialog();if(!this.dialog.open)this.dialog.showModal();this.lockNavigation();this.input.focus();
  }
  choose(scene,element,cardId){
    const game=this.getGame();if(this.blocked||!canTarget(game))return;
    const card=game.hand.find(c=>c.id===cardId);if(!card)return;
    if(isTypeMatch(card,element)){
      try{localStorage.removeItem(relationKey(game,cardId,element.id));localStorage.removeItem(`ouat.draft.target.${game.id}.${game.segment.id}`);}catch{}
      this.selectCard(cardId);
      return this.onTypeTakeover?.({scene,element,cardId});
    }
    return this.open(scene,element,cardId);
  }
  saveDraft(){if(!this.selected)return;const game=this.getGame(),{scene,element,cardId}=this.selected;
    try{localStorage.setItem(relationKey(game,cardId,element.id),this.input.value);localStorage.setItem(`ouat.draft.target.${game.id}.${game.segment.id}`,JSON.stringify({sceneId:scene.id,elementId:element.id,cardId}));}
    catch{document.getElementById('relation-feedback').textContent='草稿保存失败，请勿关闭页面。';}
  }
  updateDialog(){
    const count=characterCount(this.input.value.trim());
    document.getElementById('relation-count').textContent=`${count} / 200`;
    this.confirm.disabled=this.blocked||count===0||count>200;this.cancelButton.disabled=this.blocked;this.input.disabled=this.blocked;
    this.confirm.textContent=this.blocked?'正在判定…':'提交判定';
    const feedback=this.getGame()?.takeover_feedback;
    document.getElementById('relation-feedback').textContent=!this.blocked&&feedback?`上次判定：${feedback}`:'';
  }
  async commit(){if(this.confirm.disabled||!this.selected)return;const game=this.getGame(),{scene,element,cardId}=this.selected;this.saveDraft();
    await this.submit('attempt_takeover',{segment_id:game.segment.id,scene_id:scene.id,element_id:element.id,card_id:cardId,relation_text:this.input.value.trim()});
  }
  close(){this.dialog.close();this.selected=null;}
  cancel(){
    if(this.dialog.open){const game=this.getGame();try{localStorage.removeItem(`ouat.draft.target.${game.id}.${game.segment.id}`);}catch{}this.close();this.selectCard(null);this.refresh();}
  }
  down(event){
    const node=event.target.closest('.hand-card'),game=this.getGame();
    if(event.button!==0||!node||this.blocked||!canTarget(game)||this.dialog.open||node.classList.contains('in-transit')||!game.hand.some(c=>c.id===node.dataset.card))return;
    this.suppressClick=false;this.drag={node,cardId:node.dataset.card,x:event.clientX,y:event.clientY,pointerId:event.pointerId,active:false};
  }
  move(event){
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;
    if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<8)return;
    if(!drag.active){
      drag.active=true;
      try{drag.node.setPointerCapture(event.pointerId);}catch{}
      this.selectCard(drag.cardId);drag.node.classList.add('targeting-source');document.body.classList.add('is-targeting');
      const card=this.getGame().hand.find(c=>c.id===drag.cardId);
      document.body.classList.toggle('type-targeting',!!card?.category_interrupt);
      this.markTypeTargets(drag.cardId);this.lockNavigation();
    }
    const box=drag.node.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+20;
    this.arrow.hidden=false;this.arrow.style.display='block';this.path.setAttribute('d',`M ${x} ${y} Q ${x} ${event.clientY} ${event.clientX} ${event.clientY}`);
    this.grid.querySelectorAll('.target-hover').forEach(n=>n.classList.remove('target-hover'));
    drag.target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.element-card');
    drag.target?.classList.add('target-hover');this.arrow.classList.toggle('has-target',!!drag.target);
  }
  up(event){const drag=this.drag;if(!drag)return;
    const active=drag.active,targetId=drag.target?.dataset.element,cardId=drag.cardId;this.clearDrag();
    if(active){this.suppressClick=true;setTimeout(()=>{this.suppressClick=false;},0);const scene=this.getGame().segment?.scenes[this.index],element=scene&&Object.values(scene.slots).flat().find(e=>e.id===targetId);if(element)this.choose(scene,element,cardId);else{this.selectCard(null);this.refresh();}}
  }
  abortDrag(){const active=this.drag?.active;this.clearDrag();if(active){this.suppressClick=true;this.selectCard(null);this.refresh();}}
  clearDrag(){
    if(this.drag){const {node,pointerId}=this.drag;if(node.hasPointerCapture?.(pointerId))node.releasePointerCapture?.(pointerId);node.classList.remove('targeting-source');}
    this.drag=null;this.arrow.hidden=true;this.arrow.style.display='none';this.path.removeAttribute('d');this.arrow.classList.remove('has-target');document.body.classList.remove('is-targeting','type-targeting');this.grid.querySelectorAll('.target-hover').forEach(n=>n.classList.remove('target-hover'));this.lockNavigation();
  }
  markTypeTargets(cardId){
    const card=this.getGame()?.hand?.find(c=>c.id===cardId),scene=this.getGame()?.segment?.scenes?.[this.index];
    const elements=scene?Object.values(scene.slots||{}).flat():[];
    this.grid.querySelectorAll('.element-card').forEach(node=>{
      const element=elements.find(item=>item.id===node.dataset.element);
      node.classList.toggle('type-match',isTypeMatch(card,element));
    });
  }
}
