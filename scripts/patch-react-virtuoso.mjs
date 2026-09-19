// react-virtuoso 4.18.3: a newer pixel scroll must cancel the older index
// navigation's listRefresh / smooth-target retry subscriptions. Otherwise upward
// user input stops the native animation but a late measurement replays the jump.
// WebKit also clamps scrollTop while React removes range items before updating
// the list padding. Project the virtualizer's existing totalListHeight + deviation
// as an absolute, non-measuring viewport child, keeping the scroll extent intact
// through that commit. Do NOT constrain the measured list: that hides shrinkage
// from its ResizeObserver. Rows, header and footer still size naturally.
// Remove these patches once upstream passes verify-chat-scroll.mjs.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const patches = {
  "index.mjs": {
    "original": "92312b36ddbba75a6b162389962cb8890bf7faed340bc63201dcd1d439ed1729",
    "repaired": "b46cc9dd63ddb26bd84a59cfb0c31c71a9b462a0845fc964c08998c44219eca8",
    "changes": [
      [
        "      scrollTo: d,\n      smoothScrollTargetReached: m,",
        "      scrollTo: d,\n      scrollBy: cancelOnScrollBy,\n      smoothScrollTargetReached: m,"
      ],
      [
        "    return L(\n      I(\n        T,\n        $(n, x, o, R, l, i, p),",
        "    Y(cancelOnScrollBy, S);\n    return L(\n      I(\n        T,\n        $(n, x, o, R, l, i, p),"
      ],
      [
        "const fr = ({ children: t }) => {",
        "const fr = ({ children: t }) => {\n  const scrollExtent = A(\"totalListHeight\") + A(\"deviation\");"
      ],
      [
        "style: Jt(r), children: t",
        "style: Jt(r), children: [t, !s && G(\"div\", { \"data-virtuoso-scroll-extent\": true, \"aria-hidden\": true, style: { position: \"absolute\", top: 0, height: scrollExtent, width: 1, pointerEvents: \"none\" } })]"
      ]
    ],
    "previous": "a0e01cf265391f9d99d0baa496b6f75d93caf6c5e8217f4f3912667029fbc1a7"
  },
  "index.cjs": {
    "original": "47bb8592d307cb2847ceec6d5a0a8661004a99344a42c46c30007d0f120b71b7",
    "repaired": "a45404b8f7a090805439919cf418149a32b0a923d56475a4ae278cc35c183571",
    "changes": [
      [
        "scrollingInProgress:c,scrollTo:d,smoothScrollTargetReached:m,viewportHeight:I",
        "scrollingInProgress:c,scrollTo:d,scrollBy:cancelOnScrollBy,smoothScrollTargetReached:m,viewportHeight:I"
      ],
      [
        "j(c,!1)}return L(x(T,D(n,I,o,E,l,i,p)",
        "j(c,!1)}Y(cancelOnScrollBy,S);return L(x(T,D(n,I,o,E,l,i,p)"
      ],
      [
        "const ar=({children:t})=>{",
        "const ar=({children:t})=>{const scrollExtent=A(\"totalListHeight\")+A(\"deviation\");"
      ],
      [
        "style:Zt(r),children:t",
        "style:Zt(r),children:[t,!s&&V.jsx(\"div\",{\"data-virtuoso-scroll-extent\":true,\"aria-hidden\":true,style:{position:\"absolute\",top:0,height:scrollExtent,width:1,pointerEvents:\"none\"}})]"
      ]
    ],
    "previous": "6bf9bd817e5ba78198f9b83370d65b8ea6b04c02b999ec98acf925779f867af6"
  }
};
const digest = source => createHash('sha256').update(source).digest('hex');

export function patchReactVirtuoso(directory, check = false) {
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.name !== 'react-virtuoso' || metadata.version !== '4.18.3') {
    throw new Error('Chat scroll repair requires react-virtuoso 4.18.3. Review the scroll regressions before upgrading.');
  }
  const pending = Object.entries(patches).flatMap(([name, patch]) => {
    const path = resolve(directory, 'dist', name), source = readFileSync(path, 'utf8');
    if (digest(source) === patch.repaired) return [];
    if (digest(source) !== patch.original && digest(source) !== patch.previous) throw new Error('Unexpected react-virtuoso bytes: ' + name);
    if (check) throw new Error('Chat scroll repair is missing. Run npm run postinstall.');
    const result = patch.changes.reduce((text, [from, to]) => text.includes(to) ? text : text.replace(from, to), source);
    if (digest(result) !== patch.repaired) throw new Error('Chat scroll repair mismatch: ' + name);
    return [{ path, result }];
  });
  for (const { path, result } of pending) writeFileSync(path, result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  patchReactVirtuoso(resolve(import.meta.dirname, '../node_modules/react-virtuoso'), process.argv.includes('--check'));
}
