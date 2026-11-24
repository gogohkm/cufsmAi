// DOM snapshot helpers: every input value + visible text of the three working tabs (each made visible in turn)
async function snapshot(ctx) {
  return ctx.eval(`(()=>{const NL=String.fromCharCode(10); const inputs={};
    document.querySelectorAll('input,select,textarea').forEach((e,i)=>{ if(e.closest('#node-table,#elem-table,.node-table,.elem-table')) return;
      if(!e.id && !e.className) return; const key=e.id || (e.className+'['+(e.dataset.idx||i)+']'); inputs[key]= e.type==='checkbox'? (e.checked?'[x]':'[ ]') : e.value;});
    const texts={}; const act=document.querySelector('.tab-panel.active');
    ['tab-loads','tab-design','tab-connection'].forEach(t=>{const el=document.getElementById(t); if(!el){texts[t]=[];return;}
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active')); el.classList.add('active');
      texts[t]= el.innerText.split(NL).map(s=>s.trim()).filter(Boolean); el.classList.remove('active');});
    if(act) act.classList.add('active');
    return {inputs, texts};})()`);
}
function diff(a, b) {
  const inp = [];
  const keys = new Set([...Object.keys(a.inputs), ...Object.keys(b.inputs)]);
  for (const k of keys) {
    const x = a.inputs[k], y = b.inputs[k];
    if (x === y) { continue; }
    const nx = parseFloat(x), ny = parseFloat(y);
    if (x !== '' && y !== '' && isFinite(nx) && isFinite(ny) && Math.abs(nx - ny) <= 1e-9 * Math.max(1, Math.abs(nx))) { continue; }
    inp.push([k, x, y]);
  }
  const txt = {};
  for (const t of Object.keys(a.texts)) {
    const A = a.texts[t], B = b.texts[t];
    const sa = new Set(A), sb = new Set(B);
    txt[t] = { onlyBefore: A.filter((x) => !sb.has(x)).slice(0, 40), onlyAfter: B.filter((x) => !sa.has(x)).slice(0, 40), nBefore: A.length, nAfter: B.length };
  }
  return { inp, txt };
}
module.exports = { snapshot, diff };
