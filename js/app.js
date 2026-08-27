// ============================================================================
// Conexão com o Supabase (mesmo projeto/banco usado pelo portal do colaborador).
// ============================================================================
const SUPABASE_URL = 'https://nstyvsaolpwpqpigqsou.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZOU6Hpt3lUmQVBcPKL7Wyg_mxaLxEjx';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
    modal: null, toast: null,
  };

  document.documentElement.setAttribute('data-theme', state.theme);

  function fmtDate(iso){ const d=new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
  function fmtMoney(v){ return (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

  // Mostra os materiais de um pedido um por linha (nome ×quantidade), em vez do
  // texto corrido salvo no campo "item". Cai de volta pro texto corrido quando
  // não há itens de catálogo vinculados (caso de item personalizado).
  function formatarMateriaisCompacto(s){
    if(s.itens && s.itens.length > 0){
      return s.itens.map(it => `${esc(it.nome)} <span class="dim mono">×${it.quantidade}</span>`).join('<br>');
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
        .select('solicitacao_id, quantidade, produtos ( nome, sku, categoria )')
        .in('solicitacao_id', ids);

      if(!itensError && itensData){
        const porSolicitacao = {};
        itensData.forEach(row => {
          if(!porSolicitacao[row.solicitacao_id]) porSolicitacao[row.solicitacao_id] = [];
          porSolicitacao[row.solicitacao_id].push({
            nome: row.produtos ? row.produtos.nome : 'Produto removido',
            sku: row.produtos ? row.produtos.sku : '—',
            categoria: row.produtos ? row.produtos.categoria : '',
            quantidade: row.quantidade
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

  function render(){
    app.innerHTML = '';
    if(!state.loaded){ app.appendChild(elFrag(`<div style="padding:40px;" class="dim mono">Conectando ao banco de dados...</div>`)); return; }

    if(state.recuperandoSenha){ renderDefinirNovaSenhaModal(); return; }
    if(!state.session){ renderLogin(); return; }

    if(state.isAdmin === null){ app.appendChild(elFrag(`<div style="padding:40px;" class="dim mono">Verificando permissões...</div>`)); return; }

    if(!state.isAdmin){ renderAcessoNegado(); return; }

    if(state.toast) app.appendChild(elFrag(`<div class="toast"><span style="color:var(--ok)">✓</span> ${state.toast}</div>`));

    const pendentes = state.solicitacoes.filter(s=>s.status==='pendente').length;

    const sidebar = elFrag(`
      <div class="sidebar">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg viewBox="0 0 240 110" height="26" xmlns="http://www.w3.org/2000/svg" aria-label="SGS" style="display:block; flex-shrink:0;">
            <text x="0" y="82" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="98" letter-spacing="-3" fill="#77787B">SGS</text>
            <line x1="0" y1="96" x2="228" y2="96" stroke="#F47920" stroke-width="6"/>
            <line x1="210" y1="0" x2="210" y2="110" stroke="#F47920" stroke-width="6"/>
          </svg>
          <span class="brand-badge" style="margin-left:4px;">Controle de Estoque</span>
        </div>

        <div class="role-selector">
          <label>Sessão</label>
          <div class="mono" style="font-size:12px; color:var(--text); word-break:break-all;">${state.session.user.email}</div>
        </div>

        <div class="nav-item ${state.tab==='dashboard'?'active':''}" data-tab="dashboard">📊 Dashboard</div>
        <div class="nav-item ${state.tab==='produtos'?'active':''}" data-tab="produtos">📦 Produtos</div>
        <div class="nav-item ${state.tab==='solicitacoes'?'active':''}" data-tab="solicitacoes">📝 Solicitações<span class="dot ${pendentes?'show':''}"></span></div>
        <div class="nav-item ${state.tab==='logs'?'active':''}" data-tab="logs">📜 Histórico / Logs</div>
        <div class="nav-item ${state.tab==='config'?'active':''}" data-tab="config">⚙️ Configurações</div>
        <div class="nav-item" id="nav-logout" style="margin-top:auto;">🚪 Sair</div>
      </div>
    `);

    sidebar.querySelectorAll('.nav-item[data-tab]').forEach(n=>{ n.onclick = ()=>{ state.tab=n.dataset.tab; render(); }; });
    sidebar.querySelector('#nav-logout').onclick = logoutUser;
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
        <div><h2>${title}</h2><p>${sub}</p></div>
        <button class="secondary" id="theme-toggle-btn" style="display:flex; align-items:center; gap:6px;">
          ${state.theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
        </button>
      </div>
    `);

    topbar.querySelector('#theme-toggle-btn').onclick = () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('app_theme', state.theme);
      document.documentElement.setAttribute('data-theme', state.theme);
      render();
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
          ${!isSignup ? `<div style="text-align:right; margin-top:6px;"><span id="link-esqueci-senha" style="color:var(--steel); cursor:pointer; text-decoration:underline; font-size:12px;">Esqueci minha senha</span></div>` : ''}
          ${state.authConfirmMsg ? `<div style="color:var(--ok); font-size:12.5px; margin-top:12px;">${state.authConfirmMsg}</div>` : ''}
          ${state.authError ? `<div style="color:var(--danger); font-size:12.5px; margin-top:12px;">${state.authError}</div>` : ''}
          <button class="primary" id="login-btn" style="width:100%; margin-top:14px;" ${state.authSending ? 'disabled' : ''}>${state.authSending ? 'Aguarde...' : (isSignup ? 'Criar conta' : 'Entrar')}</button>
          <div style="text-align:center; margin-top:14px; font-size:12.5px;">
            <span class="dim">${isSignup ? 'Já tem conta?' : 'Precisa criar a conta de admin?'}</span>
            <span id="toggle-auth-mode" style="color:var(--steel); cursor:pointer; text-decoration:underline; margin-left:4px;">${isSignup ? 'Entrar' : 'Criar conta'}</span>
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
          ${state.authError ? `<div style="color:var(--danger); font-size:12.5px; margin-top:12px;">${state.authError}</div>` : ''}
          <button class="primary" id="recuperar-btn" style="width:100%; margin-top:14px;" ${state.authSending ? 'disabled' : ''}>${state.authSending ? 'Enviando...' : 'Enviar link de recuperação'}</button>
          <div style="text-align:center; margin-top:14px; font-size:12.5px;">
            <span id="voltar-login" style="color:var(--steel); cursor:pointer; text-decoration:underline;">← Voltar para o login</span>
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
          ${state.novaSenhaError ? `<div style="color:var(--danger); font-size:12.5px; margin-top:12px;">${state.novaSenhaError}</div>` : ''}
          <button class="primary" id="definir-senha-btn" style="width:100%; margin-top:14px;" ${state.authSending ? 'disabled' : ''}>${state.authSending ? 'Salvando...' : 'Salvar Nova Senha'}</button>
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
        <div class="modal" style="max-width:420px; text-align:center;">
          <h3>Acesso Negado</h3>
          <p class="modal-sub">A conta <strong>${state.session.user.email}</strong> não tem permissão de administrador para este painel.</p>
          <button class="secondary" id="btn-sair" style="width:100%;">Sair</button>
        </div>
      </div>
    `);
    overlay.querySelector('#btn-sair').onclick = logoutUser;
    app.appendChild(overlay);
  }

  function renderDashboard(content){
    const abaixoMinimo = state.produtos.filter(p => Number(p.estoque||0) <= Number(p.quantidadeMinima||5));
    const pendentes = state.solicitacoes.filter(s=>s.status==='pendente');
    const valorTotal = state.produtos.reduce((a,p)=>a + Number(p.estoque||0) * Number(p.preco||0),0);

    const categorias = {};
    state.produtos.forEach(p => {
      const val = Number(p.estoque||0) * Number(p.preco||0);
      categorias[p.categoria] = (categorias[p.categoria] || 0) + val;
    });

    const dashboardEl = elFrag(`
      <div>
        <div class="stat-grid">
          <div class="stat-card" data-card="total">
            <div class="label">SKUs no Catálogo</div>
            <div class="value">${state.produtos.length}</div>
            <span class="click-hint">Clique para ver inventário →</span>
          </div>
          <div class="stat-card ${abaixoMinimo.length ? 'danger' : ''}" data-card="reposicao">
            <div class="label">Alerta de Reposição</div>
            <div class="value">${abaixoMinimo.length}</div>
            <span class="click-hint">Clique para ver itens a repor →</span>
          </div>
          <div class="stat-card ${pendentes.length ? 'warn' : ''}" data-card="pendentes">
            <div class="label">Aguardando Aprovação</div>
            <div class="value">${pendentes.length}</div>
            <span class="click-hint">Clique para gerenciar pedidos →</span>
          </div>
          <div class="stat-card" data-card="capital">
            <div class="label">Capital Imobilizado</div>
            <div class="value" style="font-size:24px; color:var(--steel);">${fmtMoney(valorTotal)}</div>
            <span class="click-hint">Clique para ver detalhes →</span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px; flex-wrap:wrap;">
          <div class="panel">
            <div class="panel-head"><h3>Últimas Solicitações Pendentes</h3></div>
            ${pendentes.length===0 ? `<div class="empty-state"><div class="glyph">🎉</div>Zero pendências na fila de aprovação.</div>` : `
              <table>
                <thead><tr><th>Colaborador</th><th>Material</th><th>Qtd.</th><th>Urgência</th><th>Data</th></tr></thead>
                <tbody>${pendentes.slice(0,5).map(s=>`
                  <tr>
                    <td style="font-weight:500;">${esc(s.nome)}</td>
                    <td>${formatarMateriaisCompacto(s)}</td>
                    <td class="mono">${s.quantidade}</td>
                    <td><span class="badge urg-${esc(s.urgencia)}">${esc(s.urgencia).toUpperCase()}</span></td>
                    <td class="dim mono">${fmtDate(s.dataCriacao)}</td>
                  </tr>
                `).join('')}</tbody>
              </table>
            `}
          </div>

          <div class="panel">
            <div class="panel-head"><h3>Capital por Categoria</h3></div>
            <div class="chart-bar-container">
              ${Object.keys(categorias).length === 0 ? `<div class="dim">Sem dados.</div>` : 
                Object.entries(categorias).map(([cat, val]) => {
                  const pct = valorTotal > 0 ? Math.round((val / valorTotal) * 100) : 0;
                  return `
                    <div class="chart-row">
                      <span class="chart-label" title="${cat}">${cat}</span>
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
            <h3>Ruptura de Estoque (Abaixo do Mínimo)</h3>
            ${abaixoMinimo.length > 0 ? `<button class="secondary" id="btn-ver-alerta-detalhado">Ver Lista de Reposição</button>` : ''}
          </div>
          ${abaixoMinimo.length===0 ? `<div class="empty-state"><div class="glyph">🛡️</div>Estoque saudável. Todos os itens possuem estoque acima do mínimo.</div>` : `
            <table>
              <thead><tr><th>Material</th><th>SKU</th><th>Estoque Atual</th><th>Estoque Mínimo</th><th>Ação</th></tr></thead>
              <tbody>${abaixoMinimo.map(p=>`
                <tr>
                  <td style="font-weight:500;">${esc(p.nome)}</td>
                  <td class="mono dim">${esc(p.sku)}</td>
                  <td class="mono" style="color:var(--danger); font-weight:600;">${p.estoque} ${p.unidade}</td>
                  <td class="mono dim">${p.quantidadeMinima} ${p.unidade}</td>
                  <td><button class="icon-btn" data-repor="${p.id}">Repor / Editar</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    `);

    dashboardEl.querySelectorAll('.stat-card').forEach(card => {
      card.onclick = () => {
        const type = card.dataset.card;
        if(type === 'reposicao'){ state.modal = { type: 'alerta-reposicao' }; render(); }
        else if(type === 'pendentes'){ state.tab = 'solicitacoes'; state.filtroStatus = 'pendente'; render(); }
        else if(type === 'total'){ state.tab = 'produtos'; render(); }
        else if(type === 'capital'){ state.modal = { type: 'resumo-capital' }; render(); }
      };
    });

    const btnDetalhes = dashboardEl.querySelector('#btn-ver-alerta-detalhado');
    if(btnDetalhes) btnDetalhes.onclick = () => { state.modal = { type: 'alerta-reposicao' }; render(); };

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

    const panel = elFrag(`
      <div class="panel">
        <div class="panel-head">
          <h3>Catálogo de Produtos</h3>
          <div style="display:flex; gap:8px;">
            <button class="secondary" id="export-produtos">📥 Exportar CSV</button>
            <button class="primary" id="add-produto">+ Novo Produto</button>
          </div>
        </div>
        <div class="row-controls">
          <input id="busca-produto" placeholder="🔍 Buscar por nome ou SKU..." style="max-width:300px;" value="${state.buscaProduto}">
          <select id="filtro-cat" style="max-width:200px;">
            ${cats.map(c => `<option value="${c}" ${state.filtroCategoria===c?'selected':''}>${c==='todas'?'Todas as Categorias':c}</option>`).join('')}
          </select>
        </div>
        <div id="produtos-table"></div>
      </div>
    `);
    content.appendChild(panel);

    panel.querySelector('#add-produto').onclick = ()=>{ state.modal={type:'produto-form'}; render(); };

    panel.querySelector('#export-produtos').onclick = () => {
      exportarCSV(state.produtos.map(p => ({ SKU: p.sku, Nome: p.nome, Categoria: p.categoria, Estoque: p.estoque, Unidade: p.unidade, PrecoUnitario: p.preco, Fornecedor: p.fornecedor })), 'Inventario_Estoque');
    };

    panel.querySelector('#busca-produto').oninput = (e)=>{ state.buscaProduto=e.target.value; renderTable(); };
    panel.querySelector('#filtro-cat').onchange = (e)=>{ state.filtroCategoria=e.target.value; renderTable(); };

    function renderTable(){
      const box = panel.querySelector('#produtos-table');
      const list = state.produtos.filter(p=> {
        const matchBusca = !state.buscaProduto || p.nome.toLowerCase().includes(state.buscaProduto.toLowerCase()) || p.sku.toLowerCase().includes(state.buscaProduto.toLowerCase());
        const matchCat = state.filtroCategoria === 'todas' || p.categoria === state.filtroCategoria;
        return matchBusca && matchCat;
      });

      if(list.length===0){ box.innerHTML = `<div class="empty-state"><div class="glyph">📦</div>Nenhum produto encontrado com esse filtro.</div>`; return; }
      box.innerHTML = `
        <table>
          <thead><tr><th>Material</th><th>SKU</th><th>Categoria</th><th>Estoque Atual</th><th>Mín. Exigido</th><th>Custo Unit.</th><th>Fornecedor</th><th>Ações</th></tr></thead>
          <tbody>${list.map(p=>`
            <tr>
              <td style="font-weight:500;">${esc(p.nome)}</td>
              <td class="mono dim">${esc(p.sku)}</td>
              <td class="dim">${esc(p.categoria)}</td>
              <td class="mono" style="${p.estoque <= p.quantidadeMinima ?'color:var(--danger); font-weight:bold;':''}">${p.estoque} <small class="dim">${p.unidade}</small></td>
              <td class="mono dim">${p.quantidadeMinima} ${p.unidade}</td>
              <td class="mono">${fmtMoney(p.preco)}</td>
              <td class="dim">${esc(p.fornecedor)||'—'}</td>
              <td style="white-space:nowrap;">
                <button class="icon-btn" data-act="editar" data-id="${p.id}">Editar</button>
                <button class="icon-btn danger" data-act="excluir" data-id="${p.id}">Excluir</button>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
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
          <h3>Fila de Pedidos e Requisições</h3>
          <button class="secondary" id="export-solicitacoes">📥 Exportar Relatório CSV</button>
        </div>

        <div class="status-tabs" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:16px;">
          ${ABAS_STATUS.map(a => `
            <button class="status-tab-btn ${state.filtroStatus===a.valor?'active':''}" data-status="${a.valor}"
              style="padding:8px 16px; border-radius:8px; border:1px solid ${state.filtroStatus===a.valor?'var(--amber)':'var(--border)'}; background:${state.filtroStatus===a.valor?'rgba(255,127,17,0.1)':'transparent'}; color:${state.filtroStatus===a.valor?'var(--amber)':'var(--text)'}; font-size:13px; font-weight:600; cursor:pointer;">
              ${a.label} <span style="opacity:0.7;">(${contagens[a.valor]})</span>
            </button>
          `).join('')}
        </div>

        <div class="row-controls">
          <input id="busca-sol" placeholder="🔍 Pesquisar por colaborador, email ou item..." style="max-width:300px;" value="${esc(state.buscaSolicitacao)}">
          <select id="ordenacao" style="max-width:180px;">
            <option value="recentes" ${state.ordenacao==='recentes'?'selected':''}>Mais Recentes</option>
            <option value="urgencia" ${state.ordenacao==='urgencia'?'selected':''}>Maior Urgência</option>
          </select>
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
      if(status==='pendente')  return [{to:'aprovado', label:'Aprovar', cor:'var(--ok)'}, {to:'rejeitado', label:'Rejeitar', cor:'var(--danger)'}];
      if(status==='aprovado')  return [{to:'entregue', label:'Marcar Entregue', cor:'var(--steel)'}, {to:'rejeitado', label:'Rejeitar', cor:'var(--danger)'}];
      if(status==='rejeitado') return [{to:'pendente', label:'Reabrir Pedido', cor:'var(--amber)'}];
      if(status==='entregue')  return [];
      if(status==='cancelado') return [];
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

      if(list.length===0){ box.innerHTML = `<div class="empty-state"><div class="glyph">📝</div>Nenhuma solicitação nesse status.</div>`; return; }
      box.innerHTML = `
        <table>
          <thead><tr><th>Colaborador</th><th>Material / Descrição</th><th>Qtd</th><th>Urgência</th><th>Data</th><th>Ações / Gestão</th></tr></thead>
          <tbody>${list.map(s=>`
            <tr>
              <td><strong>${esc(s.nome)}</strong><br><span class="email-cell">${esc(s.email)}</span></td>
              <td>${formatarMateriaisCompacto(s)}</td>
              <td class="mono" style="font-weight:bold;">${s.quantidade}</td>
              <td><span class="badge urg-${esc(s.urgencia)}">${esc(s.urgencia).toUpperCase()}</span></td>
              <td class="dim mono" style="font-size:11px;">${fmtDate(s.dataCriacao)}</td>
              <td>
                <button class="icon-btn" data-act="detalhes" data-id="${s.id}">Ver</button>
                ${acoesDisponiveis(s.status).map(a => `<button class="icon-btn" style="color:${a.cor}; border-color:${a.cor};" data-act="${a.to}" data-id="${s.id}">${a.label}</button>`).join('')}
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
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
    const panel = elFrag(`
      <div class="panel">
        <div class="panel-head">
          <h3>Histórico de Auditoria e Logs do Sistema</h3>
          <button class="secondary" id="export-logs">📥 Exportar Logs CSV</button>
        </div>
        ${state.logs.length===0 ? `<div class="empty-state"><div class="glyph">📜</div>Nenhum registro de log encontrado.</div>` : `
          <table>
            <thead><tr><th>Data / Hora</th><th>Administrador</th><th>Ação Realizada</th><th>Detalhes</th></tr></thead>
            <tbody>${state.logs.map(l=>`
              <tr>
                <td class="mono dim" style="font-size:11.5px; white-space:nowrap;">${fmtDate(l.data)}</td>
                <td><span class="badge" style="color:var(--steel); border-color:var(--border);">${esc(l.usuario)}</span></td>
                <td style="font-weight:600; font-family:var(--font-mono); font-size:12px;">${esc(l.acao)}</td>
                <td class="dim">${esc(l.detalhe)}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        `}
      </div>
    `);
    panel.querySelector('#export-logs').onclick = () => exportarCSV(state.logs, 'Logs_Auditoria');
    content.appendChild(panel);
  }

  function renderConfig(content){
    const panel = elFrag(`
      <div class="panel" style="max-width:600px;">
        <div class="panel-head"><h3>Configurações Globais</h3></div>
        <div class="field">
          <label>E-mail Responsável pelo Recebimento de Solicitações</label>
          <input id="cfg-email" value="${esc(state.emailControle)}" placeholder="yuri.silva1@sgs.com">
        </div>
        <button class="primary" id="btn-salvar-cfg" style="margin-top:12px;">Salvar Alterações</button>
      </div>
    `);
    panel.querySelector('#btn-salvar-cfg').onclick = async () => {
      const val = panel.querySelector('#cfg-email').value.trim();
      if(!val){ showToast('Informe um e-mail válido.'); return; }
      const { error } = await supabaseClient.from('config').upsert({ chave: 'email_controle', valor: val });
      if(error){ showToast('Erro ao salvar: ' + error.message); return; }
      state.emailControle = val;
      await addLog('CONFIG', `E-mail de controle alterado para ${val}`);
      showToast('Configurações salvas com sucesso!');
      render();
    };
    content.appendChild(panel);
  }

  function renderModal(){
    const m = state.modal;
    let inner = '';

    if(m.type==='produto-form'){
      const p = m.produto || {};
      inner = `
        <h3>${p.id ? 'Editar Produto / Estoque' : 'Cadastrar Novo Produto'}</h3>
        <p class="modal-sub">Preencha as informações técnicas e os níveis do item.</p>
        <div class="field"><label>Nome do Material / Descrição *</label><input id="m-nome" value="${esc(p.nome)}"></div>
        <div class="field-row">
          <div class="field"><label>SKU / Código *</label><input id="m-sku" value="${esc(p.sku)}"></div>
          <div class="field"><label>Categoria *</label><input id="m-cat" value="${p.categoria ? esc(p.categoria) : 'EPIs'}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Quantidade / Estoque Atual *</label><input id="m-qtd" type="number" min="0" value="${p.estoque !== undefined ? p.estoque : 25}"></div>
          <div class="field"><label>Estoque Mínimo (Alerta) *</label><input id="m-min" type="number" min="0" value="${p.quantidadeMinima || 5}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Preço Unitário (R$)</label><input id="m-preco" type="number" step="0.01" min="0" value="${p.preco || 35.0}"></div>
          <div class="field"><label>Fornecedor</label><input id="m-forn" value="${p.fornecedor ? esc(p.fornecedor) : 'Suprimentos Corporativos'}"></div>
        </div>
        <div class="modal-actions">
          <button class="secondary" id="modal-cancel">Cancelar</button>
          <button class="primary" id="modal-save">Salvar Produto</button>
        </div>
      `;
    } else if(m.type==='confirmar-exclusao'){
      const p = m.produto;
      inner = `
        <h3>Excluir Produto</h3>
        <p class="modal-sub">Tem certeza que deseja remover permanentemente o item <strong>${esc(p.nome)}</strong> (${esc(p.sku)}) do catálogo?</p>
        <div class="modal-actions">
          <button class="secondary" id="modal-cancel">Cancelar</button>
          <button class="primary" style="background:var(--danger); color:#fff;" id="modal-confirm-del">Sim, Excluir</button>
        </div>
      `;
    } else if(m.type==='alerta-reposicao'){
      const abaixo = state.produtos.filter(p => p.estoque <= p.quantidadeMinima);
      inner = `
        <h3>Itens com Necessidade de Reposição</h3>
        <p class="modal-sub">Relação de SKUs com estoque igual ou inferior ao mínimo configurado.</p>
        ${abaixo.length === 0 ? `<div class="empty-state">Nenhum item em falta.</div>` : `
          <table>
            <thead><tr><th>Material</th><th>SKU</th><th>Estoque</th><th>Mínimo</th></tr></thead>
            <tbody>${abaixo.map(p=>`
              <tr>
                <td>${esc(p.nome)}</td>
                <td class="mono dim">${esc(p.sku)}</td>
                <td class="mono" style="color:var(--danger); font-weight:bold;">${p.estoque}</td>
                <td class="mono dim">${p.quantidadeMinima}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        `}
        <div class="modal-actions">
          <button class="primary" id="modal-cancel">Fechar</button>
        </div>
      `;
    } else if(m.type==='resumo-capital'){
      const valorTotal = state.produtos.reduce((a,p)=>a + p.estoque * p.preco,0);
      inner = `
        <h3>Resumo de Capital Imobilizado</h3>
        <p class="modal-sub">Valuation atual do almoxarifado baseado nos estoques do banco de dados.</p>
        <div style="font-size:32px; font-family:var(--font-display); font-weight:bold; color:var(--steel); margin:20px 0;">${fmtMoney(valorTotal)}</div>
        <p class="dim" style="font-size:13px;">Total de <strong>${state.produtos.length}</strong> SKUs monitorados em tempo real.</p>
        <div class="modal-actions">
          <button class="primary" id="modal-cancel">Fechar</button>
        </div>
      `;
    } else if(m.type==='detalhe-solicitacao'){
      const s = m.solicitacao;
      const itens = s.itens || [];
      const mailtoLink = buildMailto(s.email, `[SUPRIMENTOS] Atualização sobre sua solicitação (${s.item})`, `Olá ${s.nome},\n\nSua solicitação do item "${s.item}" (Quantidade: ${s.quantidade}) encontra-se com status: ${s.status.toUpperCase()}.\n\nAtenciosamente,\nAlmoxarifado BackOffice`);

      const secaoTitulo = (texto) => `<div style="font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-dim); margin:20px 0 10px; padding-top:16px; border-top:1px solid var(--border);">${texto}</div>`;

      inner = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <h3 style="margin:0;">Detalhes da Requisição</h3>
          <div style="display:flex; gap:8px;">
            <span class="badge urg-${esc(s.urgencia)}">${esc(s.urgencia).toUpperCase()}</span>
            <span class="badge ${esc(s.status)}">${esc(s.status).toUpperCase()}</span>
          </div>
        </div>
        <p class="modal-sub">Pedido de ${fmtDate(s.dataCriacao)}</p>

        <div style="margin:0 0 4px; font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-dim);">Solicitante</div>
        <dl class="detail-grid">
          <dt>Nome</dt><dd>${esc(s.nome)}</dd>
          <dt>E-mail</dt><dd><a href="${esc(mailtoLink)}" style="color:var(--steel); text-decoration:underline;">${esc(s.email)} ✉️</a></dd>
          <dt>Matrícula</dt><dd>${esc(s.matricula) || '—'}</dd>
          <dt>Setor / Centro</dt><dd>${esc(s.setor) || '—'} (${esc(s.centroCusto) || '—'})</dd>
        </dl>

        ${secaoTitulo('Materiais Solicitados')}
        ${itens.length > 0 ? `
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr>
                <th style="text-align:left; padding:6px 8px; color:var(--text-dim); font-family:var(--font-mono); font-size:11px; border-bottom:1px solid var(--border);">Material</th>
                <th style="text-align:left; padding:6px 8px; color:var(--text-dim); font-family:var(--font-mono); font-size:11px; border-bottom:1px solid var(--border);">SKU</th>
                <th style="text-align:right; padding:6px 8px; color:var(--text-dim); font-family:var(--font-mono); font-size:11px; border-bottom:1px solid var(--border);">Qtd.</th>
              </tr>
            </thead>
            <tbody>
              ${itens.map(it => `
                <tr>
                  <td style="padding:8px; border-bottom:1px solid var(--border);">${esc(it.nome)}${it.categoria ? `<br><span class="dim" style="font-size:11px;">${esc(it.categoria)}</span>` : ''}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border);" class="mono dim">${esc(it.sku)}</td>
                  <td style="padding:8px; border-bottom:1px solid var(--border); text-align:right; font-weight:700;" class="mono">${it.quantidade}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding:8px; text-align:right; color:var(--text-dim); font-family:var(--font-mono); font-size:11px;">TOTAL</td>
                <td style="padding:8px; text-align:right; font-weight:700; color:var(--amber);" class="mono">${s.quantidade}</td>
              </tr>
            </tfoot>
          </table>
        ` : `
          <div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; font-size:13px;">
            <strong style="color:var(--amber);">${esc(s.item)}</strong>
            <div class="dim" style="font-size:11.5px; margin-top:2px;">Item personalizado (fora do catálogo) · Quantidade: ${s.quantidade}</div>
          </div>
        `}

        ${secaoTitulo('Endereço de Entrega')}
        <div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; font-size:13px; color:var(--text);">📍 ${esc(s.endereco) || 'Não informado.'}</div>

        ${secaoTitulo('Observações')}
        <div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; font-size:13px; color:var(--text);">${esc(s.motivo) || 'Nenhuma observação informada.'}</div>

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

    app.appendChild(overlay);
  }

  loadAll();
})();
