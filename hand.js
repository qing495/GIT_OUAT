// Card identity survives status renders. Only authoritative membership changes fly.
export class HandView {
  constructor(host, create, update) {
    this.host=host; this.create=create; this.update=update;
    this.nodes=new Map(); this.gameId=null; this.transfers=new Set(); this.entering=[];
  }
  sync(gameId, cards, {animate=false, removedTo=null}={}) {
    if(this.gameId!==gameId){this.cancel();this.host.replaceChildren();this.nodes.clear();this.gameId=gameId;animate=false;}
    const ids=new Set(cards.map(c=>c.id));
    for(const [id,node] of this.nodes){
      if(ids.has(id))continue;
      if(animate)this.flyOut(node,removedTo);
      node.remove();this.nodes.delete(id);
    }
    cards.forEach((card,index)=>{
      let node=this.nodes.get(card.id);
      if(!node){node=this.create(card);this.nodes.set(card.id,node);if(animate&&!card.ending)this.entering.push(node);}
      this.update(node,card);
      if(this.host.children[index]!==node)this.host.insertBefore(node,this.host.children[index]||null);
    });
  }
  reduced(){return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}
  flyOut(node,target){
    if(this.reduced()||!target||!node.animate)return;
    const from=node.getBoundingClientRect(),to=target.getBoundingClientRect();
    const ghost=node.cloneNode(true);ghost.removeAttribute('data-card');ghost.setAttribute('aria-hidden','true');
    ghost.className='card-transfer';ghost.style.cssText=`position:fixed;left:${from.x}px;top:${from.y}px;width:${from.width}px;height:${from.height}px;pointer-events:none;z-index:1000;`;
    document.body.append(ghost);
    const animation=ghost.animate([{transform:'none',opacity:1},{transform:`translate(${to.x+to.width/2-from.x-from.width/2}px,${to.y+to.height/2-from.y-from.height/2}px) scale(.25)`,opacity:.2}],{duration:360,easing:'ease-in'});
    this.track(animation,()=>ghost.remove());
  }
  entered(source){
    for(const node of this.entering.splice(0)){
      if(this.reduced()||!source||!node.animate)continue;
      const from=source.getBoundingClientRect(),to=node.getBoundingClientRect();
      node.classList.add('in-transit');
      const animation=node.animate([{translate:`${from.x+from.width/2-to.x-to.width/2}px ${from.y+from.height/2-to.y-to.height/2}px`,opacity:.3},{translate:'0px 0px',opacity:1}],{duration:380,easing:'ease-out'});
      this.track(animation,()=>node.classList.remove('in-transit'));
    }
  }
  track(animation,cleanup){
    this.transfers.add(animation);
    animation.finished.catch(()=>{}).finally(()=>{this.transfers.delete(animation);cleanup();});
  }
  cancel(){for(const animation of this.transfers)animation.cancel();this.transfers.clear();this.entering=[];}
}
