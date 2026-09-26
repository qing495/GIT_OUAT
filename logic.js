export const codepoints = text => Array.from(text);
export const cpSlice = (text, start, end) => codepoints(text).slice(start, end).join('');
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export const characterCount = text => [...segmenter.segment(text)].filter(({segment}) => !/^\s+$/u.test(segment)).length;
export function chooseCard(opportunities, cardId) {
  const matches = opportunities.filter(o => o.card_id === cardId);
  return { cardId, opportunityId: matches.length === 1 ? matches[0].id : null };
}
export function handLayout(count, focusedIndex = -1) {
  const step = count <= 5 ? 152 : Math.max(65, 760 / count);
  return Array.from({length: count}, (_, index) => {
    const center = index - (count - 1) / 2;
    const focused = index === focusedIndex;
    const distance = index - focusedIndex;
    const shift = focusedIndex < 0 || focused ? 0 : Math.sign(distance) * Math.max(0, 25 - Math.abs(distance) * 7);
    return {x: center * step + shift, y: focused ? -16 : Math.abs(center) * 5,
      angle: focused ? 0 : center * 3, scale: focused ? 1.06 : 1, layer: focused ? 20 : index + 1};
  });
}
export function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
