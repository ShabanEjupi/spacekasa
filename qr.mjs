// Kod QR — i vizatuar këtu, pa asnjë varësi.
//
// 🚨 PSE JO NJË BIBLIOTEKË: posteri i një partneri shtypet një herë dhe rri te
// dera e një biznesi për muaj me radhë. Nëse QR-i është i gabuar, askush nuk e
// merr vesh — skanimi thjesht nuk hap asgjë, dhe partneri mendon se produkti
// nuk shitet. Prandaj kodi vizatohet nga një zbatim i lexueshëm, dhe DEKODOHET
// prapa te provat: `test-qr.mjs` e lexon çdo QR që prodhon dhe kërkon të njëjtin
// varg. Një `npm i qrcode` do të kishte qenë më e shkurtër dhe e paprovueshme
// nga ne.
//
// Mbulon vetëm atë që na duhet: modaliteti bajt, nivel korrigjimi Q (25% — një
// poster te dera merr gishta dhe diell), versionet 1–10. Një URL partneri është
// ~46 shenja, pra hyn te versioni 3–4.

// ── Fusha e Galois-ë GF(256) për Reed–Solomon ──────────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;      // polinomi i QR-it
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const shumezo = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function polinomiGjenerues(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const g2 = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      g2[j] ^= shumezo(g[j], EXP[i]);
      g2[j + 1] ^= g[j];
    }
    g = g2;
  }
  return g;
}

function korrigjimi(bajtet, n) {
  const g = polinomiGjenerues(n);
  const r = new Array(bajtet.length + n).fill(0);
  bajtet.forEach((b, i) => { r[i] = b; });
  for (let i = 0; i < bajtet.length; i++) {
    const c = r[i];
    if (c === 0) continue;
    for (let j = 0; j < g.length; j++) r[i + j] ^= shumezo(g[j], c);
  }
  return r.slice(bajtet.length);
}

// ── Kapaciteti: [version][EC=Q] → {bajteTeDhenash, blloqe:[[numër, bajte]…]} ──
// Vetëm niveli Q, versionet 1–10. Numrat vijnë nga tabelat e ISO/IEC 18004.
const TABELA = {
  1: { data: 13, ec: 13, grupet: [[1, 13]] },
  2: { data: 22, ec: 22, grupet: [[1, 22]] },
  3: { data: 34, ec: 18, grupet: [[2, 17]] },
  4: { data: 48, ec: 26, grupet: [[2, 24]] },
  5: { data: 62, ec: 18, grupet: [[2, 15], [2, 16]] },
  6: { data: 76, ec: 24, grupet: [[4, 19]] },
  7: { data: 88, ec: 18, grupet: [[2, 14], [4, 15]] },
  8: { data: 110, ec: 22, grupet: [[4, 18], [2, 19]] },
  9: { data: 132, ec: 20, grupet: [[4, 16], [4, 17]] },
  10: { data: 154, ec: 24, grupet: [[6, 19], [2, 20]] },
};

const INFO_FORMATI = {
  // niveli Q = 0b11, për të tetë maskat; vlerat përfundimtare (15 bit) nga standardi
  0: 0x355f, 1: 0x3068, 2: 0x3f31, 3: 0x3a06,
  4: 0x24b4, 5: 0x2183, 6: 0x2eda, 7: 0x2bed,
};

const INFO_VERSIONI = {
  7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3,
};

function zgjidhVersionin(gjatesia) {
  for (let v = 1; v <= 10; v++) {
    // 4 bit modalitet + numërues (8 bit për v1–9, 16 për v10+) + të dhënat
    const numeruesi = v <= 9 ? 8 : 16;
    if (Math.ceil((4 + numeruesi) / 8) + gjatesia <= TABELA[v].data) return v;
  }
  throw new Error('vargu është shumë i gjatë për versionin 10 te niveli Q');
}

