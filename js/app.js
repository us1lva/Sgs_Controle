// ============================================================================
// Conexão com o Supabase (mesmo projeto/banco usado pelo portal do colaborador).
// ============================================================================
const SUPABASE_URL = 'https://nstyvsaolpwpqpigqsou.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZOU6Hpt3lUmQVBcPKL7Wyg_mxaLxEjx';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// MELHORIAS VISUAIS — fundo animado (canvas) e microinterações.
// Os estilos ficam no fim do style.css (seção "MELHORIAS"). Prefixo "mx-".
// Para desligar: apague este bloco e a chamada posRender() dentro de render().
// ============================================================================
(function iniciarMelhorias(){
  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const html = document.documentElement;
  const ondas = [];          // ondas de choque (clique)
  let wrapBg = null;

  // ---------- Fundo: manchas de luz + canvas ----------
  function montar(){
    if(document.querySelector('.mx-bg')) return;

    // Garante a ordem de empilhamento mesmo se o CSS novo não carregar:
    // o fundo (z-index 0) sempre fica ATRÁS do app (z-index 1).
    const appEl = document.getElementById('app');
    if(appEl){ appEl.style.position = 'relative'; appEl.style.zIndex = '1'; }

    wrapBg = document.createElement('div');
    wrapBg.className = 'mx-bg';
    wrapBg.setAttribute('aria-hidden', 'true');
    wrapBg.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';
    wrapBg.innerHTML = '<i></i><i></i><i></i>';
    document.body.insertBefore(wrapBg, document.body.firstChild);

    // Quem prefere menos movimento fica só com as manchas estáticas.
    if(reduz) return;

    // Canvas sobre a malha de 32px do body. Tudo acontece nos cruzamentos:
    //  - mouse ilumina linhas e nós; clique dispara uma onda de choque;
    //  - a cada ~11s um scanner varre a tela (leitor de código de barras);
    //  - "empilhadeiras" (AGVs) percorrem as linhas da malha deixando rastro
    //    e um ping em alguns cruzamentos; nós piscam sozinhos.
    const cv = document.createElement('canvas');
    cv.id = 'mx-canvas';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    document.body.insertBefore(cv, wrapBg.nextSibling);
    const ctx = cv.getContext('2d');

    const GAP = 32;                         // igual ao background-size do body
    const RAIO = 190, BANDA = 90, CICLO = 11000, DUR = 3200;
    const TRILHA = 650, ONDA_DUR = 950, ONDA_VEL = 0.5;
    let W = 0, H = 0, ambiente = [], agvs = [], pings = [], ultimo = 0;
    const mouse = { x: -9999, y: -9999, ax: -9999, ay: -9999, ativo: false };

    function escolher(a){
      const todas = [[1,0],[-1,0],[0,1],[0,-1]];
      const sem_re = todas.filter(d => !((a.dx || a.dy) && d[0] === -a.dx && d[1] === -a.dy));
      const ok = sem_re.filter(d => {
        const nx = a.x + d[0] * GAP, ny = a.y + d[1] * GAP;
        return nx > GAP / 2 && nx < W - GAP / 2 && ny > GAP / 2 && ny < H - GAP / 2;
      });
      const reto = ok.find(d => d[0] === a.dx && d[1] === a.dy);
      const d = (reto && Math.random() < .68) ? reto : (ok[Math.floor(Math.random() * ok.length)] || sem_re[0]);
      a.dx = d[0]; a.dy = d[1]; a.tx = a.x + a.dx * GAP; a.ty = a.y + a.dy * GAP;
    }

    function redimensionar(){
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.floor(W / GAP), rows = Math.floor(H / GAP);
      const pos = () => [(1 + Math.floor(Math.random() * (cols - 1))) * GAP + .5, (1 + Math.floor(Math.random() * (rows - 1))) * GAP + .5];

      const n = Math.max(8, Math.min(22, Math.round(W * H / 90000)));
      ambiente = [];
      for(let i = 0; i < n; i++){
        const p = pos();
        ambiente.push({ x: p[0], y: p[1], fase: Math.random() * 7000, periodo: 3800 + Math.random() * 3600 });
      }
      const m = Math.max(3, Math.min(7, Math.round(W * H / 260000)));
      agvs = [];
      for(let i = 0; i < m; i++){
        const p = pos();
        const a = { x: p[0], y: p[1], tx: p[0], ty: p[1], dx: 0, dy: 0, v: 55 + Math.random() * 60, trilha: [] };
        escolher(a); agvs.push(a);
      }
    }

    function moverAgvs(t, dt){
      for(const a of agvs){
        let passo = a.v * dt / 1000;
        while(passo > 0){
          const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.abs(dx) + Math.abs(dy);
          if(dist <= passo){
            a.x = a.tx; a.y = a.ty; passo -= dist;
            if(Math.random() < .4) pings.push({ x: a.x, y: a.y, t0: t });
            escolher(a);
          } else { a.x += Math.sign(dx) * passo; a.y += Math.sign(dy) * passo; passo = 0; }
        }
        a.trilha.push({ x: a.x, y: a.y, t });
        while(a.trilha.length && t - a.trilha[0].t > TRILHA) a.trilha.shift();
      }
    }

    function desenhar(t){
      const dt = Math.min(ultimo ? t - ultimo : 16, 64); ultimo = t;
      const A = html.getAttribute('data-theme') === 'light' ? '255,255,255' : '255,255,255';  // linhas claras sobre o laranja SGS
      ctx.clearRect(0, 0, W, H);
      mouse.x += (mouse.ax - mouse.x) * 0.16;
      mouse.y += (mouse.ay - mouse.y) * 0.16;
      moverAgvs(t, dt);

      const fase = t % CICLO;
      const varrendo = fase < DUR;
      const scanY = varrendo ? -BANDA + (fase / DUR) * (H + BANDA * 2) : -9999;

      // Mouse: brilho suave + linhas da malha acesas em degradê.
      if(mouse.ativo){
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, RAIO + 40);
        g.addColorStop(0, 'rgba(' + A + ',.10)'); g.addColorStop(1, 'rgba(' + A + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(mouse.x - RAIO - 40, mouse.y - RAIO - 40, (RAIO + 40) * 2, (RAIO + 40) * 2);

        const lg = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, RAIO);
        lg.addColorStop(0, 'rgba(' + A + ',.5)'); lg.addColorStop(1, 'rgba(' + A + ',0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 1; ctx.beginPath();
        for(let c = Math.floor((mouse.x - RAIO) / GAP); c <= Math.ceil((mouse.x + RAIO) / GAP); c++){
          const x = c * GAP + .5; ctx.moveTo(x, mouse.y - RAIO); ctx.lineTo(x, mouse.y + RAIO);
        }
        for(let r = Math.floor((mouse.y - RAIO) / GAP); r <= Math.ceil((mouse.y + RAIO) / GAP); r++){
          const y = r * GAP + .5; ctx.moveTo(mouse.x - RAIO, y); ctx.lineTo(mouse.x + RAIO, y);
        }
        ctx.stroke();
      }

      // Scanner: faixa de luz + linha fina.
      if(varrendo){
        const g = ctx.createLinearGradient(0, scanY - 70, 0, scanY + 70);
        g.addColorStop(0, 'rgba(' + A + ',0)'); g.addColorStop(.5, 'rgba(' + A + ',.09)'); g.addColorStop(1, 'rgba(' + A + ',0)');
        ctx.fillStyle = g; ctx.fillRect(0, scanY - 70, W, 140);
        const l = ctx.createLinearGradient(0, 0, W, 0);
        l.addColorStop(0, 'rgba(' + A + ',0)'); l.addColorStop(.5, 'rgba(' + A + ',.6)'); l.addColorStop(1, 'rgba(' + A + ',0)');
        ctx.fillStyle = l; ctx.fillRect(0, scanY, W, 1.5);
      }

      // Ondas de choque (clique): anel + nós acesos na passagem.
      for(let i = ondas.length - 1; i >= 0; i--){
        const o = ondas[i], idade = Math.max(0, t - o.t0);
        if(idade > ONDA_DUR){ ondas.splice(i, 1); continue; }
        o.r = idade * ONDA_VEL; o.a = 1 - idade / ONDA_DUR;
        ctx.strokeStyle = 'rgba(' + A + ',' + (.55 * o.a).toFixed(3) + ')'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(' + A + ',' + (.25 * o.a).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r * .72, 0, Math.PI * 2); ctx.stroke();
      }

      // Nós (cruzamentos da malha) acesos por mouse, scanner e ondas.
      const cols = Math.ceil(W / GAP) + 1, rows = Math.ceil(H / GAP) + 1;
      for(let r = 0; r < rows; r++){
        const y = r * GAP + .5;
        const dv = varrendo ? Math.abs(y - scanY) : 9999;
        for(let c = 0; c < cols; c++){
          const x = c * GAP + .5;
          let k = 0;
          if(mouse.ativo){
            const dx = x - mouse.x, dy = y - mouse.y, d2 = dx * dx + dy * dy;
            if(d2 < RAIO * RAIO) k = 1 - Math.sqrt(d2) / RAIO;
          }
          if(dv < BANDA) k = Math.max(k, (1 - dv / BANDA) * .9);
          for(let w = 0; w < ondas.length; w++){
            const o = ondas[w], d = Math.abs(Math.hypot(x - o.x, y - o.y) - o.r);
            if(d < 34) k = Math.max(k, (1 - d / 34) * o.a);
          }
          if(k > 0.05){
            const s = 2 + k * 3;
            ctx.fillStyle = 'rgba(' + A + ',' + (.25 + k * .7).toFixed(3) + ')';
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          }
        }
      }

      // Nós "respirando" sozinhos: ponto + anel que se expande.
      for(const n of ambiente){
        const u = ((t + n.fase) % n.periodo) / n.periodo;
        ctx.fillStyle = 'rgba(' + A + ',.45)';
        ctx.fillRect(n.x - 1.5, n.y - 1.5, 3, 3);
        ctx.strokeStyle = 'rgba(' + A + ',' + (.38 * (1 - u)).toFixed(3) + ')';
        ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, 3 + u * 16, 0, Math.PI * 2); ctx.stroke();
      }

      // Pings das chegadas das empilhadeiras.
      for(let i = pings.length - 1; i >= 0; i--){
        const p = pings[i], u = Math.max(0, t - p.t0) / 700;
        if(u >= 1){ pings.splice(i, 1); continue; }
        ctx.strokeStyle = 'rgba(' + A + ',' + (.5 * (1 - u)).toFixed(3) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3 + u * 14, 0, Math.PI * 2); ctx.stroke();
      }

      // Empilhadeiras: rastro que some + cabeça com halo.
      for(const a of agvs){
        const tr = a.trilha;
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        for(let i = 1; i < tr.length; i++){
          const idade = (t - tr[i].t) / TRILHA;
          ctx.strokeStyle = 'rgba(' + A + ',' + (.55 * (1 - idade)).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(' + A + ',.16)'; ctx.fillRect(a.x - 7, a.y - 7, 14, 14);
        ctx.fillStyle = 'rgba(' + A + ',.95)'; ctx.fillRect(a.x - 2.5, a.y - 2.5, 5, 5);
      }
    }

    // Desempenho adaptativo: mede o ritmo real dos quadros e, se a máquina não
    // aguentar, desliga primeiro o que é decorativo (modo leve) e, em último
    // caso, o canvas. Em PCs bons nada disso é acionado.
    let nivel = 0, rafAnt = 0, amostra = [], inicio = 0, ultimoDesenho = 0, parou = false;
    function laco(t){
      if(parou) return;
      requestAnimationFrame(laco);
      if(!inicio) inicio = t;
      if(rafAnt && t - inicio > 2000 && nivel < 2){
        amostra.push(t - rafAnt);
        if(amostra.length >= 90){
          const media = amostra.reduce((a, b) => a + b, 0) / amostra.length;
          amostra = [];
          if(media > 34 && nivel === 0){ nivel = 1; html.classList.add('mx-lite'); inicio = t - 1000; }
          else if(media > 45 && nivel === 1){
            nivel = 2; parou = true; cv.remove();
            return;
          }
        }
      }
      rafAnt = t;
      const intervalo = nivel === 0 ? 24 : 48;     // ~40 fps / ~20 fps
      if(t - ultimoDesenho < intervalo) return;
      ultimoDesenho = t;
      desenhar(t);
    }

    window.addEventListener('resize', redimensionar);
    redimensionar();
    window.addEventListener('pointermove', e => {
      if(e.pointerType === 'touch') return;
      mouse.ax = e.clientX; mouse.ay = e.clientY;
      if(!mouse.ativo){ mouse.x = e.clientX; mouse.y = e.clientY; mouse.ativo = true; }
      wrapBg.style.setProperty('--px', ((e.clientX / W) * 2 - 1).toFixed(3));
      wrapBg.style.setProperty('--py', ((e.clientY / H) * 2 - 1).toFixed(3));
    }, { passive: true });
    html.addEventListener('mouseleave', () => { mouse.ativo = false; });
    requestAnimationFrame(laco);
  }

  // ---------- Cards: foco de luz + textos em camadas ----------
  document.addEventListener('pointermove', e => {
    const card = e.target.closest && e.target.closest('.stat-card');
    if(!card || e.pointerType === 'touch') return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    if(!reduz){
      card.style.setProperty('--cx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      card.style.setProperty('--cy', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    }
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    const card = e.target.closest && e.target.closest('.stat-card');
    if(card && !card.contains(e.relatedTarget)){ card.style.setProperty('--cx', 0); card.style.setProperty('--cy', 0); }
  });

  // ---------- Login: card inclina levemente acompanhando o mouse ----------
  document.addEventListener('pointermove', e => {
    if(reduz || e.pointerType === 'touch') return;
    const box = document.querySelector('#app .login-box');
    if(!box) return;
    box.style.setProperty('--ry', (((e.clientX / window.innerWidth) - .5) * 7).toFixed(2) + 'deg');
    box.style.setProperty('--rx', (((e.clientY / window.innerHeight) - .5) * -6).toFixed(2) + 'deg');
  }, { passive: true });

  // ---------- Botões primários magnéticos ----------
  let magRaf = 0, magX = 0, magY = 0;
  function magnetizar(){
    magRaf = 0;
    document.querySelectorAll('#app button.primary:not(:disabled)').forEach(b => {
      const r = b.getBoundingClientRect();
      const dx = magX - (r.left + r.width / 2), dy = magY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy), alc = Math.max(r.width, r.height) * .9 + 30;
      if(d < alc){ const f = 1 - d / alc; b.style.translate = (dx * .16 * f).toFixed(1) + 'px ' + (dy * .22 * f).toFixed(1) + 'px'; }
      else if(b.style.translate) b.style.translate = '';
    });
  }
  document.addEventListener('pointermove', e => {
    if(reduz || e.pointerType === 'touch') return;
    magX = e.clientX; magY = e.clientY;
    if(!magRaf) magRaf = requestAnimationFrame(magnetizar);
  }, { passive: true });

  // ---------- Cliques: onda de choque, onda no botão e faíscas ----------
  function faiscas(x, y){
    const cores = ['#F47920', '#FFB27A', '#ffffff'];
    for(let i = 0; i < 12; i++){
      const s = document.createElement('i');
      const ang = Math.random() * Math.PI * 2, dist = 28 + Math.random() * 40;
      s.className = 'mx-spark';
      s.style.cssText = 'left:' + x + 'px;top:' + y + 'px;--dx:' + (Math.cos(ang) * dist).toFixed(1) + 'px;--dy:' + (Math.sin(ang) * dist).toFixed(1) + 'px;background:' + cores[i % 3];
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 850);
    }
  }
  document.addEventListener('pointerdown', e => {
    if(reduz) return;
    if(e.pointerType !== 'touch' || true) ondas.push({ x: e.clientX, y: e.clientY, t0: performance.now(), r: 0, a: 1 });
    if(ondas.length > 4) ondas.shift();
    const b = e.target.closest && e.target.closest('#app button.primary, #app button.secondary, #app button.icon-btn, #app button.status-tab-btn');
    if(!b || b.disabled) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'mx-ripple';
    s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(s);
    setTimeout(() => s.remove(), 650);
    if(b.classList.contains('primary')) faiscas(e.clientX, e.clientY);
  });

  // ---------- Troca de tema: círculo que se expande a partir do botão ----------
  window.mxTransicaoTema = function(ev, aplicar){
    if(reduz || !document.startViewTransition || !ev){ aplicar(); return; }
    const x = ev.clientX, y = ev.clientY;
    const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const vt = document.startViewTransition(aplicar);
    vt.ready.then(() => {
      html.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + raio + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 750, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();

(function(){
  const app = document.getElementById('app');

  let state = {
    loaded: false,
    session: null,
    isAdmin: null, // null = ainda não verificado, true/false = verificado
    authMode: 'login',
    authError: '',
    authConfirmMsg: '',
    authSending: false,
    recuperandoSenha: false,
    novaSenhaError: '',
    tab: 'dashboard',
    theme: localStorage.getItem('app_theme') || 'dark',
    produtos: [], solicitacoes: [], logs: [], emailControle: '',
    buscaProduto: '', filtroCategoria: 'todas', buscaSolicitacao: '', filtroStatus: 'todos', ordenacao: 'recentes',
    modal: null, toast: null, sidebarAberta: false,
  };

  document.documentElement.setAttribute('data-theme', state.theme);

  function fmtDate(iso){ const d=new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
  function fmtMoney(v){ return (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

  // Mostra os materiais de um pedido um por linha (nome ×quantidade), em vez do
  // texto corrido salvo no campo "item". Cai de volta pro texto corrido quando
  // não há itens de catálogo vinculados (caso de item personalizado). Itens sem
  // estoque no momento do pedido aparecem destacados em vermelho, com aviso de
  // compra urgente.
  function formatarMateriaisCompacto(s){
    if(s.itens && s.itens.length > 0){
      return s.itens.map(it => {
        const semEstoque = it.disponivel === false;
        const texto = `${esc(it.nome)} <span class="dim mono">×${it.quantidade}</span>`;
        return semEstoque
          ? `<span class="t-danger strong">🔴 ${texto} — sem estoque</span>`
          : texto;
      }).join('<br>');
    }
    return esc(s.item);
  }
  function elFrag(html){ const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  // Escapa texto antes de inserir no HTML. Este painel exibe dados enviados por
  // COLABORADORES (não confiáveis) na tela do ADMIN — todo campo de texto livre
  // (nome, motivo, endereço, item, fornecedor...) precisa passar por aqui antes
  // de entrar em um template de innerHTML, ou vira um vetor de XSS armazenado.
  function esc(v){
    if(v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function buildMailto(email, subject, body){
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function showToast(msg){ state.toast=msg; render(); setTimeout(()=>{state.toast=null; render();},3000); }

  function exportarCSV(dados, nomeArquivo){
    if(!dados || !dados.length){ showToast('Nenhum dado para exportar.'); return; }
    const headers = Object.keys(dados[0]).join(',');
    const rows = dados.map(obj => Object.values(obj).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${nomeArquivo}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Relatório ${nomeArquivo}.csv baixado com sucesso!`);
  }

  // Gera uma planilha .xlsx de verdade: cabeçalho colorido em negrito, bordas em
  // toda a tabela, linhas zebradas e coluna de destaque quando indicado. Usada
  // nas listas de compra, que precisam ser lidas/impressas por outras pessoas
  // (fornecedor, financeiro), não só abertas no navegador.
  async function exportarExcelFormatado(titulo, colunas, linhas, nomeArquivo){
    if(!linhas || linhas.length === 0){ showToast('Nada para exportar no momento.'); return; }
    if(typeof ExcelJS === 'undefined'){ showToast('Biblioteca de planilha não carregada — recarregue a página e tente de novo.'); return; }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema de Controle de Estoque';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(titulo, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = colunas.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));

    linhas.forEach(linha => sheet.addRow(linha));

    colunas.forEach(c => { if(c.numFmt) sheet.getColumn(c.key).numFmt = c.numFmt; });

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow.height = 24;

    sheet.eachRow((row, rowNumber) => {
      if(rowNumber === 1) return;
      const linhaOriginal = linhas[rowNumber - 2];
      const destaque = linhaOriginal && linhaOriginal._destaque;
      row.eachCell(cell => {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } }, left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } }, right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
        if(destaque){ cell.font = { color: { argb: 'FFCC0000' }, bold: true }; }
      });
      if(!destaque && rowNumber % 2 === 0){
        row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; });
      } else if(destaque){
        row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } }; });
      }
      row.height = 20;
    });

    const ultimaColuna = String.fromCharCode(64 + colunas.length);
    sheet.autoFilter = { from: 'A1', to: `${ultimaColuna}${linhas.length + 1}` };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${nomeArquivo}_${new Date().toISOString().slice(0,10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`Planilha ${nomeArquivo}.xlsx exportada com sucesso!`);
  }

  // Exporta uma lista de compras com todos os itens em ruptura (zerados ou
  // abaixo do estoque mínimo), já sugerindo quanto comprar de cada um e o
  // custo estimado da reposição — pronta para mandar pro fornecedor/compras.
  async function exportarListaCompras(){
    const emRuptura = state.produtos.filter(p => Number(p.estoque||0) <= Number(p.quantidadeMinima||5));

    if(emRuptura.length === 0){ showToast('Nenhum item em ruptura no momento — nada para exportar.'); return; }

    const colunas = [
      { header: 'SKU',              key: 'sku',            width: 14 },
      { header: 'Material',         key: 'material',       width: 32 },
      { header: 'Categoria',        key: 'categoria',      width: 16 },
      { header: 'Estoque Atual',    key: 'estoqueAtual',   width: 14 },
      { header: 'Estoque Mínimo',   key: 'estoqueMinimo',  width: 14 },
      { header: 'Situação',         key: 'situacao',       width: 18 },
      { header: 'Qtd. Sugerida',    key: 'qtdSugerida',    width: 14 },
      { header: 'Unidade',          key: 'unidade',        width: 10 },
      { header: 'Preço Unitário',   key: 'precoUnitario',  width: 15, numFmt: '"R$" #,##0.00' },
      { header: 'Custo Estimado',   key: 'custoEstimado',  width: 16, numFmt: '"R$" #,##0.00' },
      { header: 'Fornecedor',       key: 'fornecedor',     width: 24 },
    ];

    let custoTotalGeral = 0;
    const linhas = emRuptura
      .sort((a,b) => a.estoque - b.estoque) // mais crítico (mais perto/abaixo de zero) primeiro
      .map(p => {
        // Sugere repor até o dobro do mínimo, garantindo uma folga além de só "zerar a ruptura".
        const qtdSugerida = Math.max((Number(p.quantidadeMinima||5) * 2) - Number(p.estoque||0), 1);
        const custoEstimado = qtdSugerida * Number(p.preco||0);
        custoTotalGeral += custoEstimado;
        const zerado = p.estoque <= 0;
        return {
          sku: p.sku, material: p.nome, categoria: p.categoria,
          estoqueAtual: p.estoque, estoqueMinimo: p.quantidadeMinima,
          situacao: zerado ? 'ZERADO' : 'ABAIXO DO MÍNIMO',
          qtdSugerida, unidade: p.unidade,
          precoUnitario: Number(p.preco || 0), custoEstimado,
          fornecedor: p.fornecedor || '—',
          _destaque: zerado
        };
      });

    await exportarExcelFormatado('Lista de Compras', colunas, linhas, 'Lista_de_Compras_Reposicao');
    showToast(`Lista exportada: ${emRuptura.length} item(ns) em ruptura, custo estimado total ${fmtMoney(custoTotalGeral)}.`);
  }

  // Exporta a lista de itens sem estoque que colaboradores JÁ pediram e estão
  // aguardando (demanda real e concreta, diferente da lista de ruptura preventiva).
  async function exportarComprasUrgentes(itensUrgentes){
    if(!itensUrgentes || itensUrgentes.length === 0){ showToast('Nenhum item com pedido pendente sem estoque no momento.'); return; }

    const colunas = [
      { header: 'SKU',                       key: 'sku',               width: 14 },
      { header: 'Material',                  key: 'material',          width: 32 },
      { header: 'Qtd. Pedida (Pendente)',     key: 'qtdPendente',       width: 18 },
      { header: 'Pedidos Aguardando',         key: 'pedidosAguardando', width: 16 },
      { header: 'Preço Unitário',            key: 'precoUnitario',     width: 15, numFmt: '"R$" #,##0.00' },
      { header: 'Custo Estimado',            key: 'custoEstimado',     width: 16, numFmt: '"R$" #,##0.00' },
      { header: 'Fornecedor',                key: 'fornecedor',        width: 24 },
    ];

    let custoTotal = 0;
    const linhas = itensUrgentes.map(it => {
      const produto = state.produtos.find(p => p.id === it.produtoId);
      const preco = produto ? Number(produto.preco||0) : 0;
      const custo = preco * it.quantidade;
      custoTotal += custo;
      return {
        sku: produto ? produto.sku : '—', material: it.nome,
        qtdPendente: it.quantidade, pedidosAguardando: it.pedidos,
        precoUnitario: preco, custoEstimado: custo,
        fornecedor: produto ? (produto.fornecedor || '—') : '—',
        _destaque: true
      };
    });

    await exportarExcelFormatado('Compra Urgente', colunas, linhas, 'Compra_Urgente_Demanda_Real');
    showToast(`Lista exportada: ${itensUrgentes.length} item(ns) com colaboradores aguardando, custo estimado ${fmtMoney(custoTotal)}.`);
  }

  // ==========================================================================
  // Camada de dados: tudo agora vem do Supabase (nada mais em localStorage/window.storage).
  // ==========================================================================

  // Converte uma linha da tabela "produtos" para o formato usado pela UI.
  function mapProduto(row){
    return {
      id: row.id,
      sku: row.sku || row.codigo,
      nome: row.nome,
      categoria: row.categoria || 'Geral',
      estoque: Number(row.estoque || 0),
      quantidadeMinima: Number(row.quantidade_minima ?? 5),
      preco: Number(row.preco || 0),
      fornecedor: row.fornecedor || '',
      unidade: row.unidade || 'un'
    };
  }

  // Converte uma linha da tabela "solicitacoes" para o formato usado pela UI.
  function mapSolicitacao(row){
    return {
      id: row.id,
      nome: row.nome,
      email: row.email,
      matricula: row.matricula,
      setor: row.setor,
      centroCusto: row.centro_custo,
      item: row.item,
      quantidade: row.quantidade,
      urgencia: row.urgencia,
      motivo: row.motivo,
      endereco: row.endereco,
      status: row.status,
      dataCriacao: row.data_criacao
    };
  }

  function mapLog(row){
    return { id: row.id, data: row.criado_em, usuario: row.usuario_email || '—', acao: row.acao, detalhe: row.detalhe };
  }

  async function carregarProdutos(){
    const { data, error } = await supabaseClient.from('produtos').select('*').order('nome');
    if(error){ console.error(error); return []; }
    return (data || []).map(mapProduto);
  }

  async function carregarSolicitacoes(){
    const { data, error } = await supabaseClient.from('solicitacoes').select('*').order('data_criacao', { ascending: false });
    if(error){ console.error(error); return []; }
    const solicitacoes = (data || []).map(mapSolicitacao);

    const ids = solicitacoes.map(s => s.id);
    if(ids.length > 0){
      const { data: itensData, error: itensError } = await supabaseClient
        .from('solicitacao_itens')
        .select('solicitacao_id, produto_id, quantidade, disponivel, produtos ( nome, sku, categoria )')
        .in('solicitacao_id', ids);

      if(!itensError && itensData){
        const porSolicitacao = {};
        itensData.forEach(row => {
          if(!porSolicitacao[row.solicitacao_id]) porSolicitacao[row.solicitacao_id] = [];
          porSolicitacao[row.solicitacao_id].push({
            produtoId: row.produto_id,
            nome: row.produtos ? row.produtos.nome : 'Produto removido',
            sku: row.produtos ? row.produtos.sku : '—',
            categoria: row.produtos ? row.produtos.categoria : '',
            quantidade: row.quantidade,
            disponivel: row.disponivel
          });
        });
        solicitacoes.forEach(s => { s.itens = porSolicitacao[s.id] || []; });
      }
    }

    return solicitacoes;
  }

  async function carregarLogs(){
    const { data, error } = await supabaseClient.from('logs').select('*').order('criado_em', { ascending: false }).limit(50);
    if(error){ console.error(error); return []; }
    return (data || []).map(mapLog);
  }

  async function carregarConfig(){
    const { data, error } = await supabaseClient.from('config').select('*').eq('chave', 'email_controle').maybeSingle();
    if(error || !data){ return 'yuri.silva1@sgs.com'; }
    return data.valor || 'yuri.silva1@sgs.com';
  }

  async function addLog(acao, detalhe){
    await supabaseClient.from('logs').insert({
      usuario_email: state.session ? state.session.user.email : null,
      acao, detalhe
    });
    state.logs = await carregarLogs();
  }

  async function addProduto(payload){
    const { error } = await supabaseClient.from('produtos').insert({
      nome: payload.nome,
      codigo: payload.sku,
      sku: payload.sku,
      categoria: payload.categoria,
      estoque: payload.quantidade,
      quantidade_minima: payload.quantidadeMinima,
      preco: payload.preco,
      fornecedor: payload.fornecedor,
      unidade: 'un'
    });
    if(error){ showToast('Erro ao cadastrar: ' + error.message); return; }
    state.produtos = await carregarProdutos();
    await addLog('CADASTRAR_PRODUTO', `Produto "${payload.nome}" adicionado.`);
    showToast('Produto cadastrado e sincronizado com o banco.');
  }

  async function updateProduto(id, payload){
    const { error } = await supabaseClient.from('produtos').update({
      nome: payload.nome,
      codigo: payload.sku,
      sku: payload.sku,
      categoria: payload.categoria,
      estoque: payload.quantidade,
      quantidade_minima: payload.quantidadeMinima,
      preco: payload.preco,
      fornecedor: payload.fornecedor,
      atualizado_em: new Date().toISOString()
    }).eq('id', id);
    if(error){ showToast('Erro ao atualizar: ' + error.message); return; }
    state.produtos = await carregarProdutos();
    await addLog('ATUALIZAR_PRODUTO', `Produto "${payload.nome}" atualizado.`);
    showToast('Produto atualizado e sincronizado com o banco.');
  }

  async function deleteProduto(id){
    const prod = state.produtos.find(p=>p.id===id);
    const { error } = await supabaseClient.from('produtos').delete().eq('id', id);
    if(error){
      showToast('Não foi possível excluir: item já usado em solicitações existentes.');
      return;
    }
    state.produtos = await carregarProdutos();
    await addLog('EXCLUIR_PRODUTO', `Produto "${prod ? prod.nome : id}" removido.`);
    showToast('Produto removido do catálogo.');
  }

  // Muda o status de uma solicitação via função segura no banco (ela cuida do estoque).
  // Envia um e-mail real via a Edge Function "send-email" (usa a Resend).
  async function enviarEmail({ to, subject, html }){
    if(!state.session) return { error: 'Sem sessão ativa.' };
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.access_token}` },
        body: JSON.stringify({ to, subject, html })
      });
      const data = await resp.json();
      if(!resp.ok){ return { error: data.error || 'Falha ao enviar e-mail.' }; }
      return { data };
    } catch (err) {
      return { error: err.message || 'Falha ao enviar e-mail.' };
    }
  }

  const STATUS_LABEL = { aprovado: 'Aprovado ✅', rejeitado: 'Rejeitado ❌', entregue: 'Entregue 📦', pendente: 'Pendente', cancelado: 'Cancelado' };
  const STATUS_COR = { aprovado: '#10B981', rejeitado: '#FF3F00', entregue: '#0EA5E9', pendente: '#FF7F11', cancelado: '#94A3B8' };

  // Notifica o colaborador por e-mail sobre a mudança de status do próprio pedido.
  async function notificarColaborador(sol, novoStatus){
    if(!sol || !sol.email) return;
    const label = STATUS_LABEL[novoStatus] || novoStatus.toUpperCase();
    const cor = STATUS_COR[novoStatus] || '#666';
    const html = `
      <div style="font-family:sans-serif; max-width:560px;">
        <h2 style="color:${cor};">Atualização da sua solicitação</h2>
        <p>Olá, ${esc(sol.nome)}.</p>
        <p>Sua solicitação foi atualizada para: <strong style="color:${cor};">${esc(label)}</strong></p>
        <table style="border-collapse:collapse; width:100%; font-size:14px; margin-top:12px;">
          <tr><td style="padding:6px 0; color:#666;">Item(ns)</td><td style="padding:6px 0;"><strong>${esc(sol.item)}</strong></td></tr>
          <tr><td style="padding:6px 0; color:#666;">Quantidade</td><td style="padding:6px 0;">${esc(sol.quantidade)}</td></tr>
        </table>
        <p style="color:#999; font-size:12px; margin-top:24px;">Qualquer dúvida, entre em contato com o setor de suprimentos.</p>
      </div>
    `;
    await enviarEmail({ to: sol.email, subject: `[SUPRIMENTOS] Sua solicitação foi ${label}`, html });
  }

  async function atualizarStatus(id, status){
    const sol = state.solicitacoes.find(s=>s.id===id);
    const { error } = await supabaseClient.rpc('admin_atualizar_status_solicitacao', {
      p_solicitacao_id: id,
      p_novo_status: status
    });
    if(error){ showToast('Erro ao atualizar status: ' + error.message); return; }
    state.produtos = await carregarProdutos();
    state.solicitacoes = await carregarSolicitacoes();
    await addLog('STATUS_SOLICITACAO', `Pedido de ${sol ? sol.nome : id} alterado para ${status.toUpperCase()}.`);
    showToast(`Solicitação${sol ? ' de ' + sol.nome : ''} marcada como ${status.toUpperCase()}. Notificando por e-mail...`);
    const { error: erroEmail } = await notificarColaborador(sol, status) || {};
    if(erroEmail){ showToast('Status atualizado, mas o e-mail de notificação falhou.'); }
  }

  let realtimeSubscribed = false;
  function garantirRealtime(){
    if(realtimeSubscribed) return;
    realtimeSubscribed = true;
    supabaseClient.channel('admin-produtos').on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, async () => {
      state.produtos = await carregarProdutos();
      render();
    }).subscribe();
    supabaseClient.channel('admin-solicitacoes').on('postgres_changes', { event: '*', schema: 'public', table: 'solicitacoes' }, async () => {
      state.solicitacoes = await carregarSolicitacoes();
      render();
    }).subscribe();
  }

  // ==========================================================================
  // Autenticação (somente administradores acessam este painel).
  // ==========================================================================

  async function loadAll(){
    const { data: { session } } = await supabaseClient.auth.getSession();
    state.session = session;
    if(session){
      await bootstrapAdmin();
    }
    state.loaded = true;
    render();

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if(event === 'PASSWORD_RECOVERY'){
        state.session = session;
        state.recuperandoSenha = true;
        render();
        return;
      }
      state.session = session;
      if(session && !state.recuperandoSenha){
        await bootstrapAdmin();
      } else if(!state.recuperandoSenha) {
        state.isAdmin = null;
        state.produtos = []; state.solicitacoes = []; state.logs = []; state.emailControle = '';
      }
      render();
    });
  }

  async function bootstrapAdmin(){
    const { data: souAdmin, error } = await supabaseClient.rpc('is_admin');
    state.isAdmin = !error && souAdmin === true;
    if(!state.isAdmin) return;

    const [produtos, solicitacoes, logs, emailControle] = await Promise.all([
      carregarProdutos(), carregarSolicitacoes(), carregarLogs(), carregarConfig()
    ]);
    state.produtos = produtos;
    state.solicitacoes = solicitacoes;
    state.logs = logs;
    state.emailControle = emailControle;
    garantirRealtime();
  }

  async function doLogin(email, senha){
    if(!isValidEmail(email)){ state.authError = 'Informe um e-mail válido.'; render(); return; }
    if(!senha){ state.authError = 'Informe sua senha.'; render(); return; }
    state.authError = ''; state.authConfirmMsg = ''; state.authSending = true; render();
    const { error } = await supabaseClient.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
    state.authSending = false;
    if(error){
      state.authError = error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message;
      render();
    }
  }

  async function doSignup(email, senha){
    if(!isValidEmail(email)){ state.authError = 'Informe um e-mail válido.'; render(); return; }
    if(!senha || senha.length < 6){ state.authError = 'A senha deve ter ao menos 6 caracteres.'; render(); return; }
    state.authError = ''; state.authConfirmMsg = ''; state.authSending = true; render();
    // emailRedirectTo garante que, ao confirmar o e-mail, o admin volte para
    // ESTE painel (e não para o "Site URL" padrão, que aponta para o portal
    // do colaborador, um domínio diferente).
    const { data, error } = await supabaseClient.auth.signUp({
      email: email.trim().toLowerCase(),
      password: senha,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    state.authSending = false;
    if(error){ state.authError = error.message; render(); return; }
    if(!data.session){
      state.authMode = 'login';
      state.authConfirmMsg = 'Cadastro realizado! Verifique seu e-mail para confirmar antes de entrar.';
    }
    render();
  }

  async function logoutUser(){
    await supabaseClient.auth.signOut();
  }

  async function doRecuperarSenha(email){
    if(!isValidEmail(email)){ state.authError = 'Informe um e-mail válido.'; render(); return; }
    state.authError = ''; state.authConfirmMsg = ''; state.authSending = true; render();

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin + window.location.pathname
    });

    state.authSending = false;
    if(error){ state.authError = error.message; render(); return; }

    state.authMode = 'login';
    state.authConfirmMsg = 'Se esse e-mail estiver cadastrado como admin, enviamos um link para redefinir a senha.';
    render();
  }

  async function doDefinirNovaSenha(novaSenha, confirmarSenha){
    state.novaSenhaError = '';
    if(!novaSenha || novaSenha.length < 6){ state.novaSenhaError = 'A senha deve ter ao menos 6 caracteres.'; render(); return; }
    if(novaSenha !== confirmarSenha){ state.novaSenhaError = 'As senhas não coincidem.'; render(); return; }

    state.authSending = true; render();
    const { error } = await supabaseClient.auth.updateUser({ password: novaSenha });
    state.authSending = false;

    if(error){ state.novaSenhaError = error.message; render(); return; }

    state.recuperandoSenha = false;
    await bootstrapAdmin();
    render();
    showToast('Senha atualizada com sucesso!');
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  // ==========================================================================
  // Pós-render. O app redesenha tudo a cada toast/atualização em tempo real, o
  // que fazia as animações de entrada (cards, sidebar, modal, toast) tocarem de
  // novo toda hora. Aqui controlamos por "chave de tela": a animação só toca
  // quando a tela/aba/modal realmente muda. Estilos: seção MELHORIAS do CSS.
  // ==========================================================================
  let mxUltimaChave = null, mxUltimoModal = null, mxUltimoToast = null, mxToastInicio = 0;
  const mxReduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mxContar(el, destino, formato, atraso){
    const ini = performance.now() + atraso, dur = 950;
    el.textContent = formato(0);
    const passo = (agora) => {
      if(!el.isConnected) return;
      const p = Math.min(Math.max((agora - ini) / dur, 0), 1);
      el.textContent = formato(destino * (1 - Math.pow(1 - p, 3)));
      if(p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  function posRender(){
    app.style.position = 'relative'; app.style.zIndex = '1';   // conteúdo sempre acima do fundo
    let chave;
    if(!state.loaded) chave = 'load';
    else if(state.recuperandoSenha) chave = 'recup';
    else if(!state.session) chave = 'auth:' + state.authMode;
    else if(state.isAdmin === null) chave = 'verif';
    else if(!state.isAdmin) chave = 'negado';
    else chave = 'app:' + state.tab;

    const anterior = mxUltimaChave;
    const mudouTela = chave !== anterior;
    const soTrocouAba = mudouTela && chave.startsWith('app') && anterior && anterior.startsWith('app');
    mxUltimaChave = chave;

    // Re-render sem mudança de tela: não repete as animações de entrada.
    app.classList.toggle('mx-quiet', !mudouTela);
    app.classList.toggle('mx-quiet-side', !mudouTela || soTrocouAba);
    app.classList.toggle('mx-quiet-modal', state.modal === mxUltimoModal);
    mxUltimoModal = state.modal;

    // Login / recuperação / acesso negado: deixa o fundo animado aparecer.
    const ehAuth = chave.startsWith('auth') || chave === 'recup' || chave === 'negado';
    if(ehAuth){
      app.querySelectorAll('.overlay').forEach(o => o.classList.add('mx-auth'));
      const box = app.querySelector('.login-box');
      if(box && !box.querySelector('.mx-login-brand')){
        box.insertAdjacentHTML('afterbegin', `
          <div class="mx-login-brand">
            <svg viewBox="0 0 240 110" height="26" xmlns="http://www.w3.org/2000/svg" aria-label="SGS" style="display:block;flex-shrink:0;">
              <text x="0" y="82" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="98" letter-spacing="-3" fill="#77787B">SGS</text>
              <line x1="0" y1="96" x2="228" y2="96" stroke="#F47920" stroke-width="6"/>
              <line x1="210" y1="0" x2="210" y2="110" stroke="#F47920" stroke-width="6"/>
            </svg>
            <span>Controle de Estoque</span>
          </div>`);
      }
    }

    // Cards: elementos de luz (foco do mouse) e anel de alerta, atrás do conteúdo.
    app.querySelectorAll('.stat-card').forEach(c => c.insertAdjacentHTML('afterbegin', '<i class="mx-spot"></i><i class="mx-ring"></i>'));

    // Entrada da aba: números contam até o valor; painéis e linhas entram em sequência.
    if(mudouTela && chave.startsWith('app') && !mxReduz){
      const content = app.querySelector('.content');
      if(content){
        content.querySelectorAll('.panel').forEach((el, i) => el.style.setProperty('--i', i));
        content.querySelectorAll('tbody tr').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
        content.querySelectorAll('.stat-card .value').forEach((el, i) => {
          const txt = el.textContent.trim();
          const atraso = i * 85 + 330;   // acompanha o "deal" dos tickets
          if(/^\d+$/.test(txt)) mxContar(el, parseInt(txt, 10), v => String(Math.round(v)), atraso);
          else if(/R\$/.test(txt)){
            const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
            if(!isNaN(n)) mxContar(el, n, fmtMoney, atraso);
          }
        });
        content.querySelectorAll('.chart-val').forEach((el, i) => {
          const m = el.textContent.trim().match(/^(\d+(?:[.,]\d+)?)%$/);
          if(m) mxContar(el, parseFloat(m[1].replace(',', '.')), v => Math.round(v) + '%', 500 + i * 70);
        });

        // Painéis fora da tela entram só quando você rola até eles.
        if('IntersectionObserver' in window){
          const fora = [...content.querySelectorAll('.panel')].filter(p => p.getBoundingClientRect().top > window.innerHeight * .92);
          if(fora.length){
            const io = new IntersectionObserver(es => es.forEach(e => {
              if(e.isIntersecting){ e.target.classList.add('mx-in'); io.unobserve(e.target); }
            }), { threshold: .12 });
            fora.forEach(p => { p.classList.add('mx-hold'); io.observe(p); });
          }
        }

        content.insertAdjacentHTML('afterbegin', '<i class="mx-wipe"></i>');
        content.classList.add('mx-enter');
        app.classList.add('mx-tab');
        setTimeout(() => { content.classList.remove('mx-enter'); content.querySelector('.mx-wipe')?.remove(); }, 1700);
        setTimeout(() => app.classList.remove('mx-tab'), 1100);
      }
    }

    // Toast: anima uma vez; a barra de tempo continua de onde estava.
    const toast = app.querySelector('.toast');
    if(toast){
      const novo = state.toast !== mxUltimoToast;
      if(novo) mxToastInicio = performance.now();
      toast.classList.toggle('mx-toast-quiet', !novo);
      toast.style.setProperty('--mx-t', (-(performance.now() - mxToastInicio) / 1000).toFixed(3) + 's');
    }
    mxUltimoToast = toast ? state.toast : null;
  }

  function render(){
    renderBase();
    posRender();
  }

  function renderBase(){
    app.innerHTML = '';
    if(!state.loaded){ app.appendChild(elFrag(`<div class="mx-loader"><div class="mx-loader-ring"></div><span>Conectando ao banco de dados…</span></div>`)); return; }

    if(state.recuperandoSenha){ renderDefinirNovaSenhaModal(); return; }
    if(!state.session){ renderLogin(); return; }

    if(state.isAdmin === null){ app.appendChild(elFrag(`<div class="mx-loader"><div class="mx-loader-ring"></div><span>Verificando permissões…</span></div>`)); return; }

    if(!state.isAdmin){ renderAcessoNegado(); return; }

    if(state.toast) app.appendChild(elFrag(`<div class="toast"><span class="toast-ok">✓</span> ${state.toast}</div>`));

    const pendentes = state.solicitacoes.filter(s=>s.status==='pendente').length;

    const backdrop = elFrag(`<div class="sidebar-backdrop ${state.sidebarAberta ? 'open' : ''}"></div>`);
    backdrop.onclick = () => { state.sidebarAberta = false; render(); };
    app.appendChild(backdrop);

    const qtdRepor = state.produtos.filter(p => Number(p.estoque||0) <= Number(p.quantidadeMinima||5)).length;
    const navItem = (tab, ico, label, count, tone) => `
      <div class="nav-item ${state.tab===tab?'active':''}" data-tab="${tab}" role="button" tabindex="0">
        <span class="nav-ico">${ico}</span><span class="nav-label">${label}</span>
        ${count ? `<span class="nav-count ${tone||''}">${count}</span>` : ''}
      </div>`;

    const sidebar = elFrag(`
      <div class="sidebar ${state.sidebarAberta ? 'open' : ''}">
        <div class="brand-row">
          <svg viewBox="0 0 240 110" height="26" xmlns="http://www.w3.org/2000/svg" aria-label="SGS" style="display:block; flex-shrink:0;">
            <text x="0" y="82" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="98" letter-spacing="-3" fill="#77787B">SGS</text>
            <line x1="0" y1="96" x2="228" y2="96" stroke="#F47920" stroke-width="6"/>
            <line x1="210" y1="0" x2="210" y2="110" stroke="#F47920" stroke-width="6"/>
          </svg>
          <span class="brand-badge">Controle de Estoque</span>
        </div>

        <nav class="nav-group">
          <div class="nav-title">Operação</div>
          ${navItem('dashboard', '📊', 'Dashboard')}
          ${navItem('solicitacoes', '📝', 'Solicitações', pendentes, 'warn')}
          ${navItem('produtos', '📦', 'Produtos', qtdRepor, 'danger')}
        </nav>

        <nav class="nav-group">
          <div class="nav-title">Sistema</div>
          ${navItem('logs', '📜', 'Histórico / Logs')}
          ${navItem('config', '⚙️', 'Configurações')}
        </nav>

        <div class="sidebar-foot">
          <div class="user-card">
            <span class="user-avatar">${esc((state.session.user.email||'?').charAt(0).toUpperCase())}</span>
            <div class="user-info"><small>Sessão</small><span class="mono" title="${esc(state.session.user.email)}">${esc(state.session.user.email)}</span></div>
          </div>
          <div class="nav-item" id="nav-logout" role="button" tabindex="0"><span class="nav-ico">🚪</span><span class="nav-label">Sair</span></div>
        </div>
      </div>
    `);

    sidebar.querySelectorAll('.nav-item[data-tab]').forEach(n=>{
      n.onclick = ()=>{ state.tab=n.dataset.tab; state.sidebarAberta = false; render(); };
    });
    sidebar.querySelector('#nav-logout').onclick = logoutUser;
    sidebar.querySelectorAll('.nav-item').forEach(n => n.onkeydown = (e) => { if(e.key==='Enter' || e.key===' '){ e.preventDefault(); n.click(); } });
    app.appendChild(sidebar);

    const main = document.createElement('div');
    main.className = 'main';
    app.appendChild(main);

    const titles = {
      dashboard:['Visão Geral','Panorama do estoque e métricas operacionais'],
      produtos:['Inventário','Gerencie o catálogo de produtos do banco de dados'],
      solicitacoes:['Fila de Pedidos','Analise, aprova e acompanhe as requisições'],
      logs:['Auditoria e Histórico','Registro das últimas ações realizadas neste painel'],
      config:['Configurações do Sistema','Preferências globais de e-mail e parâmetros'],
    };
    const [title, sub] = titles[state.tab] || ['Painel',''];

    const topbar = elFrag(`
      <div class="topbar">
        <div class="topbar-title">
          <button class="menu-toggle-btn" id="menu-toggle-btn" aria-label="Abrir menu">☰</button>
          <div><h2>${title}</h2><p>${sub}</p></div>
        </div>
        <button class="secondary theme-btn" id="theme-toggle-btn">
          ${state.theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo escuro'}
        </button>
      </div>
    `);

    topbar.querySelector('#menu-toggle-btn').onclick = () => { state.sidebarAberta = true; render(); };

    topbar.querySelector('#theme-toggle-btn').onclick = (ev) => {
      window.mxTransicaoTema(ev, () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('app_theme', state.theme);
        document.documentElement.setAttribute('data-theme', state.theme);
        render();
      });
    };

    main.appendChild(topbar);

    const content = document.createElement('div');
    content.className = 'content';
    main.appendChild(content);

    if(state.tab==='dashboard') renderDashboard(content);
    else if(state.tab==='produtos') renderProdutos(content);
    else if(state.tab==='solicitacoes') renderSolicitacoes(content);
    else if(state.tab==='logs') renderLogs(content);
    else if(state.tab==='config') renderConfig(content);

    if(state.modal) renderModal();
  }

  // Tela de login/cadastro (autenticação real via Supabase Auth).
  function renderLogin(){
    if(state.authMode === 'recuperar'){ renderRecuperarSenhaModal(); return; }

    const isSignup = state.authMode === 'signup';
    const overlay = elFrag(`
      <div class="overlay">
        <div class="modal login-box">
          <h3>${isSignup ? 'Criar Conta de Administrador' : 'Acesso Restrito — BackOffice'}</h3>
          <p class="modal-sub">${isSignup ? 'Cadastre-se com o e-mail autorizado como administrador.' : 'Entre com seu e-mail e senha de administrador.'}</p>
          <div class="field"><label>E-mail</label><input id="login-email" type="email" placeholder="nome@empresa.com" autofocus></div>
          <div class="field"><label>Senha</label><input id="login-senha" type="password" placeholder="${isSignup ? 'Mínimo 6 caracteres' : 'Sua senha'}"></div>
          ${!isSignup ? `<div class="auth-forgot"><button type="button" class="auth-link" id="link-esqueci-senha">Esqueci minha senha</button></div>` : ''}
          ${state.authConfirmMsg ? `<div class="auth-msg ok" role="status">${state.authConfirmMsg}</div>` : ''}
          ${state.authError ? `<div class="auth-msg err" role="alert">${state.authError}</div>` : ''}
          <button class="primary btn-block" id="login-btn" ${state.authSending ? 'disabled' : ''}>${state.authSending ? 'Aguarde...' : (isSignup ? 'Criar conta' : 'Entrar')}</button>
          <div class="auth-foot">
            <span class="dim">${isSignup ? 'Já tem conta?' : 'Precisa criar a conta de admin?'}</span>
            <button type="button" class="auth-link" id="toggle-auth-mode">${isSignup ? 'Entrar' : 'Criar conta'}</button>
          </div>
        </div>
      </div>
    `);
    app.appendChild(overlay);

    const btn = overlay.querySelector('#login-btn');
    const emailInput = overlay.querySelector('#login-email');
    const senhaInput = overlay.querySelector('#login-senha');
    const doSubmit = () => isSignup ? doSignup(emailInput.value, senhaInput.value) : doLogin(emailInput.value, senhaInput.value);
    btn.onclick = doSubmit;
    senhaInput.onkeydown = (e) => { if(e.key === 'Enter') doSubmit(); };
    overlay.querySelector('#toggle-auth-mode').onclick = () => {
      state.authMode = isSignup ? 'login' : 'signup';
      state.authError = ''; state.authConfirmMsg = '';
      render();
    };

    const linkEsqueci = overlay.querySelector('#link-esqueci-senha');
    if(linkEsqueci) linkEsqueci.onclick = () => {
      state.authMode = 'recuperar';
      state.authError = ''; state.authConfirmMsg = '';
      render();
    };
  }

  function renderRecuperarSenhaModal(){
    const overlay = elFrag(`
      <div class="overlay">
        <div class="modal login-box">
          <h3>Recuperar Senha</h3>
          <p class="modal-sub">Informe o e-mail da conta de administrador. Vamos enviar um link para redefinir a senha.</p>
          <div class="field"><label>E-mail</label><input id="recuperar-email" type="email" placeholder="nome@empresa.com" autofocus></div>
          ${state.authError ? `<div class="auth-msg err" role="alert">${state.authError}</div>` : ''}
          <button class="primary btn-block" id="recuperar-btn" ${state.authSending ? 'disabled' : ''}>${state.authSending ? 'Enviando...' : 'Enviar link de recuperação'}</button>
          <div class="auth-foot">
            <button type="button" class="auth-link" id="voltar-login">← Voltar para o login</button>
          </div>
        </div>
      </div>
    `);
    app.appendChild(overlay);

    const emailInput = overlay.querySelector('#recuperar-email');
    const btn = overlay.querySelector('#recuperar-btn');
    const doSubmit = () => doRecuperarSenha(emailInput.value);
    btn.onclick = doSubmit;
    emailInput.onkeydown = (e) => { if(e.key === 'Enter') doSubmit(); };
    overlay.querySelector('#voltar-login').onclick = () => {
      state.authMode = 'login';
      state.authError = '';
      render();
    };
  }

  function renderDefinirNovaSenhaModal(){
    const overlay = elFrag(`
      <div class="overlay">
        <div class="modal login-box">
          <h3>Definir Nova Senha</h3>
          <p class="modal-sub">Escolha uma nova senha para sua conta de administrador.</p>
          <div class="field"><label>Nova Senha</label><input id="nova-senha" type="password" placeholder="Mínimo 6 caracteres" autofocus></div>
          <div class="field"><label>Confirmar Nova Senha</label><input id="confirmar-senha" type="password" placeholder="Repita a nova senha"></div>
          ${state.novaSenhaError ? `<div class="auth-msg err" role="alert">${state.novaSenhaError}</div>` : ''}
          <button class="primary btn-block" id="definir-senha-btn" ${state.authSending ? 'disabled' : ''}>${state.authSending ? 'Salvando...' : 'Salvar Nova Senha'}</button>
        </div>
      </div>
    `);
    app.appendChild(overlay);

    const novaSenhaInput = overlay.querySelector('#nova-senha');
    const confirmarInput = overlay.querySelector('#confirmar-senha');
    const btn = overlay.querySelector('#definir-senha-btn');
    const doSubmit = () => doDefinirNovaSenha(novaSenhaInput.value, confirmarInput.value);
    btn.onclick = doSubmit;
    novaSenhaInput.onkeydown = (e) => { if(e.key === 'Enter') confirmarInput.focus(); };
    confirmarInput.onkeydown = (e) => { if(e.key === 'Enter') doSubmit(); };
  }


  function renderAcessoNegado(){
    const overlay = elFrag(`
      <div class="overlay">
        <div class="modal modal-narrow">
          <h3>Acesso Negado</h3>
          <p class="modal-sub">A conta <strong>${state.session.user.email}</strong> não tem permissão de administrador para este painel.</p>
          <button class="secondary btn-block" id="btn-sair">Sair</button>
        </div>
      </div>
    `);
    overlay.querySelector('#btn-sair').onclick = logoutUser;
    app.appendChild(overlay);
  }

  // ---------- Helpers de organização visual ----------
  function statusEstoque(p){
    const e = Number(p.estoque||0), mn = Number(p.quantidadeMinima||5);
    if(e <= 0) return { k:'zero', label:'Sem estoque' };
    if(e <= mn) return { k:'baixo', label:'Repor' };
    return { k:'ok', label:'Normal' };
  }
  function medidorEstoque(p){
    const e = Number(p.estoque||0), mn = Math.max(Number(p.quantidadeMinima||5), 1);
    const pct = Math.max(0, Math.min(100, Math.round(e / (mn * 2) * 100)));
    return `<div class="meter ${statusEstoque(p).k}" title="${e} em estoque · mínimo ${mn}"><span style="width:${pct}%"></span></div>`;
  }
  function renderDashboard(content){
    const abaixoMinimo = state.produtos.filter(p => Number(p.estoque||0) <= Number(p.quantidadeMinima||5));
    const pendentes = state.solicitacoes.filter(s=>s.status==='pendente');
    const valorTotal = state.produtos.reduce((a,p)=>a + Number(p.estoque||0) * Number(p.preco||0),0);

    // Itens sem estoque pedidos por colaboradores em pedidos ainda ativos
    // (pendente/aprovado) — é demanda REAL e concreta, não só "abaixo do mínimo".
    const itensUrgentesMap = {};
    state.solicitacoes
      .filter(s => s.status === 'pendente' || s.status === 'aprovado')
      .forEach(s => {
        (s.itens || []).filter(it => it.disponivel === false).forEach(it => {
          const key = it.produtoId || it.nome;
          if(!itensUrgentesMap[key]) itensUrgentesMap[key] = { produtoId: it.produtoId, nome: it.nome, sku: it.sku, quantidade: 0, pedidos: 0 };
          itensUrgentesMap[key].quantidade += it.quantidade;
          itensUrgentesMap[key].pedidos += 1;
        });
      });
    const itensUrgentes = Object.values(itensUrgentesMap).sort((a,b) => b.quantidade - a.quantidade);

    const categorias = {};
    state.produtos.forEach(p => {
      const val = Number(p.estoque||0) * Number(p.preco||0);
      categorias[p.categoria] = (categorias[p.categoria] || 0) + val;
    });
    const catsOrdenadas = Object.entries(categorias).sort((a,b) => b[1] - a[1]);

    const dashboardEl = elFrag(`
      <div class="page">
        <div class="stat-grid">
          <div class="stat-card ${itensUrgentes.length ? 'danger' : ''}" data-card="urgente">
            <div class="label">🔴 Compra urgente</div>
            <div class="value">${itensUrgentes.length}</div>
            <span class="click-hint">Colaboradores aguardando →</span>
          </div>
          <div class="stat-card ${pendentes.length ? 'warn' : ''}" data-card="pendentes">
            <div class="label">Aguardando aprovação</div>
            <div class="value">${pendentes.length}</div>
            <span class="click-hint">Gerenciar pedidos →</span>
          </div>
          <div class="stat-card ${abaixoMinimo.length ? 'danger' : ''}" data-card="reposicao">
            <div class="label">Alerta de reposição</div>
            <div class="value">${abaixoMinimo.length}</div>
            <span class="click-hint">Ver itens a repor →</span>
          </div>
          <div class="stat-card" data-card="total">
            <div class="label">SKUs no catálogo</div>
            <div class="value">${state.produtos.length}</div>
            <span class="click-hint">Abrir inventário →</span>
          </div>
          <div class="stat-card" data-card="capital">
            <div class="label">Capital imobilizado</div>
            <div class="value value-money">${fmtMoney(valorTotal)}</div>
            <span class="click-hint">Ver detalhes →</span>
          </div>
        </div>

        ${itensUrgentes.length > 0 ? `
          <div class="panel panel-alert">
            <div class="panel-head">
              <div>
                <h3 class="t-danger">🔴 Compra urgente — colaboradores aguardando</h3>
                <p class="panel-sub">Itens pedidos que não têm estoque agora. Diferente do alerta de reposição (preventivo), aqui já existe gente esperando.</p>
              </div>
              <button class="secondary btn-danger-outline" id="btn-exportar-urgente">📥 Exportar lista</button>
            </div>
            <div class="table-scroll">
            <table>
              <thead><tr><th>Material</th><th class="num">Qtd. pendente</th><th class="num">Pedidos</th><th class="col-actions">Ação</th></tr></thead>
              <tbody>${itensUrgentes.map(it=>`
                <tr>
                  <td><div class="cell-main t-danger">${esc(it.nome)}</div><div class="cell-sub mono">${esc(it.sku)}</div></td>
                  <td class="mono num t-danger strong">${it.quantidade}</td>
                  <td class="mono num dim">${it.pedidos}</td>
                  <td class="col-actions">${it.produtoId ? `<button class="icon-btn" data-repor="${it.produtoId}">Repor / Editar</button>` : ''}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            </div>
          </div>
        ` : ''}

        <div class="dashboard-2col">
          <div class="panel">
            <div class="panel-head">
              <h3>Solicitações pendentes</h3>
              ${pendentes.length > 5 ? `<button class="link-btn" id="btn-ver-pendentes">Ver todas (${pendentes.length}) →</button>` : ''}
            </div>
            ${pendentes.length===0 ? `<div class="empty-state"><div class="glyph">🎉</div>Zero pendências na fila de aprovação.</div>` : `
              <div class="table-scroll">
              <table>
                <thead><tr><th>Colaborador</th><th>Material</th><th class="num">Qtd.</th><th>Urgência</th><th>Data</th></tr></thead>
                <tbody>${pendentes.slice(0,5).map(s=>`
                  <tr>
                    <td><div class="cell-main">${esc(s.nome)}</div>${s.setor ? `<div class="cell-sub">${esc(s.setor)}</div>` : ''}</td>
                    <td>${formatarMateriaisCompacto(s)}</td>
                    <td class="mono num">${s.quantidade}</td>
                    <td><span class="badge urg-${esc(s.urgencia)}">${esc(s.urgencia).toUpperCase()}</span></td>
                    <td class="dim mono small">${fmtDate(s.dataCriacao)}</td>
                  </tr>
                `).join('')}</tbody>
              </table>
              </div>
            `}
          </div>

          <div class="panel">
            <div class="panel-head"><h3>Capital por categoria</h3></div>
            <div class="chart-bar-container">
              ${catsOrdenadas.length === 0 ? `<div class="dim">Sem dados.</div>` :
                catsOrdenadas.map(([cat, val]) => {
                  const pct = valorTotal > 0 ? Math.round((val / valorTotal) * 100) : 0;
                  return `
                    <div class="chart-row" title="${esc(cat)} · ${fmtMoney(val)}">
                      <span class="chart-label">${esc(cat)}</span>
                      <div class="chart-track"><div class="chart-fill" style="width:${pct}%;"></div></div>
                      <span class="chart-val">${pct}%</span>
                    </div>
                  `;
                }).join('')
              }
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h3>Ruptura de estoque</h3>
              <p class="panel-sub">Itens com estoque igual ou abaixo do mínimo configurado.</p>
            </div>
            ${abaixoMinimo.length > 0 ? `
              <div class="btn-group">
                <button class="secondary" id="btn-exportar-compras">📥 Exportar lista de compras</button>
                <button class="secondary" id="btn-ver-alerta-detalhado">Ver lista de reposição</button>
              </div>` : ''}
          </div>
          ${abaixoMinimo.length===0 ? `<div class="empty-state"><div class="glyph">🛡️</div>Estoque saudável. Todos os itens estão acima do mínimo.</div>` : `
            <div class="table-scroll">
            <table>
              <thead><tr><th>Material</th><th>Situação</th><th class="col-meter">Nível</th><th class="num">Estoque</th><th class="num">Mínimo</th><th class="col-actions">Ação</th></tr></thead>
              <tbody>${abaixoMinimo.map(p=>{ const st = statusEstoque(p); return `
                <tr>
                  <td><div class="cell-main">${esc(p.nome)}</div><div class="cell-sub mono">${esc(p.sku)}</div></td>
                  <td><span class="badge st-${st.k}">${st.label}</span></td>
                  <td class="col-meter">${medidorEstoque(p)}</td>
                  <td class="mono num t-danger strong">${p.estoque} <small class="dim">${esc(p.unidade)}</small></td>
                  <td class="mono num dim">${p.quantidadeMinima} ${esc(p.unidade)}</td>
                  <td class="col-actions"><button class="icon-btn" data-repor="${p.id}">Repor / Editar</button></td>
                </tr>`; }).join('')}
              </tbody>
            </table>
            </div>
          `}
        </div>
      </div>
    `);

    dashboardEl.querySelectorAll('.stat-card').forEach(card => {
      card.onclick = () => {
        const type = card.dataset.card;
        if(type === 'reposicao'){ state.modal = { type: 'alerta-reposicao' }; render(); }
        else if(type === 'urgente'){ state.tab = 'solicitacoes'; render(); }
        else if(type === 'pendentes'){ state.tab = 'solicitacoes'; state.filtroStatus = 'pendente'; render(); }
        else if(type === 'total'){ state.tab = 'produtos'; render(); }
        else if(type === 'capital'){ state.modal = { type: 'resumo-capital' }; render(); }
      };
    });

    const btnVerPend = dashboardEl.querySelector('#btn-ver-pendentes');
    if(btnVerPend) btnVerPend.onclick = () => { state.tab = 'solicitacoes'; state.filtroStatus = 'pendente'; render(); };

    const btnDetalhes = dashboardEl.querySelector('#btn-ver-alerta-detalhado');
    if(btnDetalhes) btnDetalhes.onclick = () => { state.modal = { type: 'alerta-reposicao' }; render(); };

    const btnExportarCompras = dashboardEl.querySelector('#btn-exportar-compras');
    if(btnExportarCompras) btnExportarCompras.onclick = exportarListaCompras;

    const btnExportarUrgente = dashboardEl.querySelector('#btn-exportar-urgente');
    if(btnExportarUrgente) btnExportarUrgente.onclick = () => exportarComprasUrgentes(itensUrgentes);

    dashboardEl.querySelectorAll('[data-repor]').forEach(b => {
      b.onclick = () => {
        const p = state.produtos.find(x => x.id === b.dataset.repor);
        state.modal = { type: 'produto-form', produto: p };
        render();
      };
    });

    content.appendChild(dashboardEl);
  }

  function renderProdutos(content){
    const cats = ['todas', ...new Set(state.produtos.map(p => p.categoria))];
    if(!state.filtroEstoque) state.filtroEstoque = 'todos';

    const totalRepor = state.produtos.filter(p => statusEstoque(p).k !== 'ok').length;
    const totalZero = state.produtos.filter(p => statusEstoque(p).k === 'zero').length;
    const valorTotal = state.produtos.reduce((a,p)=>a + Number(p.estoque||0) * Number(p.preco||0),0);

    const wrap = elFrag(`
      <div class="page">
        <div class="summary-strip">
          <div class="summary-item"><span>Produtos</span><strong>${state.produtos.length}</strong></div>
          <div class="summary-item ${totalRepor ? 'is-warn' : ''}"><span>Para repor</span><strong>${totalRepor}</strong></div>
          <div class="summary-item ${totalZero ? 'is-danger' : ''}"><span>Sem estoque</span><strong>${totalZero}</strong></div>
          <div class="summary-item"><span>Valor em estoque</span><strong>${fmtMoney(valorTotal)}</strong></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>Catálogo de produtos</h3>
            <div class="btn-group">
              <button class="secondary" id="export-produtos">📥 Exportar CSV</button>
              <button class="primary" id="add-produto">+ Novo produto</button>
            </div>
          </div>
          <div class="toolbar">
            <div class="search"><input id="busca-produto" placeholder="Buscar por nome ou SKU…" value="${esc(state.buscaProduto)}"></div>
            <select id="filtro-cat">
              ${cats.map(c => `<option value="${esc(c)}" ${state.filtroCategoria===c?'selected':''}>${c==='todas'?'Todas as categorias':esc(c)}</option>`).join('')}
            </select>
            <select id="filtro-est">
              <option value="todos" ${state.filtroEstoque==='todos'?'selected':''}>Todas as situações</option>
              <option value="baixo" ${state.filtroEstoque==='baixo'?'selected':''}>Para repor</option>
              <option value="zero" ${state.filtroEstoque==='zero'?'selected':''}>Sem estoque</option>
            </select>
            <span class="toolbar-count" id="produtos-count"></span>
          </div>
          <div id="produtos-table"></div>
        </div>
      </div>
    `);
    content.appendChild(wrap);
    const panel = wrap;

    panel.querySelector('#add-produto').onclick = ()=>{ state.modal={type:'produto-form'}; render(); };

    panel.querySelector('#export-produtos').onclick = () => {
      exportarCSV(state.produtos.map(p => ({ SKU: p.sku, Nome: p.nome, Categoria: p.categoria, Estoque: p.estoque, Unidade: p.unidade, PrecoUnitario: p.preco, Fornecedor: p.fornecedor })), 'Inventario_Estoque');
    };

    panel.querySelector('#busca-produto').oninput = (e)=>{ state.buscaProduto=e.target.value; renderTable(); };
    panel.querySelector('#filtro-cat').onchange = (e)=>{ state.filtroCategoria=e.target.value; renderTable(); };
    panel.querySelector('#filtro-est').onchange = (e)=>{ state.filtroEstoque=e.target.value; renderTable(); };

    function renderTable(){
      const box = panel.querySelector('#produtos-table');
      const q = (state.buscaProduto||'').toLowerCase();
      const list = state.produtos.filter(p=> {
        const matchBusca = !q || p.nome.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
        const matchCat = state.filtroCategoria === 'todas' || p.categoria === state.filtroCategoria;
        const k = statusEstoque(p).k;
        const matchEst = state.filtroEstoque === 'todos' || (state.filtroEstoque === 'zero' ? k === 'zero' : k !== 'ok');
        return matchBusca && matchCat && matchEst;
      });
      panel.querySelector('#produtos-count').textContent = `${list.length} de ${state.produtos.length}`;

      if(list.length===0){ box.innerHTML = `<div class="empty-state"><div class="glyph">📦</div>Nenhum produto encontrado com esse filtro.</div>`; return; }
      box.innerHTML = `
        <div class="table-scroll">
        <table>
          <thead><tr><th>Material</th><th>Categoria</th><th>Situação</th><th class="col-meter">Nível</th><th class="num">Estoque</th><th class="num">Mínimo</th><th class="num">Custo unit.</th><th>Fornecedor</th><th class="col-actions">Ações</th></tr></thead>
          <tbody>${list.map(p=>{ const st = statusEstoque(p); return `
            <tr>
              <td><div class="cell-main">${esc(p.nome)}</div><div class="cell-sub mono">${esc(p.sku)}</div></td>
              <td><span class="chip">${esc(p.categoria)}</span></td>
              <td><span class="badge st-${st.k}">${st.label}</span></td>
              <td class="col-meter">${medidorEstoque(p)}</td>
              <td class="mono num ${st.k!=='ok'?'t-danger strong':''}">${p.estoque} <small class="dim">${esc(p.unidade)}</small></td>
              <td class="mono num dim">${p.quantidadeMinima} ${esc(p.unidade)}</td>
              <td class="mono num">${fmtMoney(p.preco)}</td>
              <td class="dim">${esc(p.fornecedor)||'—'}</td>
              <td class="col-actions">
                <button class="icon-btn" data-act="editar" data-id="${p.id}">Editar</button>
                <button class="icon-btn danger" data-act="excluir" data-id="${p.id}">Excluir</button>
              </td>
            </tr>
          `; }).join('')}</tbody>
        </table>
        </div>
      `;
      box.querySelectorAll('[data-act]').forEach(btn=>{
        btn.onclick = ()=>{
          const p = state.produtos.find(x=>x.id===btn.dataset.id);
          state.modal = btn.dataset.act==='editar' ? {type:'produto-form', produto:p} : {type:'confirmar-exclusao', produto:p};
          render();
        };
      });
    }
    renderTable();
  }

  function renderSolicitacoes(content){
    const ABAS_STATUS = [
      { valor: 'pendente',  label: 'Pendentes' },
      { valor: 'aprovado',  label: 'Aprovados' },
      { valor: 'entregue',  label: 'Entregues' },
      { valor: 'rejeitado', label: 'Reprovados' },
      { valor: 'cancelado', label: 'Cancelados' },
    ];
    // Aba padrão: pendentes (o que o admin mais precisa ver primeiro).
    if(!ABAS_STATUS.some(a => a.valor === state.filtroStatus)){
      state.filtroStatus = 'pendente';
    }

    const contagens = Object.fromEntries(ABAS_STATUS.map(a => [a.valor, state.solicitacoes.filter(s => s.status === a.valor).length]));

    const panel = elFrag(`
      <div class="panel">
        <div class="panel-head">
          <h3>Fila de pedidos e requisições</h3>
          <button class="secondary" id="export-solicitacoes">📥 Exportar relatório CSV</button>
        </div>

        <div class="seg" role="tablist">
          ${ABAS_STATUS.map(a => `
            <button class="status-tab-btn seg-${a.valor} ${state.filtroStatus===a.valor?'active':''}" role="tab" aria-selected="${state.filtroStatus===a.valor}" data-status="${a.valor}">
              ${a.label} <span class="seg-count">${contagens[a.valor]}</span>
            </button>
          `).join('')}
        </div>

        <div class="toolbar">
          <div class="search"><input id="busca-sol" placeholder="Buscar por colaborador, e-mail, setor ou item…" value="${esc(state.buscaSolicitacao)}"></div>
          <select id="ordenacao">
            <option value="recentes" ${state.ordenacao==='recentes'?'selected':''}>Mais recentes</option>
            <option value="urgencia" ${state.ordenacao==='urgencia'?'selected':''}>Maior urgência</option>
          </select>
          <span class="toolbar-count" id="sol-count"></span>
        </div>
        <div id="sol-table"></div>
      </div>
    `);
    content.appendChild(panel);

    panel.querySelector('#export-solicitacoes').onclick = () => {
      exportarCSV(state.solicitacoes.map(s => ({ Solicitante: s.nome, Email: s.email, Setor: s.setor, Material: s.item, Quantidade: s.quantidade, Endereco: s.endereco, Urgencia: s.urgencia, Status: s.status, Data: s.dataCriacao })), 'Relatorio_Solicitacoes');
    };

    panel.querySelectorAll('.status-tab-btn').forEach(btn => {
      btn.onclick = () => { state.filtroStatus = btn.dataset.status; render(); };
    });

    panel.querySelector('#busca-sol').oninput = (e)=>{ state.buscaSolicitacao=e.target.value; renderTable(); };
    panel.querySelector('#ordenacao').onchange = (e)=>{ state.ordenacao=e.target.value; renderTable(); };

    // Define quais ações fazem sentido a partir de cada status atual.
    function acoesDisponiveis(status){
      if(status==='pendente')  return [{to:'aprovado', label:'Aprovar', tone:'ok'}, {to:'rejeitado', label:'Rejeitar', tone:'danger'}];
      if(status==='aprovado')  return [{to:'entregue', label:'Marcar entregue', tone:'steel'}, {to:'rejeitado', label:'Rejeitar', tone:'danger'}];
      if(status==='rejeitado') return [{to:'pendente', label:'Reabrir pedido', tone:'amber'}];
      return [];
    }

    function renderTable(){
      const box = panel.querySelector('#sol-table');
      const urgOrder = {alta:0, normal:1, baixa:2};
      let list = state.solicitacoes.filter(s=>{
        const q = state.buscaSolicitacao.toLowerCase();
        const matchBusca = !q || s.nome.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.item.toLowerCase().includes(q) || (s.setor||'').toLowerCase().includes(q);
        return matchBusca && s.status === state.filtroStatus;
      });
      list = [...list].sort((a,b)=> state.ordenacao==='urgencia' ? urgOrder[a.urgencia]-urgOrder[b.urgencia] : new Date(b.dataCriacao)-new Date(a.dataCriacao));
      panel.querySelector('#sol-count').textContent = `${list.length} ${list.length===1?'pedido':'pedidos'}`;

      if(list.length===0){ box.innerHTML = `<div class="empty-state"><div class="glyph">📝</div>Nenhuma solicitação nesse status.</div>`; return; }
      box.innerHTML = `
        <div class="table-scroll">
        <table>
          <thead><tr><th>Colaborador</th><th>Material / descrição</th><th class="num">Qtd</th><th>Urgência</th><th>Data</th><th class="col-actions">Ações</th></tr></thead>
          <tbody>${list.map(s=>`
            <tr class="${s.urgencia==='alta' && s.status==='pendente' ? 'row-urgente' : ''}">
              <td><div class="cell-main">${esc(s.nome)}</div><div class="cell-sub email-cell">${esc(s.email)}</div></td>
              <td>${formatarMateriaisCompacto(s)}</td>
              <td class="mono num strong">${s.quantidade}</td>
              <td><span class="badge urg-${esc(s.urgencia)}">${esc(s.urgencia).toUpperCase()}</span></td>
              <td class="dim mono small">${fmtDate(s.dataCriacao)}</td>
              <td class="col-actions">
                <button class="icon-btn" data-act="detalhes" data-id="${s.id}">Ver</button>
                ${acoesDisponiveis(s.status).map(a => `<button class="icon-btn tone-${a.tone}" data-act="${a.to}" data-id="${s.id}">${a.label}</button>`).join('')}
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
        </div>
      `;
      box.querySelectorAll('[data-act]').forEach(btn=>{
        btn.onclick = async ()=>{
          const id = btn.dataset.id;
          const act = btn.dataset.act;
          if(act==='detalhes'){
            const s = state.solicitacoes.find(x=>x.id===id);
            state.modal = {type:'detalhe-solicitacao', solicitacao:s};
            render();
          } else {
            await atualizarStatus(id, act);
            render();
          }
        };
      });
    }
    renderTable();
  }

  function renderLogs(content){
    if(state.buscaLog === undefined) state.buscaLog = '';
    const panel = elFrag(`
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>Histórico de auditoria</h3>
            <p class="panel-sub">Registro das ações feitas neste painel, da mais recente para a mais antiga.</p>
          </div>
          <button class="secondary" id="export-logs">📥 Exportar logs CSV</button>
        </div>
        ${state.logs.length===0 ? `<div class="empty-state"><div class="glyph">📜</div>Nenhum registro de log encontrado.</div>` : `
          <div class="toolbar">
            <div class="search"><input id="busca-log" placeholder="Buscar por ação, administrador ou detalhe…" value="${esc(state.buscaLog)}"></div>
            <span class="toolbar-count" id="log-count"></span>
          </div>
          <div id="log-table"></div>
        `}
      </div>
    `);
    panel.querySelector('#export-logs').onclick = () => exportarCSV(state.logs, 'Logs_Auditoria');
    content.appendChild(panel);
    if(state.logs.length === 0) return;

    function renderTable(){
      const q = (state.buscaLog||'').toLowerCase();
      const list = state.logs.filter(l => !q || [l.usuario, l.acao, l.detalhe].some(v => String(v||'').toLowerCase().includes(q)));
      panel.querySelector('#log-count').textContent = `${list.length} de ${state.logs.length}`;
      const box = panel.querySelector('#log-table');
      if(list.length === 0){ box.innerHTML = `<div class="empty-state"><div class="glyph">🔍</div>Nenhum registro encontrado.</div>`; return; }
      box.innerHTML = `
        <div class="table-scroll">
        <table>
          <thead><tr><th>Data / hora</th><th>Administrador</th><th>Ação</th><th>Detalhes</th></tr></thead>
          <tbody>${list.map(l=>`
            <tr>
              <td class="mono dim small nowrap">${fmtDate(l.data)}</td>
              <td><span class="chip chip-steel">${esc(l.usuario)}</span></td>
              <td><span class="chip chip-mono">${esc(l.acao)}</span></td>
              <td class="dim">${esc(l.detalhe)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
        </div>`;
    }
    panel.querySelector('#busca-log').oninput = (e)=>{ state.buscaLog = e.target.value; renderTable(); };
    renderTable();
  }

  function renderConfig(content){
    const wrap = elFrag(`
      <div class="page settings-grid">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h3>📧 Notificações</h3>
              <p class="panel-sub">Define quem recebe os avisos das novas solicitações.</p>
            </div>
          </div>
          <div class="field">
            <label for="cfg-email">E-mail responsável pelo recebimento de solicitações</label>
            <input id="cfg-email" value="${esc(state.emailControle)}" placeholder="yuri.silva1@sgs.com">
          </div>
          <div class="form-actions">
            <button class="primary" id="btn-salvar-cfg">Salvar alterações</button>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h3>👤 Sessão</h3>
              <p class="panel-sub">Conta administrativa conectada neste navegador.</p>
            </div>
          </div>
          <dl class="detail-grid">
            <dt>E-mail</dt><dd class="mono break">${esc(state.session.user.email)}</dd>
            <dt>Tema</dt><dd>${state.theme === 'dark' ? 'Escuro' : 'Claro'}</dd>
          </dl>
          <div class="form-actions">
            <button class="secondary" id="btn-sair-cfg">🚪 Sair da conta</button>
          </div>
        </div>
      </div>
    `);
    wrap.querySelector('#btn-sair-cfg').onclick = logoutUser;
    wrap.querySelector('#btn-salvar-cfg').onclick = async () => {
      const val = wrap.querySelector('#cfg-email').value.trim();
      if(!val){ showToast('Informe um e-mail válido.'); return; }
      const { error } = await supabaseClient.from('config').upsert({ chave: 'email_controle', valor: val });
      if(error){ showToast('Erro ao salvar: ' + error.message); return; }
      state.emailControle = val;
      await addLog('CONFIG', `E-mail de controle alterado para ${val}`);
      showToast('Configurações salvas com sucesso!');
      render();
    };
    content.appendChild(wrap);
  }

  function renderModal(){
    const m = state.modal;
    let inner = '';

    if(m.type==='produto-form'){
      const p = m.produto || {};
      inner = `
        <h3>${p.id ? 'Editar produto / estoque' : 'Cadastrar novo produto'}</h3>
        <p class="modal-sub">Preencha as informações técnicas e os níveis do item. Campos com * são obrigatórios.</p>

        <div class="form-section">Identificação</div>
        <div class="field"><label>Nome do material / descrição *</label><input id="m-nome" value="${esc(p.nome)}"></div>
        <div class="field-row">
          <div class="field"><label>SKU / código *</label><input id="m-sku" value="${esc(p.sku)}"></div>
          <div class="field"><label>Categoria *</label><input id="m-cat" value="${p.categoria ? esc(p.categoria) : 'EPIs'}"></div>
        </div>

        <div class="form-section">Níveis de estoque</div>
        <div class="field-row">
          <div class="field"><label>Estoque atual *</label><input id="m-qtd" type="number" min="0" value="${p.estoque !== undefined ? p.estoque : 25}"></div>
          <div class="field"><label>Estoque mínimo (alerta) *</label><input id="m-min" type="number" min="0" value="${p.quantidadeMinima || 5}"></div>
        </div>

        <div class="form-section">Custo e fornecedor</div>
        <div class="field-row">
          <div class="field"><label>Preço unitário (R$)</label><input id="m-preco" type="number" step="0.01" min="0" value="${p.preco || 35.0}"></div>
          <div class="field"><label>Fornecedor</label><input id="m-forn" value="${p.fornecedor ? esc(p.fornecedor) : 'Suprimentos Corporativos'}"></div>
        </div>

        <div class="modal-actions">
          <button class="secondary" id="modal-cancel">Cancelar</button>
          <button class="primary" id="modal-save">Salvar produto</button>
        </div>
      `;
    } else if(m.type==='confirmar-exclusao'){
      const p = m.produto;
      inner = `
        <h3>Excluir Produto</h3>
        <p class="modal-sub">Tem certeza que deseja remover permanentemente o item <strong>${esc(p.nome)}</strong> (${esc(p.sku)}) do catálogo?</p>
        <div class="modal-actions">
          <button class="secondary" id="modal-cancel">Cancelar</button>
          <button class="primary btn-danger" id="modal-confirm-del">Sim, Excluir</button>
        </div>
      `;
    } else if(m.type==='alerta-reposicao'){
      const abaixo = state.produtos.filter(p => p.estoque <= p.quantidadeMinima);
      inner = `
        <h3>Itens com Necessidade de Reposição</h3>
        <p class="modal-sub">Relação de SKUs com estoque igual ou inferior ao mínimo configurado.</p>
        ${abaixo.length === 0 ? `<div class="empty-state">Nenhum item em falta.</div>` : `
          <div class="table-scroll">
          <table>
            <thead><tr><th>Material</th><th>SKU</th><th>Estoque</th><th>Mínimo</th></tr></thead>
            <tbody>${abaixo.map(p=>`
              <tr>
                <td>${esc(p.nome)}</td>
                <td class="mono dim">${esc(p.sku)}</td>
                <td class="mono t-danger strong">${p.estoque}</td>
                <td class="mono dim">${p.quantidadeMinima}</td>
              </tr>
            `).join('')}</tbody>
          </table>
          </div>
        `}
        <div class="modal-actions">
          ${abaixo.length > 0 ? `<button class="secondary" id="modal-exportar-compras">📥 Exportar Lista de Compras</button>` : ''}
          <button class="primary" id="modal-cancel">Fechar</button>
        </div>
      `;
    } else if(m.type==='resumo-capital'){
      const valorTotal = state.produtos.reduce((a,p)=>a + p.estoque * p.preco,0);
      inner = `
        <h3>Resumo de Capital Imobilizado</h3>
        <p class="modal-sub">Valuation atual do almoxarifado baseado nos estoques do banco de dados.</p>
        <div class="big-number">${fmtMoney(valorTotal)}</div>
        <p class="dim small">Total de <strong>${state.produtos.length}</strong> SKUs monitorados em tempo real.</p>
        <div class="modal-actions">
          <button class="primary" id="modal-cancel">Fechar</button>
        </div>
      `;
    } else if(m.type==='detalhe-solicitacao'){
      const s = m.solicitacao;
      const itens = s.itens || [];
      const mailtoLink = buildMailto(s.email, `[SUPRIMENTOS] Atualização sobre sua solicitação (${s.item})`, `Olá ${s.nome},\n\nSua solicitação do item "${s.item}" (Quantidade: ${s.quantidade}) encontra-se com status: ${s.status.toUpperCase()}.\n\nAtenciosamente,\nAlmoxarifado BackOffice`);

      const semEstoqueAlgum = itens.some(it => it.disponivel === false);

      inner = `
        <div class="modal-head">
          <div>
            <h3>Detalhes da requisição</h3>
            <p class="modal-sub">Pedido de ${fmtDate(s.dataCriacao)}</p>
          </div>
          <div class="btn-group">
            <span class="badge urg-${esc(s.urgencia)}">${esc(s.urgencia).toUpperCase()}</span>
            <span class="badge ${esc(s.status)}">${esc(s.status).toUpperCase()}</span>
          </div>
        </div>

        <div class="form-section">Solicitante</div>
        <dl class="detail-grid">
          <dt>Nome</dt><dd>${esc(s.nome)}</dd>
          <dt>E-mail</dt><dd><a class="link" href="${esc(mailtoLink)}">${esc(s.email)} ✉️</a></dd>
          <dt>Matrícula</dt><dd>${esc(s.matricula) || '—'}</dd>
          <dt>Setor / centro</dt><dd>${esc(s.setor) || '—'} (${esc(s.centroCusto) || '—'})</dd>
        </dl>

        <div class="form-section">Materiais solicitados</div>
        ${semEstoqueAlgum ? `<div class="alert-box">⚠️ Este pedido tem item(ns) sem estoque no momento — compra urgente necessária.</div>` : ''}
        ${itens.length > 0 ? `
          <div class="table-scroll">
          <table class="table-compact">
            <thead><tr><th>Material</th><th>SKU</th><th class="num">Qtd.</th><th>Disponibilidade</th></tr></thead>
            <tbody>
              ${itens.map(it => {
                const semEstoque = it.disponivel === false;
                return `
                <tr class="${semEstoque ? 'row-sem-estoque' : ''}">
                  <td><div class="cell-main ${semEstoque ? 't-danger' : ''}">${esc(it.nome)}</div>${it.categoria ? `<div class="cell-sub">${esc(it.categoria)}</div>` : ''}</td>
                  <td class="mono dim">${esc(it.sku)}</td>
                  <td class="mono num strong">${it.quantidade}</td>
                  <td>${semEstoque ? `<span class="badge st-zero">Sem estoque</span>` : `<span class="badge st-ok">Reservado</span>`}</td>
                </tr>`;}).join('')}
            </tbody>
            <tfoot>
              <tr><td colspan="2" class="num dim">TOTAL</td><td class="mono num strong t-accent">${s.quantidade}</td><td></td></tr>
            </tfoot>
          </table>
          </div>
        ` : `
          <div class="info-box">
            <strong class="t-accent">${esc(s.item)}</strong>
            <div class="dim small">Item personalizado (fora do catálogo) · Quantidade: ${s.quantidade}</div>
          </div>
        `}

        <div class="form-section">Endereço de entrega</div>
        <div class="info-box">📍 ${esc(s.endereco) || 'Não informado.'}</div>

        <div class="form-section">Observações</div>
        <div class="info-box">${esc(s.motivo) || 'Nenhuma observação informada.'}</div>

        <div class="modal-actions">
          <button class="primary" id="modal-cancel">Fechar</button>
        </div>
      `;
    }

    const overlay = elFrag(`<div class="overlay"><div class="modal">${inner}</div></div>`);
    overlay.onclick = (e)=>{ if(e.target===overlay){ state.modal=null; render(); } };

    const cancelBtn = overlay.querySelector('#modal-cancel');
    if(cancelBtn) cancelBtn.onclick = ()=>{ state.modal=null; render(); };

    const saveProdBtn = overlay.querySelector('#modal-save');
    if(saveProdBtn){
      saveProdBtn.onclick = async ()=>{
        const nome = overlay.querySelector('#m-nome').value.trim();
        const sku = overlay.querySelector('#m-sku').value.trim();
        const categoria = overlay.querySelector('#m-cat').value.trim();
        const qtd = parseInt(overlay.querySelector('#m-qtd').value)||0;
        const min = parseInt(overlay.querySelector('#m-min').value)||5;
        const preco = parseFloat(overlay.querySelector('#m-preco').value)||0;
        const fornecedor = overlay.querySelector('#m-forn').value.trim();

        if(!nome || !sku){ showToast('Preencha os campos obrigatórios (Nome e SKU).'); return; }

        const payload = { nome, sku, categoria, quantidade: qtd, quantidadeMinima: min, preco, fornecedor };
        if(m.produto && m.produto.id){
          await updateProduto(m.produto.id, payload);
        } else {
          await addProduto(payload);
        }
        state.modal = null;
        render();
      };
    }

    const delBtn = overlay.querySelector('#modal-confirm-del');
    if(delBtn){
      delBtn.onclick = async ()=>{
        await deleteProduto(m.produto.id);
        state.modal = null;
        render();
      };
    }

    const exportarComprasBtn = overlay.querySelector('#modal-exportar-compras');
    if(exportarComprasBtn) exportarComprasBtn.onclick = exportarListaCompras;

    app.appendChild(overlay);
  }

  loadAll();
})();

// Registro do Service Worker (PWA) — permite instalar o painel como app no
// celular. Falha em silêncio se o navegador não suportar ou se o sw.js ainda
// não existir no servidor.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}