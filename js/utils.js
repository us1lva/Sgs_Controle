// ============================================================================
// Funções puras (sem DOM, sem Supabase) — testáveis em Node: `node --test tests/`
// No navegador ficam em window.SgsUtils; no Node, em module.exports.
// ============================================================================
(function(root){
  // Escapa texto antes de entrar em innerHTML (dados de colaboradores não são confiáveis).
  function esc(v){
    if(v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Data de HOJE no fuso local (YYYY-MM-DD). toISOString() usa UTC e, no Brasil
  // (UTC-3), devolveria "amanhã" depois das 21h.
  function hojeISO(d){
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  // Estoque mínimo: 0 é um valor válido (não pode virar 5). Só cai no padrão se vier vazio/inválido.
  const MINIMO_PADRAO = 5;
  function estoqueMinimo(p){
    const v = p && p.quantidadeMinima;
    if(v === null || v === undefined || v === '') return MINIMO_PADRAO;
    const n = Number(v);
    return Number.isFinite(n) ? n : MINIMO_PADRAO;
  }

  function statusEstoque(p){
    const e = Number(p.estoque || 0), mn = estoqueMinimo(p);
    if(e <= 0) return { k: 'zero', label: 'Sem estoque' };
    if(e <= mn) return { k: 'baixo', label: 'Repor' };
    return { k: 'ok', label: 'Normal' };
  }
  function precisaRepor(p){ return Number(p.estoque || 0) <= estoqueMinimo(p); }

  // CSV seguro: aspas escapadas e proteção contra injeção de fórmula no Excel
  // (célula começando com = + - @ vira texto). Campos vêm de colaboradores.
  function celulaCSV(v){
    let s = (v === null || v === undefined) ? '' : String(v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function gerarCSV(dados){
    const colunas = Object.keys(dados[0]);
    const linhas = dados.map(o => colunas.map(c => celulaCSV(o[c])).join(','));
    return '﻿' + [colunas.map(celulaCSV).join(','), ...linhas].join('\r\n');
  }

  // Divide uma lista em blocos (usado para não estourar o tamanho da URL em .in()).
  function emBlocos(lista, tamanho){
    const out = [];
    for(let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
    return out;
  }

  // Um item "sem estoque no pedido" continua urgente só enquanto o estoque ATUAL
  // não cobre a quantidade pedida (a flag `disponivel` é uma fotografia do momento do pedido).
  function itemAindaUrgente(item, produtoAtual){
    if(item.disponivel !== false) return false;
    if(!produtoAtual) return true;
    return Number(produtoAtual.estoque || 0) < Number(item.quantidade || 0);
  }

  // ---- Orçamento por centro de custo -------------------------------------
  // Valor (R$) de um pedido = soma(quantidade × preço atual do produto) dos itens do catálogo.
  function valorPedido(sol, produtos){
    return (sol.itens || []).reduce((t, it) => {
      const p = produtos.find(x => x.id === it.produtoId);
      return t + Number(it.quantidade || 0) * Number(p ? p.preco : 0);
    }, 0);
  }
  // Situação de um C.C. no mês: sem teto definido, ok, alerta (>=80%) ou estourado (>100%).
  function statusOrcamento(consumo, teto){
    consumo = Number(consumo || 0);
    if(teto === null || teto === undefined || teto === '' || Number(teto) <= 0) return { k: 'sem', pct: 0 };
    const pct = Math.round(consumo / Number(teto) * 100);
    return { k: pct > 100 ? 'estourado' : pct >= 80 ? 'alerta' : 'ok', pct };
  }
  // Consumo do mês corrente (YYYY-MM) por centro de custo, a partir das linhas da view.
  function consumoDoMes(linhas, mesISO){
    const out = {};
    (linhas || []).filter(l => String(l.mes || '').slice(0, 7) === mesISO)
      .forEach(l => { out[l.centro_custo] = (out[l.centro_custo] || 0) + Number(l.valor || 0); });
    return out;
  }
  // Pedido aprovado hoje estoura o teto do C.C.? Devolve null ou {cc, teto, depois}.
  function estouraOrcamento(cc, valorNovo, consumoMes, tetos){
    const teto = tetos[cc];
    if(teto === undefined || teto === null || Number(teto) <= 0) return null;
    const depois = Number(consumoMes[cc] || 0) + Number(valorNovo || 0);
    return depois > Number(teto) ? { cc, teto: Number(teto), depois } : null;
  }

  const api = { valorPedido, statusOrcamento, consumoDoMes, estouraOrcamento, esc, hojeISO, fmtDia, nomeDoEmail, estoqueMinimo, statusEstoque, precisaRepor, celulaCSV, gerarCSV, emBlocos, itemAindaUrgente, MINIMO_PADRAO };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SgsUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