function bitetEBajteve(teksti) {
  const bajtet = [...Buffer.from(teksti, 'utf8')];
  const v = zgjidhVersionin(bajtet.length);
  const numeruesi = v <= 9 ? 8 : 16;
  const bit = [];
  const shto = (vlera, n) => { for (let i = n - 1; i >= 0; i--) bit.push((vlera >> i) & 1); };
  shto(0b0100, 4);                    // modaliteti bajt
  shto(bajtet.length, numeruesi);
  for (const b of bajtet) shto(b, 8);

  const kapaciteti = TABELA[v].data * 8;
  // Përfundimtari: deri në katër zero, pastaj deri te kufiri i bajtit.
  for (let i = 0; i < 4 && bit.length < kapaciteti; i++) bit.push(0);
  while (bit.length % 8) bit.push(0);
  // Mbushja e detyruar nga standardi: 0xEC, 0x11, të alternuara.
  const mbushja = [0xec, 0x11];
  for (let i = 0; bit.length < kapaciteti; i++) shto(mbushja[i % 2], 8);

  const teDhenat = [];
  for (let i = 0; i < bit.length; i += 8) {
    teDhenat.push(parseInt(bit.slice(i, i + 8).join(''), 2));
  }
  return { v, teDhenat };
}

/// Ndan të dhënat në blloqe, llogarit korrigjimin, dhe i thur bashkë.
function fjaletKodit(v, teDhenat) {
  const { grupet, ec } = TABELA[v];
  const blloqetD = [];
  let vendi = 0;
  for (const [sa, gjatesia] of grupet) {
    for (let i = 0; i < sa; i++) {
      blloqetD.push(teDhenat.slice(vendi, vendi + gjatesia));
      vendi += gjatesia;
    }
  }
  const blloqetE = blloqetD.map((b) => korrigjimi(b, ec));
  const out = [];
  const maxD = Math.max(...blloqetD.map((b) => b.length));
  for (let i = 0; i < maxD; i++) {
    for (const b of blloqetD) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const b of blloqetE) out.push(b[i]);
  }
  return out;
}

