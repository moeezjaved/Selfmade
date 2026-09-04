/**
 * Visual-editor runtime — injected INTO the assembled page (inside the preview iframe) only when the
 * page is opened in the click-anywhere editor. It turns the live page into the editing surface:
 *   • hover → highlight the editable element (text / image / section)
 *   • click text  → edit inline (contenteditable) with a floating Bold(=accent) toolbar
 *   • click image → ask the parent to open the Upload / Generate / Swap popover
 *   • hover section → a rail to move ▲▼, duplicate ⧉, or delete 🗑; a ＋ between sections to add one
 *   • getHTML → hand the parent a CLEAN copy of the page (all editor chrome stripped) to save/publish
 *
 * The parent (BuilderEditor.tsx) and this runtime talk over postMessage. Published/preview HTML never
 * includes any of this — see assembleEditorDocument(). Vanilla JS in a string so it runs in the iframe.
 */

export const EDITOR_CSS = `
  /* editor chrome — never shipped to a published page */
  [data-ed-hover]{outline:2px solid var(--accent,#d6248f)!important;outline-offset:2px;border-radius:4px;cursor:text}
  [data-ed-img]{cursor:pointer}
  [data-ed-hover][data-ed-img]{outline-style:dashed!important;cursor:pointer}
  [contenteditable=true]{outline:2px solid var(--accent,#d6248f)!important;outline-offset:2px;cursor:text}
  [contenteditable=true]:focus{outline:2px solid var(--accent,#d6248f)!important}
  .ed-secwrap{position:relative}
  .ed-secwrap[data-ed-sechover]{box-shadow:inset 0 0 0 2px rgba(37,99,235,.5);border-radius:6px}
  .ed-secwrap.ed-drag-src{opacity:.4}
  /* a clean light toolbar (Notion/Webflow-style) — appears top-right on section hover */
  .ed-rail{position:absolute;top:10px;right:10px;z-index:9999;display:none;align-items:center;gap:1px;background:#fff;border:1px solid rgba(20,18,15,.1);border-radius:11px;padding:3px;box-shadow:0 8px 24px -8px rgba(20,18,15,.35)}
  .ed-secwrap[data-ed-sechover] > .ed-rail{display:flex}
  .ed-rail button{all:unset;color:#4a4653;min-width:30px;height:30px;display:grid;place-items:center;border-radius:8px;font-size:15px;cursor:pointer;line-height:1}
  .ed-rail button:hover{background:#f0edf6;color:#181720}
  .ed-rail .grip{cursor:grab;color:#9891a6;font-size:16px;letter-spacing:-2px}
  .ed-rail .grip:active{cursor:grabbing}
  .ed-rail .sep{width:1px;height:18px;background:rgba(20,18,15,.1);margin:0 2px}
  .ed-rail .del:hover{background:#fdecec;color:#c0392b}
  /* the insertion line shown while dragging a section */
  .ed-drop{position:fixed;height:3px;background:var(--accent,#d6248f);border-radius:3px;z-index:100000;pointer-events:none;box-shadow:0 0 0 3px rgba(214,36,143,.18)}
  body.ed-dragging, body.ed-dragging *{cursor:grabbing !important;user-select:none !important}
  /* ＋ add-a-section button that appears between sections */
  .ed-add{position:relative;height:0;z-index:9998}
  .ed-add > button{position:absolute;left:50%;top:-15px;transform:translateX(-50%);background:var(--accent,#d6248f);color:#fff;border:none;border-radius:100px;height:30px;padding:0 16px;font-size:13px;font-weight:700;cursor:pointer;opacity:0;transition:opacity .12s;box-shadow:0 4px 14px -4px rgba(0,0,0,.4);white-space:nowrap}
  .ed-add:hover > button{opacity:1}
  .ed-toolbar{position:fixed;z-index:10000;display:none;gap:2px;background:#111;border-radius:9px;padding:4px;box-shadow:0 8px 24px -6px rgba(0,0,0,.5)}
  .ed-toolbar button{all:unset;color:#fff;min-width:28px;height:28px;display:grid;place-items:center;border-radius:6px;font-size:14px;font-weight:800;cursor:pointer;padding:0 6px}
  .ed-toolbar button:hover{background:rgba(255,255,255,.16)}
  .ed-img-badge{position:absolute;inset:0;display:none;place-items:center;pointer-events:none}
  .pgbld [data-ed-imgwrap]{position:relative}
`

