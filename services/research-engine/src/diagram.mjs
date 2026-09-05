// SPDX-License-Identifier: AGPL-3.0-or-later
const xml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function geometry(nodes) {
  return nodes.map((n, i) => ({ ...n, x: 0.7 + (i % 3) * 4.1, y: 2 + Math.floor(i / 3) * 2.1, w: 3.3, h: 1.1 }));
}
export function endpoints(a,b) {
  if (a.y === b.y) return a.x < b.x ? [a.x+a.w,a.y+a.h/2,b.x,b.y+b.h/2] : [a.x,a.y+a.h/2,b.x+b.w,b.y+b.h/2];
  return a.y < b.y ? [a.x+a.w/2,a.y+a.h,b.x+b.w/2,b.y] : [a.x+a.w/2,a.y,b.x+b.w/2,b.y+b.h];
}
export function diagramSVG(slide) {
  const nodes = geometry(slide.nodes), byID = new Map(nodes.map(n => [n.id, n]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#287b89"/></marker></defs><rect width="1280" height="720" fill="white"/><text x="65" y="70" font-size="32" font-family="Microsoft YaHei">${xml(slide.title)}</text>`
    + slide.edges.map(e => { const [x1,y1,x2,y2] = endpoints(byID.get(e.from),byID.get(e.to)); return `<line x1="${x1*96}" y1="${y1*96}" x2="${x2*96}" y2="${y2*96}" stroke="#287b89" stroke-width="2" marker-end="url(#arrow)"/>`; }).join('')
    + nodes.map(n => `<rect x="${n.x*96}" y="${n.y*96}" width="${n.w*96}" height="${n.h*96}" rx="10" fill="#e8f3f4" stroke="#287b89"/><text x="${(n.x+.15)*96}" y="${(n.y+.45)*96}" font-family="Microsoft YaHei" font-size="20">${xml(n.label.slice(0,16))}</text><text x="${(n.x+.15)*96}" y="${(n.y+.8)*96}" font-family="Microsoft YaHei" font-size="20">${xml(n.label.slice(16))}</text>`).join('') + '</svg>';
}
export function diagramDrawio(slide) {
  const nodes = geometry(slide.nodes), ids = new Map(nodes.map((n,i) => [n.id, 'n'+i]));
  return `<mxfile><diagram name="方法图"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>`
    + nodes.map(n => `<mxCell id="${ids.get(n.id)}" value="${xml(n.label)}" style="rounded=1;whiteSpace=wrap;html=0;" vertex="1" parent="1"><mxGeometry x="${n.x*96}" y="${n.y*96}" width="${n.w*96}" height="${n.h*96}" as="geometry"/></mxCell>`).join('')
    + slide.edges.map((e,i) => `<mxCell id="e${i}" edge="1" parent="1" source="${ids.get(e.from)}" target="${ids.get(e.to)}" style="endArrow=block;"><mxGeometry relative="1" as="geometry"/></mxCell>`).join('') + '</root></mxGraphModel></diagram></mxfile>';
}