// ── Matrica ───────────────────────────────────────────────────────────────
const QENDRAT_E_RREGULLIMIT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function matrica(v, fjalet, maska) {
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));
  const rezervo = (r, c, vlera) => { if (r >= 0 && r < n && c >= 0 && c < n) m[r][c] = vlera; };

  const syri = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const brenda = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const zi = brenda && (r === 0 || r === 6 || c === 0 || c === 6
                              || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        rezervo(r0 + r, c0 + c, zi ? 1 : 0);
      }
    }
  };
  syri(0, 0); syri(0, n - 7); syri(n - 7, 0);

  for (const r of QENDRAT_E_RREGULLIMIT[v]) {
    for (const c of QENDRAT_E_RREGULLIMIT[v]) {
      if (m[r][c] !== null) continue;           // mos e vër mbi një sy
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const zi = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          rezervo(r + dr, c + dc, zi ? 1 : 0);
        }
      }
    }
  }

  for (let i = 8; i < n - 8; i++) {
    const zi = i % 2 === 0 ? 1 : 0;
    if (m[6][i] === null) m[6][i] = zi;
    if (m[i][6] === null) m[i][6] = zi;
  }
  m[n - 8][8] = 1;                              // moduli gjithmonë i zi

  // Vendet e formatit rezervohen para se të mbushen të dhënat.
  const vendetEFormatit = [];
  for (let i = 0; i <= 5; i++) vendetEFormatit.push([8, i], [i, 8]);
  vendetEFormatit.push([8, 7], [8, 8], [7, 8]);
  for (let i = 0; i < 8; i++) vendetEFormatit.push([8, n - 1 - i]);
  for (let i = 0; i < 7; i++) vendetEFormatit.push([n - 1 - i, 8]);
  for (const [r, c] of vendetEFormatit) if (m[r][c] === null) m[r][c] = 0;

  if (v >= 7) {
    for (let i = 0; i < 18; i++) {
      const bit = (INFO_VERSIONI[v] >> i) & 1;
      m[Math.floor(i / 3)][n - 11 + (i % 3)] = bit;
      m[n - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }

  // Mbushja zigzag, nga poshtë-djathtas.
  const MASKAT = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  const perdorura = m.map((rr) => rr.map((x) => x !== null));
  let bit = 0;
  const teGjithaBitet = [];
  for (const b of fjalet) for (let i = 7; i >= 0; i--) teGjithaBitet.push((b >> i) & 1);

  let lart = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;                            // kolona e kohëmatësit kapërcehet
    for (let i = 0; i < n; i++) {
      const r = lart ? n - 1 - i : i;
      for (const cc of [c, c - 1]) {
        if (perdorura[r][cc]) continue;
        const v0 = bit < teGjithaBitet.length ? teGjithaBitet[bit++] : 0;
        m[r][cc] = MASKAT[maska](r, cc) ? v0 ^ 1 : v0;
      }
    }
    lart = !lart;
  }

  // 🚨🚨 Informacioni i formatit shkruhet DY herë, dhe kopja e dytë NUK është
  // pasqyrë e së parës.
  //
  // Deri më 19-08-2026 këtu rrinin dy rreshta që i kishin këmbyer rreshtin me
  // shtyllën: bitet 0–7 shkonin te SHTYLLA 8 dhe bitet 6–0 te RRESHTI 8. Kopja
  // e parë ishte e saktë, ndaj çdo skaner që lexon të parën — pra pothuaj të
  // gjithë — e lexonte kodin pa u ankuar. Dhe rreshti i parë shkruante mbi
  // `m[n-8][8]`, MODULIN GJITHMONË TË ERRËT, duke e prishur atë sa herë biti 7
  // ishte zero.
  //
  // 🔑 Asnjë provë «a doli një SVG» nuk e sheh këtë. E kapi vetëm prova që mat
  // strukturën ndaj standardit, jo ndaj vetes.
  //
  // Vendet (n = ana): kopja 2 = bitet 0–7 te RRESHTI 8, shtyllat n-1 → n-8;
  // bitet 8–14 te SHTYLLA 8, rreshtat n-7 → n-1. Moduli i errët rri i fundit,
  // që asnjë nga të dy ciklet të mos e prekë.
  const f = INFO_FORMATI[maska];
  for (let i = 0; i <= 5; i++) m[8][i] = (f >> (14 - i)) & 1;
  m[8][7] = (f >> 8) & 1;
  m[8][8] = (f >> 7) & 1;
  m[7][8] = (f >> 6) & 1;
  for (let i = 9; i <= 14; i++) m[14 - i][8] = (f >> (14 - i)) & 1;
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = (f >> i) & 1;
  for (let i = 8; i <= 14; i++) m[n - 15 + i][8] = (f >> i) & 1;
  m[n - 8][8] = 1;

  return m;
}

/// Kthen matricën 0/1 të kodit për `teksti`.
export function moduletE(teksti, maska = 0) {
  const { v, teDhenat } = bitetEBajteve(teksti);
  return matrica(v, fjaletKodit(v, teDhenat), maska);
}

/// SVG i pastër, pa varësi dhe pa fontë: një rrugë e vetme me katrorë.
/// 🔑 `shape-rendering="crispEdges"` — pa të, disa shtypës i lëmojnë skajet e
/// moduleve dhe skaneri nuk e lexon më kodin.
export function svg(teksti, { madhesia = 320, kufi = 4 } = {}) {
  const m = moduletE(teksti);
  const n = m.length;
  const gjithsej = n + kufi * 2;
  let rruga = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) rruga += `M${c + kufi} ${r + kufi}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${madhesia}" height="${madhesia}" `
       + `viewBox="0 0 ${gjithsej} ${gjithsej}" shape-rendering="crispEdges" role="img" `
       + `aria-label="Kod QR">`
       + `<rect width="${gjithsej}" height="${gjithsej}" fill="#fff"/>`
       + `<path d="${rruga}" fill="#000"/></svg>`;
}
