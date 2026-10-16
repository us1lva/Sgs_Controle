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
  const html = document.documentElement;

  // Fundo decorativo leve: camadas estáticas, adaptadas ao tema por CSS.
  // Evita canvas, scanners e rastros que competiam com as informações do painel.
  function montarFundo(){
    if(document.querySelector('.mx-bg')) return;
    const appEl = document.getElementById('app');
    if(appEl){ appEl.style.position = 'relative'; appEl.style.zIndex = '1'; }

    const fundo = document.createElement('div');
    fundo.className = 'mx-bg';
    fundo.setAttribute('aria-hidden', 'true');
    fundo.innerHTML = '<i></i><i></i><i></i>';
    document.body.insertBefore(fundo, document.body.firstChild);
  }

  // Mantém uma transição elegante ao alternar claro/escuro, sem exigir suporte.
  window.mxTransicaoTema = function(ev, aplicar){
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduz || !document.startViewTransition || !ev){ aplicar(); return; }
    const x = ev.clientX, y = ev.clientY;
    const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transicao = document.startViewTransition(aplicar);
    transicao.ready.then(() => {
      html.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + raio + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 560, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarFundo);
  else montarFundo();
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

  // =====================================================================
// ABA "CORREIOS" — cole este bloco INTEIRO dentro do app.js, logo depois
// da linha:  document.documentElement.setAttribute('data-theme', state.theme);
// (ainda dentro do  (function(){ ... })();  principal).
// As 5 pequenas edições no restante do arquivo estão no PASSO-A-PASSO.md.
// =====================================================================

Object.assign(state, {
  correios: [],
  buscaCorreio: '',
  filtroCorreio: 'todos',        // todos | pendente | concluido
  filtroOrigemCorreio: 'todas',  // todas | sistema | manual | importado
});

const CORREIO_ORIGEM = { sistema: 'Sistema', manual: 'Manual', importado: 'Importado' };

// ---------- Conversões ------------------------------------------------
function mapCorreio(r){
  return {
    id: r.id, solicitacaoId: r.solicitacao_id,
    inspetor: r.inspetor || '', centroCusto: r.centro_custo || '', endereco: r.endereco || '',
    cap: r.cap || '', dataEnvio: r.data_envio || '', rastreio: r.rastreio || '',
    tipo: r.tipo || '', status: r.status || 'pendente', responsavel: r.responsavel || '',
    anexo1: r.anexo1 || '', anexo2: r.anexo2 || '', previsao: r.previsao_entrega || '',
    origem: r.origem || 'manual'
  };
}
function correioParaBanco(c){
  const vazio = v => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
  return {
    inspetor: String(c.inspetor || '').trim(),
    centro_custo: vazio(c.centroCusto), endereco: vazio(c.endereco), cap: vazio(c.cap),
    data_envio: vazio(c.dataEnvio), rastreio: vazio(c.rastreio), tipo: vazio(c.tipo),
    status: c.status === 'concluido' ? 'concluido' : 'pendente',
    responsavel: vazio(c.responsavel), anexo1: vazio(c.anexo1), anexo2: vazio(c.anexo2),
    previsao_entrega: vazio(c.previsao)
  };
}
// "2026-07-14" -> "14/07/2026" (sem passar por Date, para não mudar o dia por fuso)
function fmtDia(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
}
// "yuri.silva1@sgs.com" -> "Yuri Silva"
function nomeDoEmail(email){
  const local = String(email || '').split('@')[0].replace(/[0-9]+/g, '');
  return local.split(/[._-]+/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// ---------- Banco de dados --------------------------------------------
async function carregarCorreios(){
  const { data, error } = await supabaseClient.from('correios').select('*')
    .order('data_envio', { ascending: false, nullsFirst: false })
    .order('criado_em', { ascending: false })
    .range(0, 4999);
  if(error){ console.error(error); return []; }
  return (data || []).map(mapCorreio);
}

// Estas funções devolvem uma mensagem de erro (ou null). Quem chama decide o aviso,
// porque showToast() redesenha a tela e apagaria o formulário aberto.
async function addCorreio(c, origem){
  const { error } = await supabaseClient.from('correios').insert({ ...correioParaBanco(c), origem: origem || 'manual' });
  if(error) return error.message;
  state.correios = await carregarCorreios();
  await addLog('CORREIO_ADICIONAR', `Envio de "${c.inspetor}" adicionado manualmente.`);
  return null;
}
async function updateCorreio(id, c){
  const { error } = await supabaseClient.from('correios')
    .update({ ...correioParaBanco(c), atualizado_em: new Date().toISOString() }).eq('id', id);
  if(error) return error.message;
  state.correios = await carregarCorreios();
  await addLog('CORREIO_ATUALIZAR', `Envio de "${c.inspetor}" atualizado.`);
  return null;
}
async function deleteCorreio(item){
  const { error } = await supabaseClient.from('correios').delete().eq('id', item.id);
  if(error) return error.message;
  state.correios = await carregarCorreios();
  await addLog('CORREIO_EXCLUIR', `Envio de "${item.inspetor}" removido.`);
  return null;
}
async function importarCorreios(linhas){
  const registros = linhas.map(l => ({ ...correioParaBanco(l), origem: 'importado' }));
  for(let i = 0; i < registros.length; i += 200){
    const { error } = await supabaseClient.from('correios').insert(registros.slice(i, i + 200));
    if(error) return `Falha na linha ${i + 1} em diante: ${error.message}`;
  }
  state.correios = await carregarCorreios();
  await addLog('CORREIO_IMPORTAR', `${registros.length} envio(s) importado(s) de planilha.`);
  return null;
}

let realtimeCorreios = false, timerCorreios = null;
function garantirRealtimeCorreios(){
  if(realtimeCorreios) return;
  realtimeCorreios = true;
  supabaseClient.channel('admin-correios').on('postgres_changes', { event: '*', schema: 'public', table: 'correios' }, () => {
    clearTimeout(timerCorreios);                       // uma importação grande gera muitos eventos
    timerCorreios = setTimeout(async () => {
      state.correios = await carregarCorreios();
      if(!state.modal) render();                       // não apaga um formulário aberto
    }, 400);
  }).subscribe();
}

// ---------- Leitura da planilha .xlsx ---------------------------------
function normCabecalho(s){
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const CORREIO_CABECALHOS = {
  inspetor: 'inspetor', cc: 'centroCusto', centrodecusto: 'centroCusto', endereco: 'endereco', cap: 'cap',
  data: 'dataEnvio', nderatreio: 'rastreio', nderastreio: 'rastreio', rastreio: 'rastreio',
  tipo: 'tipo', status: 'status', responsavel: 'responsavel',
  anexos1: 'anexo1', anexo1: 'anexo1', anexo2: 'anexo2',
  previsaodeentrega: 'previsao', previsao: 'previsao'
};
function textoCelula(v){
  if(v === null || v === undefined) return '';
  if(v instanceof Date) return v.toISOString().slice(0, 10);
  if(typeof v === 'object'){
    if(Array.isArray(v.richText)) return v.richText.map(t => t.text).join('').trim();
    if(v.text !== undefined) return textoCelula(v.text);          // célula com hiperlink (ex.: CAP)
    if(v.result !== undefined) return textoCelula(v.result);      // célula com fórmula
    if(v.hyperlink) return String(v.hyperlink);
    return '';
  }
  return String(v).trim();
}
function dataParaISO(v){
  if(v instanceof Date) return v.toISOString().slice(0, 10);
  const s = textoCelula(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if(m){ const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}
function chaveCorreio(c){
  const r = String(c.rastreio || '').replace(/\s+/g, '').toLowerCase();
  return r ? 'r:' + r : `o:${String(c.inspetor).toLowerCase()}|${String(c.endereco).toLowerCase()}|${c.dataEnvio}`;
}
// Lê TODAS as abas que tenham a linha de cabeçalho com "INSPETOR" (ex.: 2026 e 2025).
async function lerPlanilhaCorreios(file){
  if(typeof ExcelJS === 'undefined') throw new Error('biblioteca de planilha não carregada — recarregue a página.');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const folhas = [];
  wb.worksheets.forEach(ws => {
    let linhaCab = 0;
    for(let r = 1; r <= Math.min(ws.rowCount, 10) && !linhaCab; r++){
      ws.getRow(r).eachCell(cell => { if(normCabecalho(textoCelula(cell.value)) === 'inspetor') linhaCab = r; });
    }
    if(!linhaCab) return;
    const colunas = {};
    ws.getRow(linhaCab).eachCell((cell, col) => {
      const k = CORREIO_CABECALHOS[normCabecalho(textoCelula(cell.value))];
      if(k && !colunas[k]) colunas[k] = col;
    });
    const linhas = [];
    for(let r = linhaCab + 1; r <= ws.rowCount; r++){
      const row = ws.getRow(r), reg = {};
      Object.entries(colunas).forEach(([k, col]) => {
        const v = row.getCell(col).value;
        reg[k] = k === 'dataEnvio' ? dataParaISO(v) : textoCelula(v);
      });
      if(!reg.inspetor && !reg.endereco && !reg.rastreio) continue;     // linha vazia formatada
      if(!reg.inspetor) reg.inspetor = '(sem nome)';
      reg.status = normCabecalho(reg.status).startsWith('conclu') ? 'concluido' : 'pendente';
      linhas.push(reg);
    }
    folhas.push({ nome: ws.name, linhas });
  });
  return folhas;
}

// ---------- Exportação (mesmas colunas da planilha) --------------------
async function exportarCorreios(){
  const lista = [...state.correios].sort((a, b) => String(a.dataEnvio).localeCompare(String(b.dataEnvio)));
  const colunas = [
    { header: 'INSPETOR', key: 'inspetor', width: 28 }, { header: 'C.C', key: 'cc', width: 10 },
    { header: 'ENDEREÇO', key: 'endereco', width: 52 }, { header: 'CAP', key: 'cap', width: 12 },
    { header: 'DATA', key: 'data', width: 13 }, { header: 'Nº DE RATREIO', key: 'rastreio', width: 22 },
    { header: 'TIPO', key: 'tipo', width: 12 }, { header: 'STATUS', key: 'status', width: 14 },
    { header: 'RESPONSÁVEL', key: 'responsavel', width: 18 }, { header: 'ANEXOS 1', key: 'anexo1', width: 22 },
    { header: 'ANEXO 2', key: 'anexo2', width: 22 }, { header: 'PREVISÃO DE ENTREGA', key: 'previsao', width: 22 },
  ];
  const linhas = lista.map(c => ({
    inspetor: c.inspetor, cc: c.centroCusto, endereco: c.endereco, cap: c.cap, data: fmtDia(c.dataEnvio),
    rastreio: c.rastreio, tipo: c.tipo, status: c.status === 'concluido' ? 'concluído' : 'aguardando envio',
    responsavel: c.responsavel, anexo1: c.anexo1, anexo2: c.anexo2, previsao: c.previsao
  }));
  await exportarExcelFormatado('Controle de Correio', colunas, linhas, 'Controle_de_Correio');
}

// ---------- Tela ------------------------------------------------------
function renderCorreios(content){
  const total = state.correios.length;
  const pend = state.correios.filter(c => c.status === 'pendente').length;
  const conc = total - pend;
  const manuais = state.correios.filter(c => c.origem !== 'sistema').length;

  const wrap = elFrag(`
    <div class="page">
      <div class="summary-strip">
        <div class="summary-item"><span>Registros</span><strong>${total}</strong></div>
        <div class="summary-item ${pend ? 'is-warn' : ''}"><span>Aguardando envio</span><strong>${pend}</strong></div>
        <div class="summary-item"><span>Concluídos</span><strong>${conc}</strong></div>
        <div class="summary-item"><span>Manuais e importados</span><strong>${manuais}</strong></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>Envios pelos Correios</h3>
            <p class="panel-sub">Pedidos aprovados ou entregues entram aqui sozinhos. Tudo que for alterado nesta tela é enviado para a planilha.</p>
          </div>
          <div class="btn-group">
            <button class="secondary" id="correio-export">📥 Baixar Excel</button>
            <button class="secondary" id="correio-import">📤 Importar planilha</button>
            <button class="primary" id="correio-add">+ Adicionar manualmente</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search"><input id="busca-correio" placeholder="Buscar por inspetor, endereço, rastreio, CAP ou C.C…" value="${esc(state.buscaCorreio)}"></div>
          <select id="filtro-correio">
            <option value="todos" ${state.filtroCorreio === 'todos' ? 'selected' : ''}>Todos os status</option>
            <option value="pendente" ${state.filtroCorreio === 'pendente' ? 'selected' : ''}>Aguardando envio</option>
            <option value="concluido" ${state.filtroCorreio === 'concluido' ? 'selected' : ''}>Concluídos</option>
          </select>
          <select id="filtro-origem-correio">
            <option value="todas" ${state.filtroOrigemCorreio === 'todas' ? 'selected' : ''}>Todas as origens</option>
            <option value="sistema" ${state.filtroOrigemCorreio === 'sistema' ? 'selected' : ''}>Vindos de solicitações</option>
            <option value="manual" ${state.filtroOrigemCorreio === 'manual' ? 'selected' : ''}>Adicionados manualmente</option>
            <option value="importado" ${state.filtroOrigemCorreio === 'importado' ? 'selected' : ''}>Importados</option>
          </select>
          <span class="toolbar-count" id="correio-count"></span>
        </div>
        <div id="correio-table"></div>
      </div>
    </div>
  `);
  content.appendChild(wrap);

  wrap.querySelector('#correio-export').onclick = exportarCorreios;
  wrap.querySelector('#correio-import').onclick = () => { state.modal = { type: 'correio-import' }; render(); };
  wrap.querySelector('#correio-add').onclick = () => { state.modal = { type: 'correio-form' }; render(); };
  wrap.querySelector('#busca-correio').oninput = e => { state.buscaCorreio = e.target.value; renderTabela(); };
  wrap.querySelector('#filtro-correio').onchange = e => { state.filtroCorreio = e.target.value; renderTabela(); };
  wrap.querySelector('#filtro-origem-correio').onchange = e => { state.filtroOrigemCorreio = e.target.value; renderTabela(); };

  function renderTabela(){
    const box = wrap.querySelector('#correio-table');
    const q = (state.buscaCorreio || '').toLowerCase();
    const lista = state.correios.filter(c => {
      const texto = [c.inspetor, c.endereco, c.rastreio, c.cap, c.centroCusto, c.responsavel].join(' ').toLowerCase();
      return (!q || texto.includes(q))
        && (state.filtroCorreio === 'todos' || c.status === state.filtroCorreio)
        && (state.filtroOrigemCorreio === 'todas' || c.origem === state.filtroOrigemCorreio);
    });
    wrap.querySelector('#correio-count').textContent = `${lista.length} de ${state.correios.length}`;

    if(lista.length === 0){
      box.innerHTML = `<div class="empty-state"><div class="glyph">✉️</div>${state.correios.length ? 'Nenhum envio com esse filtro.' : 'Nenhum envio registrado. Aprove um pedido, adicione manualmente ou importe a planilha.'}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="table-scroll">
      <table>
        <thead><tr><th>Inspetor</th><th>Endereço</th><th>CAP</th><th>Data</th><th>Nº de rastreio</th><th>Tipo</th><th>Status</th><th>Responsável</th><th>Previsão</th><th>Origem</th><th class="col-actions">Ações</th></tr></thead>
        <tbody>${lista.map(c => `
          <tr>
            <td><div class="cell-main">${esc(c.inspetor)}</div><div class="cell-sub mono">C.C ${esc(c.centroCusto) || '—'}</div></td>
            <td class="col-end">${esc(c.endereco) || '—'}</td>
            <td class="mono">${esc(c.cap) || '—'}</td>
            <td class="mono small nowrap">${fmtDia(c.dataEnvio)}</td>
            <td class="mono small nowrap">${esc(c.rastreio) || '<span class="dim">aguardando</span>'}</td>
            <td>${esc(c.tipo) || '—'}</td>
            <td><span class="badge ${c.status === 'concluido' ? 'st-ok' : 'pendente'}">${c.status === 'concluido' ? 'Concluído' : 'Aguardando envio'}</span></td>
            <td class="dim">${esc(c.responsavel) || '—'}</td>
            <td class="dim">${esc(c.previsao) || '—'}</td>
            <td><span class="chip">${CORREIO_ORIGEM[c.origem] || esc(c.origem)}</span></td>
            <td class="col-actions">
              ${c.status === 'pendente' ? `<button class="icon-btn tone-ok" data-act="concluir" data-id="${c.id}">Concluir</button>` : ''}
              <button class="icon-btn" data-act="editar" data-id="${c.id}">Editar</button>
              <button class="icon-btn danger" data-act="excluir" data-id="${c.id}">Excluir</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
    box.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = async () => {
        const c = state.correios.find(x => x.id === btn.dataset.id);
        if(!c) return;
        if(btn.dataset.act === 'editar'){ state.modal = { type: 'correio-form', correio: c }; render(); }
        else if(btn.dataset.act === 'excluir'){ state.modal = { type: 'correio-excluir', correio: c }; render(); }
        else {
          const erro = await updateCorreio(c.id, { ...c, status: 'concluido', previsao: c.previsao || 'entregue' });
          showToast(erro ? 'Erro ao concluir: ' + erro : `Envio de ${c.inspetor} marcado como concluído.`);
        }
      };
    });
  }
  renderTabela();
}

// ---------- Janelas (modais) ------------------------------------------
function modalCorreioHtml(m){
  if(m.type === 'correio-form'){
    const c = m.correio || {};
    const novo = !c.id;
    const hoje = new Date().toISOString().slice(0, 10);
    return `
      <h3>${novo ? 'Adicionar envio manualmente' : 'Editar envio'}</h3>
      <p class="modal-sub">${novo ? 'Use para casos específicos que não passaram por uma solicitação.' : 'As alterações também são enviadas para a planilha.'}</p>
      <div class="alert-box" id="c-erro" style="display:none"></div>

      <div class="form-section">Destinatário</div>
      <div class="field-row">
        <div class="field"><label for="c-inspetor">Inspetor *</label><input id="c-inspetor" value="${esc(c.inspetor)}"></div>
        <div class="field"><label for="c-cc">C.C</label><input id="c-cc" value="${esc(c.centroCusto)}"></div>
      </div>
      <div class="field"><label for="c-end">Endereço</label><textarea id="c-end" rows="2">${esc(c.endereco)}</textarea></div>

      <div class="form-section">Envio</div>
      <div class="field-row-3">
        <div class="field"><label for="c-cap">CAP</label><input id="c-cap" value="${esc(c.cap)}"></div>
        <div class="field"><label for="c-data">Data</label><input id="c-data" type="date" value="${esc(c.dataEnvio || (novo ? hoje : ''))}"></div>
        <div class="field"><label for="c-tipo">Tipo</label><input id="c-tipo" list="c-tipos" value="${esc(c.tipo === undefined ? 'Caixa' : c.tipo)}"><datalist id="c-tipos"><option value="Caixa"><option value="Envelope"><option value="Documento"></datalist></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="c-rast">Nº de rastreio</label><input id="c-rast" value="${esc(c.rastreio)}" placeholder="AD 000 000 000 BR"></div>
        <div class="field"><label for="c-status">Status</label>
          <select id="c-status">
            <option value="pendente" ${c.status !== 'concluido' ? 'selected' : ''}>Aguardando envio</option>
            <option value="concluido" ${c.status === 'concluido' ? 'selected' : ''}>Concluído</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label for="c-resp">Responsável</label><input id="c-resp" value="${esc(c.responsavel !== undefined ? c.responsavel : nomeDoEmail(state.session.user.email))}"></div>
        <div class="field"><label for="c-prev">Previsão de entrega</label><input id="c-prev" value="${esc(c.previsao)}" placeholder="data ou “entregue”"></div>
      </div>

      <div class="form-section">Anexos (links ou observações)</div>
      <div class="field-row">
        <div class="field"><label for="c-a1">Anexo 1</label><input id="c-a1" value="${esc(c.anexo1)}"></div>
        <div class="field"><label for="c-a2">Anexo 2</label><input id="c-a2" value="${esc(c.anexo2)}"></div>
      </div>

      <div class="modal-actions">
        <button class="secondary" id="modal-cancel">Cancelar</button>
        <button class="primary" id="modal-save">${novo ? 'Adicionar envio' : 'Salvar alterações'}</button>
      </div>`;
  }

  if(m.type === 'correio-excluir'){
    const c = m.correio;
    return `
      <h3>Excluir envio</h3>
      <p class="modal-sub">Remover o envio de <strong>${esc(c.inspetor)}</strong>${c.rastreio ? ` (${esc(c.rastreio)})` : ''}? A linha também sai da planilha.</p>
      <div class="alert-box" id="c-erro" style="display:none"></div>
      <div class="modal-actions">
        <button class="secondary" id="modal-cancel">Cancelar</button>
        <button class="primary btn-danger" id="c-confirm-del">Sim, excluir</button>
      </div>`;
  }

  // correio-import
  if(!m.folhas){
    return `
      <h3>Importar planilha</h3>
      <p class="modal-sub">Escolha o arquivo .xlsx de controle de correio. Todas as abas que tiverem a coluna INSPETOR (por exemplo 2026 e 2025) serão lidas.</p>
      <div class="alert-box" id="c-erro" style="display:none"></div>
      <div class="field"><label for="c-file">Arquivo Excel</label><input id="c-file" type="file" accept=".xlsx"></div>
      <div class="info-box">Colunas reconhecidas: INSPETOR, C.C, ENDEREÇO, CAP, DATA, Nº DE RATREIO, TIPO, STATUS, RESPONSÁVEL, ANEXOS 1, ANEXO 2 e PREVISÃO DE ENTREGA. Linhas já existentes (mesmo nº de rastreio) são ignoradas.</div>
      <div class="modal-actions"><button class="secondary" id="modal-cancel">Cancelar</button></div>`;
  }
  return `
    <h3>Conferir antes de importar</h3>
    <p class="modal-sub">Arquivo: <strong>${esc(m.arquivo)}</strong></p>
    <div class="alert-box" id="c-erro" style="display:none"></div>
    <dl class="detail-grid">
      ${m.folhas.map(f => `<dt>Aba ${esc(f.nome)}</dt><dd>${f.linhas.length} linha(s)</dd>`).join('')}
      <dt>Novas</dt><dd class="t-accent">${m.novas.length}</dd>
      <dt>Já existentes</dt><dd>${m.duplicadas}</dd>
    </dl>
    ${m.novas.length ? `
      <div class="table-scroll"><table class="table-compact">
        <thead><tr><th>Inspetor</th><th>Data</th><th>Rastreio</th><th>Status</th></tr></thead>
        <tbody>${m.novas.slice(0, 5).map(l => `<tr><td>${esc(l.inspetor)}</td><td class="mono">${fmtDia(l.dataEnvio)}</td><td class="mono">${esc(l.rastreio) || '—'}</td><td>${l.status === 'concluido' ? 'Concluído' : 'Aguardando envio'}</td></tr>`).join('')}</tbody>
      </table></div>
      ${m.novas.length > 5 ? `<p class="dim small">Mostrando 5 de ${m.novas.length}.</p>` : ''}` : `<div class="info-box">Nada novo para importar.</div>`}
    <div class="modal-actions">
      <button class="secondary" id="modal-cancel">Cancelar</button>
      ${m.novas.length ? `<button class="primary" id="c-confirmar-import">Importar ${m.novas.length} linha(s)</button>` : ''}
    </div>`;
}

function bindModalCorreio(overlay, m){
  const erro = msg => { const b = overlay.querySelector('#c-erro'); if(b){ b.textContent = msg; b.style.display = 'block'; } };

  if(m.type === 'correio-form'){
    overlay.querySelector('#modal-save').onclick = async () => {
      const v = id => overlay.querySelector('#' + id).value.trim();
      const dados = {
        inspetor: v('c-inspetor'), centroCusto: v('c-cc'), endereco: v('c-end'), cap: v('c-cap'),
        dataEnvio: v('c-data'), rastreio: v('c-rast'), tipo: v('c-tipo'), status: v('c-status'),
        responsavel: v('c-resp'), previsao: v('c-prev'), anexo1: v('c-a1'), anexo2: v('c-a2')
      };
      if(!dados.inspetor){ erro('Informe o nome do inspetor.'); return; }   // sem render(): o formulário não é apagado
      const editando = m.correio && m.correio.id;
      const msg = editando ? await updateCorreio(m.correio.id, dados) : await addCorreio(dados, 'manual');
      if(msg){ erro('Não foi possível salvar: ' + msg); return; }
      state.modal = null;
      showToast(editando ? 'Envio atualizado e enviado para a planilha.' : 'Envio adicionado e enviado para a planilha.');
    };
  }

  if(m.type === 'correio-excluir'){
    overlay.querySelector('#c-confirm-del').onclick = async () => {
      const msg = await deleteCorreio(m.correio);
      if(msg){ erro('Não foi possível excluir: ' + msg); return; }
      state.modal = null;
      showToast('Envio removido.');
    };
  }

  if(m.type === 'correio-import'){
    const input = overlay.querySelector('#c-file');
    if(input) input.onchange = async () => {
      const arquivo = input.files[0];
      if(!arquivo) return;
      try {
        const folhas = await lerPlanilhaCorreios(arquivo);
        if(!folhas.length){ erro('Nenhuma aba com a coluna INSPETOR foi encontrada nesse arquivo.'); return; }
        const existentes = new Set(state.correios.map(chaveCorreio));
        const novas = []; let duplicadas = 0;
        folhas.forEach(f => f.linhas.forEach(l => {
          const k = chaveCorreio(l);
          if(existentes.has(k)){ duplicadas++; return; }
          existentes.add(k); novas.push(l);
        }));
        state.modal = { type: 'correio-import', arquivo: arquivo.name, folhas, novas, duplicadas };
        render();
      } catch(e){ erro('Não foi possível ler a planilha: ' + e.message); }
    };
    const confirmar = overlay.querySelector('#c-confirmar-import');
    if(confirmar) confirmar.onclick = async () => {
      confirmar.disabled = true; confirmar.textContent = 'Importando…';
      const msg = await importarCorreios(m.novas);
      if(msg){ erro(msg); confirmar.disabled = false; confirmar.textContent = `Importar ${m.novas.length} linha(s)`; return; }
      state.modal = null;
      showToast(`${m.novas.length} envio(s) importado(s).`);
    };
  }
}

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
    state.correios = await carregarCorreios();
    garantirRealtimeCorreios();
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
          ${navItem('correios', '✉️', 'Correios', state.correios.filter(c => c.status === 'pendente').length, 'warn')}
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
      correios:['Controle de Correio','Envios aprovados e entregues, em sincronia com a planilha'],
      solicitacoes:['Fila de Pedidos','Analise, aprova e acompanhe as requisições'],
      logs:['Auditoria e Histórico','Registro das últimas ações realizadas neste painel'],
      config:['Configurações do Sistema','Preferências globais de e-mail e parâmetros'],
    };
    const [title, sub] = titles[state.tab] || ['Painel',''];

    const topbar = elFrag(`
      <header class="topbar">
        <div class="topbar-main">
          <button class="menu-toggle-btn" id="menu-toggle-btn" aria-label="Abrir menu" title="Abrir menu">☰</button>
          <div class="topbar-heading">
            <div class="topbar-eyebrow"><span class="topbar-brand-mark"></span><span>SGS</span><span class="topbar-separator">/</span><span>CONTROLE DE ESTOQUE</span></div>
            <h2>${title}</h2>
            <p>${sub}</p>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="topbar-insights" aria-label="Indicadores operacionais">
            <div class="topbar-insight ${pendentes > 0 ? 'is-alert' : ''}" title="Solicitações que aguardam análise">
              <span class="topbar-insight-icon orders-icon" aria-hidden="true">↗</span>
              <span class="topbar-insight-copy"><small>Pedidos pendentes</small><strong>${pendentes}</strong></span>
            </div>
            <div class="topbar-insight ${qtdRepor > 0 ? 'is-warn' : ''}" title="Produtos no limite ou abaixo do estoque mínimo">
              <span class="topbar-insight-icon stock-icon" aria-hidden="true">▦</span>
              <span class="topbar-insight-copy"><small>Estoque baixo</small><strong>${qtdRepor}</strong></span>
            </div>
          </div>
          <button class="secondary theme-btn" id="theme-toggle-btn" aria-label="Alternar tema" title="Alternar tema">
            <span class="theme-symbol" aria-hidden="true">${state.theme === 'dark' ? '☼' : '◐'}</span>
            <span class="theme-label">${state.theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span>
          </button>
        </div>
      </header>
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
    // Identifica a aba para aplicar um layout compacto e específico sem duplicar estilos.
    content.className = `content content-${state.tab}`;
    content.dataset.tab = state.tab;
    main.appendChild(content);

    if(state.tab==='dashboard') renderDashboard(content);
    else if(state.tab==='produtos') renderProdutos(content);
    else if(state.tab==='correios') renderCorreios(content);
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
      else if(m.type.startsWith('correio')){ inner = modalCorreioHtml(m); }

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
    if(m.type.startsWith('correio')) bindModalCorreio(overlay, m);

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
