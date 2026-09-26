import { createCardFace, themes } from './card-face.js';
import {assetUrl} from './asset-config.js';

const $ = id => document.getElementById(id);
const sampleIds = ['C01', 'T03', 'P01', 'A03', 'E03', 'F15'];
let cards = [], selected = 'all';
const paletteNames = { character: '深海青', thing: '古铜金', place: '苔林绿', aspect: '暮霭蓝', event: '赭朱红', ending: '暮紫金' };

function node(tag, className, text) {
  const item = document.createElement(tag); item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function options() { return { showArt: $('show-art').checked, bare: $('bare').checked }; }
function openCard(card) {
  $('detail-caption').textContent = `${card.id} · ${themes[card.theme].label}`;
  $('detail-card').replaceChildren(createCardFace(card, options()));
  $('detail-description').textContent = `${card.name}｜${card.description}${card.tone ? `（${card.tone}）` : ''}`;
  $('detail').showModal();
}
function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const visible = cards.filter(c => (selected === 'all' || (selected === 'illustrated' ? Boolean(c.art) : selected === 'samples' ? (query || sampleIds.includes(c.id)) : c.theme === selected)) && `${c.id} ${c.name} ${c.description} ${c.tone || ''}`.toLocaleLowerCase().includes(query));
  if (selected === 'samples' && !query) visible.sort((a,b) => sampleIds.indexOf(a.id)-sampleIds.indexOf(b.id));
  $('cards').replaceChildren(...visible.map(c => {
    const entry = node('div', 'card-entry'), button = node('button', 'card-button');
    button.type = 'button'; button.setAttribute('aria-label', `放大 ${c.id} ${c.name}`);
    button.append(createCardFace(c, options())); button.addEventListener('click', () => openCard(c));
    const meta = node('div', 'card-meta'), label = node('strong', '', `${themes[c.theme].label} / ${c.name}`), dot = node('span', 'dot');
    dot.style.setProperty('--dot', themes[c.theme].color); label.prepend(dot);
    meta.append(label, node('small', '', c.id)); entry.append(button, meta); return entry;
  }));
  $('count').textContent = `${visible.length} 张${selected === 'samples' && !query ? '样板' : '卡牌'} · 独立插画 ${cards.filter(c=>c.art).length} / ${cards.length}`;
  $('empty').hidden = visible.length > 0;
  document.querySelectorAll('.filter').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === selected)));
}
for (const [key, theme] of Object.entries(themes)) {
  const swatch = node('div', 'swatch'); swatch.style.setProperty('--swatch', theme.color);
  swatch.append(node('span', 'swatch-line'), node('strong', '', theme.label), node('small', '', `${paletteNames[key]} / ${theme.color.toUpperCase()}`)); $('palette').append(swatch);
}
for (const [key,label] of [['samples','六款样板'],['illustrated','已有插画'],['all','全部'],...Object.entries(themes).map(([key,t]) => [key,t.label])]) {
  const button = node('button', 'filter', label); button.type = 'button'; button.dataset.filter = key;
  button.addEventListener('click', () => { selected = key; render(); }); $('filters').append(button);
}
const assets = [...Object.entries(themes).map(([key,t]) => [`frame-${key}.svg`,`${t.label} · 透明卡框`]), ['panel-story.svg','故事牌 · 文本底板'],['panel-ending.svg','结局牌 · 文本底板'],['ribbon.svg','折边类别标题条'],['olive-small.svg','标题小枝 · 向内收拢'],['olive-corner.svg','底角大枝 · 向上舒展'],['fold-corner.svg','折角金饰'],['divider.svg','四瓣菱形分隔饰'],['parchment.png','羊皮纸纹理'],['printed-grain.png','磨旧印染纹理']];
for (const [file,label] of assets) {
  const tile = node('a','asset-tile'); tile.href = assetUrl(`assets/card-ui/${file}`); tile.target = '_blank'; tile.rel = 'noopener'; tile.setAttribute('aria-label', `打开素材：${label}`);
  const preview = node('div','asset-preview'), image = node('img',''); image.src = tile.href; image.alt = label; image.loading = 'lazy'; preview.append(image);
  tile.append(preview,node('p','',label),node('small','',file)); $('assets').append(tile);
}
$('search').addEventListener('input',render);
for (const id of ['bare','show-art']) $(id).addEventListener('change',render);
$('reset').addEventListener('click', () => { selected='all'; $('search').value=''; $('bare').checked=false; $('show-art').checked=true; render(); });
$('close').addEventListener('click',() => $('detail').close());
$('detail').addEventListener('click',e => { if(e.target === $('detail')) {const r = $('detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detail').close();} });
try {
  const response = await fetch('assets/card-ui/catalog.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  cards = await response.json(); render();
} catch(error) {
  $('count').textContent = '卡牌未载入'; $('error').hidden=false;
  $('error').textContent = `无法载入卡牌：${error.message}。请通过本地 HTTP 服务打开本页。`;
}