export const EDITOR_JS = `
(function(){
  var EDITABLE_TEXT = 'H1,H2,H3,H4,H5,H6,P,LI,A,SPAN,SUMMARY,BUTTON,STRONG,EM,DIV,BLOCKQUOTE,FIGCAPTION';
  var dirty=false, uid=0;
  function post(m){ try{ parent.postMessage(Object.assign({__pgbld:1}, m),'*'); }catch(e){} }
  function markDirty(){ if(!dirty){dirty=true;} post({t:'dirty'}); }
  function eid(el){ if(!el.dataset.eid){ el.dataset.eid='e'+(++uid); } return el.dataset.eid; }

  // ── which elements are directly text-editable: a leaf that carries visible text and whose only
  // children (if any) are inline formatting. Skip elements that contain block children (they're layout). ──
  function isTextLeaf(el){
    if(!el || el.nodeType!==1) return false;
    if(!EDITABLE_TEXT.split(',').includes(el.tagName)) return false;
    if(el.closest('.ed-rail,.ed-toolbar,.ed-add')) return false;
    if(el.querySelector('img,svg,input,textarea,select,details')) return false;
    // has block-level element children? then it's a container, not a text leaf
    for(var i=0;i<el.children.length;i++){ var c=el.children[i]; var d=getComputedStyle(c).display; if(d!=='inline'&&d!=='inline-block'&&c.tagName!=='STRONG'&&c.tagName!=='EM'&&c.tagName!=='BR'&&c.tagName!=='SPAN'&&c.tagName!=='A') return false; }
    return (el.textContent||'').trim().length>0;
  }
  function isImg(el){ return el && el.nodeType===1 && el.tagName==='IMG'; }

  // ── hover highlight ──
  var hovered=null;
  document.addEventListener('mouseover', function(e){
    if(editing) return;
    var t=e.target;
    var img=t.closest('img');
    var leaf=img?null:closestLeaf(t);
    var el=img||leaf;
    if(el!==hovered){ clearHover(); hovered=el; if(el){ el.setAttribute('data-ed-hover',''); if(img) el.setAttribute('data-ed-img',''); } }
  }, true);
  function clearHover(){ if(hovered){ hovered.removeAttribute('data-ed-hover'); hovered.removeAttribute('data-ed-img'); hovered=null; } }
  function closestLeaf(t){ var el=t; for(var i=0;i<6&&el;i++){ if(isTextLeaf(el)) return el; el=el.parentElement; } return null; }

  // ── click: image → parent popover;  text → inline edit ──
  var editing=null;
  document.addEventListener('click', function(e){
    var img=e.target.closest('img');
    if(img){ e.preventDefault(); e.stopPropagation(); selectImage(img); return; }
    var leaf=closestLeaf(e.target);
    if(leaf){ if(leaf.tagName==='A'||leaf.closest('a')) e.preventDefault(); startEdit(leaf, e); }
  }, true);

  function selectImage(img){ clearHover(); post({t:'image', id:eid(img), src:img.currentSrc||img.src}); }

  function startEdit(el, e){
    if(editing===el) return;
    stopEdit();
    editing=el; clearHover();
    el.setAttribute('contenteditable','true');
    el.focus();
    // place caret where clicked
    try{ var r=document.caretRangeFromPoint?document.caretRangeFromPoint(e.clientX,e.clientY):null; if(r){ var s=getSelection(); s.removeAllRanges(); s.addRange(r);} }catch(_){}
    showToolbar(el);
    el.addEventListener('input', markDirty);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', stopEdit, {once:true});
  }
  function onKey(ev){
    if(ev.key==='Escape'){ ev.preventDefault(); stopEdit(); }
    // single-line fields (headings, labels, buttons) commit on Enter
    if(ev.key==='Enter' && ['H1','H2','H3','H4','H5','H6','A','BUTTON','SUMMARY','SPAN','LI'].includes(editing.tagName) && !ev.shiftKey){ ev.preventDefault(); stopEdit(); }
  }
  function stopEdit(){
    if(!editing) return;
    var el=editing; editing=null;
    el.removeEventListener('input', markDirty);
    el.removeEventListener('keydown', onKey);
    el.removeAttribute('contenteditable');
    hideToolbar();
  }

  // ── floating toolbar (Bold = wrap in <strong> = the accent word) ──
  var tb;
  function toolbar(){ if(tb) return tb; tb=document.createElement('div'); tb.className='ed-toolbar';
    tb.innerHTML='<button data-cmd="bold" title="Accent (bold)">B</button><button data-cmd="italic" title="Italic" style="font-style:italic;font-weight:600">i</button>';
    tb.addEventListener('mousedown', function(ev){ ev.preventDefault(); var c=ev.target.getAttribute('data-cmd'); if(c){ document.execCommand(c,false,null); markDirty(); } });
    document.body.appendChild(tb); return tb; }
  function showToolbar(el){ var t=toolbar(); var r=el.getBoundingClientRect(); t.style.display='flex'; t.style.left=Math.max(8,r.left)+'px'; t.style.top=Math.max(8,r.top-40)+'px'; }
  function hideToolbar(){ if(tb) tb.style.display='none'; }

  // ── sections: wrap every top-level section so we can hover a rail + insert ＋ between them ──
  function sectionHosts(){
    var hosts=[];
    var pg=document.querySelector('.pgbld'); if(!pg) return hosts;
    // direct children of .pgbld (full-bleed bands) and of .pgbld .wrap (contained sections)
    Array.prototype.forEach.call(pg.children, function(c){ if(c.classList.contains('wrap')){ Array.prototype.forEach.call(c.children, function(w){ hosts.push(w); }); } else if(!c.classList.contains('floatcta')) hosts.push(c); });
    return hosts;
  }
  function buildSections(){
    sectionHosts().forEach(function(sec){
      if(sec.classList.contains('ed-secwrap')||sec.classList.contains('ed-add')) return;
      sec.classList.add('ed-secwrap');
      eid(sec);
      var rail=document.createElement('div'); rail.className='ed-rail'; rail.contentEditable='false';
      rail.innerHTML='<button class="grip" title="Drag to move this section">⠿</button><span class="sep"></span>'
        +'<button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button>'
        +'<span class="sep"></span><button data-a="dupe" title="Duplicate">⧉</button><button class="del" data-a="del" title="Delete">🗑</button>';
      rail.addEventListener('click', function(ev){ ev.stopPropagation(); ev.preventDefault(); var a=(ev.target.getAttribute&&ev.target.getAttribute('data-a')); if(a) sectionAction(sec,a); });
      // drag-to-reorder from the grip handle (Notion/Webflow-style)
      var grip=rail.querySelector('.grip');
      grip.addEventListener('pointerdown', function(ev){ ev.preventDefault(); ev.stopPropagation(); startDrag(sec, grip, ev); });
      sec.appendChild(rail);
      // a ＋ divider (Notion/Framer-style) in the gap ABOVE this section → asks the parent to add here
      if(!(sec.previousElementSibling&&sec.previousElementSibling.classList.contains('ed-add'))){
        var add=document.createElement('div'); add.className='ed-add'; add.contentEditable='false';
        add.innerHTML='<button title="Add a section here">＋ Add section here</button>';
        add.querySelector('button').addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); post({t:'addAt', anchorId:eid(sec)}); });
        sec.parentNode.insertBefore(add, sec);
      }
    });
  }
  document.addEventListener('mouseover', function(e){ if(dragEl) return; var s=e.target.closest('.ed-secwrap'); document.querySelectorAll('.ed-secwrap[data-ed-sechover]').forEach(function(x){ if(x!==s) x.removeAttribute('data-ed-sechover'); }); if(s) s.setAttribute('data-ed-sechover',''); }, true);

  function siblingSections(sec){ return Array.prototype.filter.call((sec.parentNode||document).children, function(c){ return c.classList.contains('ed-secwrap'); }); }
  function sectionAction(sec, a){
    if(a==='del'){ if(confirm('Delete this section?')){ sec.remove(); markDirty(); } }
    else if(a==='up'){ var p=sec.previousElementSibling; while(p&&!p.classList.contains('ed-secwrap')) p=p.previousElementSibling; if(p){ sec.parentNode.insertBefore(sec,p); markDirty(); sec.scrollIntoView({behavior:'smooth',block:'center'}); } }
    else if(a==='down'){ var n=sec.nextElementSibling; while(n&&!n.classList.contains('ed-secwrap')) n=n.nextElementSibling; if(n){ sec.parentNode.insertBefore(n,sec); markDirty(); sec.scrollIntoView({behavior:'smooth',block:'center'}); } }
    else if(a==='dupe'){ var clone=sec.cloneNode(true); clone.removeAttribute('data-eid'); eid(clone); sec.parentNode.insertBefore(clone, sec.nextSibling); markDirty(); }
  }

  // ── drag-to-reorder ──
  var dragEl=null, dropLine=null, dropTarget=null, dropPos='before';
  function startDrag(sec, grip, ev){
    dragEl=sec; dropTarget=null;
    sec.classList.add('ed-drag-src');
    document.body.classList.add('ed-dragging');
    document.querySelectorAll('.ed-secwrap[data-ed-sechover]').forEach(function(x){ x.removeAttribute('data-ed-sechover'); });
    try{ grip.setPointerCapture(ev.pointerId); }catch(_){}
    dropLine=document.createElement('div'); dropLine.className='ed-drop'; document.body.appendChild(dropLine);
    grip.addEventListener('pointermove', onDrag);
    grip.addEventListener('pointerup', endDrag, {once:true});
    grip.addEventListener('pointercancel', endDrag, {once:true});
  }
  function onDrag(ev){
    if(!dragEl) return;
    // only reorder within the same container (keeps full-bleed bands vs contained sections in their lane)
    var sibs=siblingSections(dragEl).filter(function(s){ return s!==dragEl; });
    var y=ev.clientY, chosen=null, pos='after';
    for(var i=0;i<sibs.length;i++){ var r=sibs[i].getBoundingClientRect(); if(y < r.top + r.height/2){ chosen=sibs[i]; pos='before'; break; } }
    if(!chosen && sibs.length){ chosen=sibs[sibs.length-1]; pos='after'; }
    dropTarget=chosen; dropPos=pos;
    if(chosen && dropLine){ var rr=chosen.getBoundingClientRect(); dropLine.style.left=rr.left+'px'; dropLine.style.width=rr.width+'px'; dropLine.style.top=((pos==='before'?rr.top:rr.bottom)-1.5)+'px'; dropLine.style.display='block'; }
    else if(dropLine){ dropLine.style.display='none'; }
    // auto-scroll near edges
    var vh=window.innerHeight; if(y<70) window.scrollBy(0,-14); else if(y>vh-70) window.scrollBy(0,14);
  }
  function endDrag(){
    if(dragEl){
      dragEl.classList.remove('ed-drag-src');
      if(dropTarget && dropTarget!==dragEl){ if(dropPos==='before') dropTarget.parentNode.insertBefore(dragEl,dropTarget); else dropTarget.parentNode.insertBefore(dragEl,dropTarget.nextSibling); markDirty(); dragEl.scrollIntoView({behavior:'smooth',block:'center'}); }
    }
    document.body.classList.remove('ed-dragging');
    if(dropLine){ dropLine.remove(); dropLine=null; }
    dragEl=null; dropTarget=null;
  }

  // ── receive commands from the parent ──
  window.addEventListener('message', function(ev){
    var m=ev.data||{}; if(!m.__pgbldCmd) return;
    if(m.t==='getHTML'){ post({t:'html', reqId:m.reqId, html:cleanHTML()}); }
    else if(m.t==='setImage'){ var el=document.querySelector('[data-eid="'+m.id+'"]'); if(el){ el.src=m.src; el.removeAttribute('srcset'); el.classList.remove('ph'); markDirty(); } }
    else if(m.t==='insertBlock'){ insertBlock(m.html, m.anchorId, m.position); }
    else if(m.t==='reindex'){ buildSections(); }
  });

  function insertBlock(html, anchorId, position){
    var host=document.querySelector('.pgbld .wrap')||document.querySelector('.pgbld'); if(!host) return;
    var tmp=document.createElement('div'); tmp.innerHTML=html; var node=tmp.firstElementChild; if(!node) return;
    var anchor=anchorId?document.querySelector('[data-eid="'+anchorId+'"]'):null;
    if(anchor && anchor.parentNode){ if(position==='before') anchor.parentNode.insertBefore(node,anchor); else anchor.parentNode.insertBefore(node, anchor.nextSibling); }
    else host.appendChild(node);
    buildSections(); markDirty();
    node.scrollIntoView({behavior:'smooth', block:'center'});
  }

  // ── produce a clean copy of the page for saving (strip ALL editor chrome) ──
  function cleanHTML(){
    var pg=document.querySelector('.pgbld'); if(!pg) return '';
    var clone=pg.cloneNode(true);
    clone.querySelectorAll('.ed-rail,.ed-toolbar,.ed-add').forEach(function(x){ x.remove(); });
    clone.querySelectorAll('[contenteditable]').forEach(function(x){ x.removeAttribute('contenteditable'); });
    clone.querySelectorAll('[data-ed-hover]').forEach(function(x){ x.removeAttribute('data-ed-hover'); });
    clone.querySelectorAll('[data-ed-img]').forEach(function(x){ x.removeAttribute('data-ed-img'); });
    clone.querySelectorAll('[data-eid]').forEach(function(x){ x.removeAttribute('data-eid'); });
    clone.querySelectorAll('[data-ed-sechover]').forEach(function(x){ x.removeAttribute('data-ed-sechover'); });
    clone.querySelectorAll('.ed-secwrap').forEach(function(x){ x.classList.remove('ed-secwrap'); });
    return clone.outerHTML;
  }

  buildSections();
  post({t:'ready'});
})();
`

/** The <style>+<script> to inject before </body> in the editor document (never in a published page). */
export function editorChrome(): string {
  return `<style>${EDITOR_CSS}</style><script>${EDITOR_JS}</script>`
}
