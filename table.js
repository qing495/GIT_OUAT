// Presentation never submits commands or changes persisted gameplay state.
export class TablePresentation {
  constructor(refresh) {
    this.refresh = refresh;
    this.playing = false;
    this.ticket = 0;
    this.seen = new Set();
    const $ = id => document.getElementById(id);
    const toolbar = document.querySelector('.header-actions');
    const icons = {
      settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8.1 3.2a8.4 8.4 0 0 0-.2-1.1l2-1.5-2-3.4-2.3 1a8.3 8.3 0 0 0-1.9-1.1L15.4 3h-4l-.4 2.3A8.3 8.3 0 0 0 9.1 6L6.8 5 4.8 8.4l2 1.5a8.4 8.4 0 0 0-.2 1.1L4.2 12l2.4 2.1c.1.4.1.8.2 1.1l-2 1.5 2 3.4 2.3-1a8.3 8.3 0 0 0 1.9 1.1l.3 2.3h4l.4-2.3a8.3 8.3 0 0 0 1.9-1.1l2.3 1 2-3.4-2-1.5c.1-.4.2-.7.2-1.1l2.3-2.1-2.3-2.1Z"/></svg>',
      story: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5c2.7-.7 5.4-.3 8 1.2v14.1c-2.6-1.5-5.3-1.9-8-1.2V4.5Zm16 0c-2.7-.7-5.4-.3-8 1.2v14.1c2.6-1.5 5.3-1.9 8-1.2V4.5ZM6.2 7.1c1.6-.2 3.1.1 4.6.8m-4.6 2c1.6-.2 3.1.1 4.6.8m7-3.6c-1.6-.2-3.1.1-4.6.8m4.6 2c-1.6-.2-3.1.1-4.6.8"/></svg>'
    };
    const drawer = (label, nodes, icon) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'table-drawer';
      const title = document.createElement('h2'); title.textContent = label;
      const close = document.createElement('button'); close.textContent = '返回牌桌'; close.className = 'secondary-button';
      close.onclick = () => dialog.close();
      dialog.append(title, ...nodes, close); document.body.append(dialog);
      const open = document.createElement('button');
      open.className = 'table-nav-button';
      open.type = 'button';
      open.setAttribute('aria-label', label);
      open.title = label;
      open.innerHTML = `${icons[icon] || ''}<span class="sr-only">${label}</span>`;
      open.onclick = () => dialog.showModal(); toolbar.prepend(open);
      return dialog;
    };
    drawer('故事', [$('history')], 'story');
    drawer('设置', [$('mode-note'), $('cloud-judge').parentElement, $('reset'), $('save-state')], 'settings');
    this.stage = document.createElement('button');
    this.stage.className = 'table-performance'; this.stage.hidden = true;
    this.stage.setAttribute('aria-label','跳过演出，显示全文');
    this.stage.onclick = () => this.finish();
    document.body.append(this.stage);
    document.querySelector('.story-column').prepend(Object.assign(document.createElement('div'),{className:'table-emblem',textContent:'✧'}));
  }
  accept(previous, next, snapshot=false) {
    const resultId=next?.result?.id;
    if (!next || !previous || previous.id !== next.id || snapshot) {
      this.finish(false);
      if(previous?.id!==next?.id)this.seen.clear();
      if(resultId)this.seen.add(resultId);
      return;
    }
    if(previous.segment && !next.segment)this.finish(false);
    if (previous.segment?.id !== next.segment?.id && next.segment) {
      this.queue = {text:next.segment.text, card:null, seat:next.segment.narrator, kind:next.segment.kind};
    } else if (resultId && !this.seen.has(resultId)) {
      this.seen.add(resultId);
      const played=next.result.played.find(p=>p.participant!=='human');
      if(played)this.queue={text:'',card:played.card,seat:played.participant,kind:'committed'};
    }
    if (this.queue) this.playing = true;
  }
  render(game, busy) {
    document.body.classList.toggle('thinking',busy);
    document.body.classList.toggle('authoring',!document.getElementById('composer').hidden);
    if (!this.queue) return;
    const event = this.queue; this.queue = null;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.finish(); return; }
    this.play(event);
  }
  async play(event) {
    const ticket = ++this.ticket;
    this.stage.hidden = false;
    this.stage.replaceChildren();
    const card = document.createElement('div'); card.className = 'flying-card';
    card.textContent = event.card?.name || '故事继续';
    const label = document.createElement('small'); label.textContent = event.kind === 'committed' ? '已确认出牌' : event.kind === 'ending' ? '结局 · 检查后确认' : event.kind === 'followup' ? '接话补充 · 不重复扣牌' : event.kind === 'transition' ? '过渡 · 可以打断' : '叙述 · 待确认';
    const text = document.createElement('p');
    const skip = document.createElement('small'); skip.textContent = '轻点显示全文';
    this.stage.append(label,card,text,skip);
    const seat = document.querySelector(`[data-seat="${event.seat}"]`);
    if (event.card && seat) {
      const from = seat.getBoundingClientRect(), to = card.getBoundingClientRect();
      await card.animate([{transform:`translate(${from.x-to.x}px,${from.y-to.y}px) scale(.35) rotate(-12deg)`,opacity:.3},{transform:'none',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.7,.2,1)'}).finished;
    }
    const sentences = event.text?.match(/[^。！？]+[。！？]?/gu) || [];
    for (const sentence of sentences) {
      if (ticket !== this.ticket) return;
      text.textContent += sentence;
      await new Promise(resolve=>setTimeout(resolve,650));
    }
    if (ticket === this.ticket) this.finish();
  }
  finish(refresh=true) {
    this.ticket++; this.queue = null;
    const wasPlaying = this.playing; this.playing = false;
    if (this.stage) this.stage.hidden = true;
    if (wasPlaying && refresh) this.refresh();
  }
}
