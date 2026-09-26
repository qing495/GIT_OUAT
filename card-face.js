// Reusable layered card face. All copy remains DOM text; no full-card bitmap.
import {assetUrl} from './asset-config.js';
export const themes = {
  character: { label: '角色', color: '#176369', mark: 'I' },
  thing: { label: '物件', color: '#91602c', mark: 'II' },
  place: { label: '地点', color: '#496849', mark: 'III' },
  aspect: { label: '特征', color: '#435c89', mark: 'IV' },
  event: { label: '事件', color: '#a34f3c', mark: 'V' },
  ending: { label: '秘密结局', color: '#61364f', mark: 'VI' },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function ornament(src, className) {
  const img = element('img', className);
  img.src = assetUrl(`assets/card-ui/${src}`);
  img.alt = '';
  img.draggable = false;
  img.setAttribute('aria-hidden', 'true');
  // Decorative layers must never surface the browser's broken-image glyph.
  // The card remains readable if an optional ornament is unavailable.
  img.addEventListener('error', () => img.remove(), {once: true});
  return img;
}

/** Pass standalone illustration URL in card.art; absence leaves a clean art slot. */
export function createCardFace(card, { showArt = false, bare = false } = {}) {
  const theme = themes[card.theme];
  if (!theme) throw new Error(`Unknown card theme: ${card.theme}`);
  const ending = card.kind === 'ending';
  const face = element('article', `ouat-card theme-${card.theme}${bare ? ' is-bare' : ''}`);
  face.dataset.cardId = card.id;
  face.setAttribute('aria-label', `${theme.label} · ${card.name} · ${card.id}`);
  const art = element('div', 'face-art');
  const placeholder = element('div', 'face-placeholder');
  placeholder.append(element('span', 'placeholder-seal', theme.mark), element('span', 'placeholder-title', ending ? '故事的终章' : theme.label), element('span', 'placeholder-note', '插画待填'));
  art.append(placeholder);
  if (showArt && card.art) {
    placeholder.setAttribute('aria-hidden', 'true');
    const image = element('img', 'face-illustration');
    image.src = assetUrl(card.art);
    image.alt = `${card.name}插画`;
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); placeholder.removeAttribute('aria-hidden'); }, { once: true });
    art.append(image);
  }
  const ribbon = element('div', 'face-ribbon');
  ribbon.append(ornament('ribbon.svg', 'ribbon-shape'), element('div', 'ribbon-paper'), ornament('olive-small.svg', 'ribbon-olive left'), element('span', 'ribbon-label', ending ? '秘密结局' : `故事 · ${theme.label}`), ornament('olive-small.svg', 'ribbon-olive right'));
  const panel = element('div', 'face-panel');
  panel.append(ornament(`panel-${ending ? 'ending' : 'story'}.svg`, 'panel-shape'), element('div', 'panel-paper'));
  const content = element('div', 'face-copy');
  const titleRow = element('div', 'face-title-row');
  titleRow.append(ornament('olive-small.svg', 'title-olive left'), element('h2', 'face-name', card.name), ornament('olive-small.svg', 'title-olive right'));
  content.append(titleRow, element('p', 'face-description', card.description), ornament('divider.svg', 'face-divider'));
  content.append(element('span', 'face-ability', ending ? '故事牌出尽后可用' : card.interrupt ? '类别接话' : '故事元素'));
  content.append(element('p', 'face-footer', ending ? '完成收束，确认结局' : card.interrupt ? '对应类别的主动牌之后可接话' : '让这一元素成为故事的一部分'));
  panel.append(content, ornament('olive-corner.svg', 'panel-olive left'), ornament('olive-corner.svg', 'panel-olive right'), ornament('fold-corner.svg', 'panel-fold left'), ornament('fold-corner.svg', 'panel-fold right'));
  const grain = element('div', 'frame-grain');
  grain.style.maskImage = `url("${assetUrl(`assets/card-ui/frame-${card.theme}.svg`)}")`;
  grain.setAttribute('aria-hidden','true');
  face.append(art, panel, ornament(`frame-${card.theme}.svg`, 'face-frame'), grain, ribbon, element('span', 'face-id', card.id));
  return face;
}
