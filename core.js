/* ============================================================
 * core.js — regras de negócio do sistema de agendamento
 * Usado em 3 lugares (mesmo arquivo, sem alterações):
 *   1) Apps Script (copiado como Core.gs) -> backend real
 *   2) Navegador (modo demonstração, dados no localStorage)
 *   3) Node (testes automatizados)
 *
 * Convenções: horários em "HH:MM" (hora local de São Paulo),
 * datas em "AAAA-MM-DD", tudo sem fuso, para evitar divergências.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- estrutura das abas da planilha ----------
  const TABELAS = {
    Prestadores: ['id', 'slug', 'nome', 'cor', 'logo', 'pin_hash', 'folga_max', 'passo', 'antecedencia_min', 'dias_max', 'cancel_antecedencia_min', 'verificacao', 'ativo'],
    Profissionais: ['id', 'prestador_id', 'nome', 'ativo'],
    Servicos: ['id', 'prestador_id', 'nome', 'duracao', 'preparo', 'ativo'],
    ProfServ: ['profissional_id', 'servico_id', 'duracao'],
    Disponibilidade: ['profissional_id', 'dia_semana', 'inicio', 'fim'],
    Bloqueios: ['profissional_id', 'data', 'inicio', 'fim', 'motivo'],
    Clientes: ['id', 'telefone', 'nome', 'criado_em', 'consent_versao', 'consent_em'],
    Vinculos: ['cliente_id', 'prestador_id', 'desde'],
    Reservas: ['protocolo', 'prestador_id', 'cliente_id', 'data', 'status', 'criado_em', 'cancelado_em', 'cancelado_por'],
    Itens: ['id', 'protocolo', 'prestador_id', 'profissional_id', 'servico_id', 'cliente_id', 'data', 'ini', 'fim', 'ocup_fim', 'status'],
    Codigos: ['telefone', 'codigo_hash', 'expira_em', 'tentativas'],
    Mensagens: ['quando', 'telefone', 'canal', 'texto', 'status'],
    Config: ['chave', 'valor']
  };
  // tipos de coluna (usado pelo leitor da planilha para evitar conversões automáticas do Sheets)
  const COL_HORA = ['inicio', 'fim', 'ini', 'ocup_fim'];
  const COL_DATA = ['data'];
  const COL_NUM = ['folga_max', 'passo', 'antecedencia_min', 'dias_max', 'cancel_antecedencia_min', 'duracao', 'preparo', 'dia_semana', 'tentativas'];
  const COL_TEXTO = ['telefone', 'id', 'slug', 'protocolo', 'cliente_id', 'prestador_id', 'profissional_id', 'servico_id', 'pin_hash', 'codigo_hash', 'valor', 'criado_em', 'cancelado_em', 'consent_em', 'desde', 'expira_em', 'quando'];

  // ---------- utilidades ----------
  class ErroApi extends Error {
    constructor(codigo, mensagem) { super(mensagem || codigo); this.codigo = codigo; }
  }
  const falha = (codigo, mensagem) => { throw new ErroApi(codigo, mensagem); };

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const hm = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const min = (s) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(s));
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const diaSemana = (data) => {
    const [y, mo, d] = data.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  };
  const somarDias = (data, n) => {
    const [y, mo, d] = data.split('-').map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  };
  const diasEntre = (a, b) => {
    const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((p(b) - p(a)) / 86400000);
  };
  const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && somarDias(s, 0) === s;
  const ativo = (r) => r.ativo === true || r.ativo === 1 || ['TRUE', 'S', 'SIM', '1'].indexOf(String(r.ativo).toUpperCase()) >= 0;
  const sobrepoe = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

  function normalizarTelefone(txt) {
    let d = String(txt || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (!/^55\d{10,11}$/.test(d)) return null;
    const ddd = Number(d.slice(2, 4));
    if (ddd < 11 || ddd > 99) return null;
    if (d.length === 13 && d[4] !== '9') return null;
    return d;
  }

  // ---------- motor de horários ----------
  // livre: o profissional atende [ini,fim] dentro da disponibilidade e sem conflito
  function livre(profId, ini, fim, ocupFim, agenda, escolhidos) {
    const a = agenda[profId];
    if (!a) return false;
    if (!a.disp.some((d) => ini >= d[0] && fim <= d[1])) return false;
    if (a.ocupado.some((o) => sobrepoe(ini, ocupFim, o[0], o[1]))) return false;
    if (escolhidos.some((e) => e.profissionalId === profId && sobrepoe(ini, ocupFim, e.ini, e.ocupFim))) return false;
    return true;
  }
  const clienteLivre = (ini, fim, ocupados) => !(ocupados || []).some((o) => sobrepoe(ini, fim, o[0], o[1]));

  function listaFolgas(folgaMax, folgaPasso) {
    const l = [0];
    for (let g = folgaPasso; g <= (folgaMax || 0); g += folgaPasso) l.push(g);
    return l;
  }

  function montar(i, inicioMin, escolhidos, p, folgas) {
    if (i === p.itens.length) return escolhidos;
    const it = p.itens[i];
    const folgasItem = i === 0 ? [0] : folgas;
    for (const g of folgasItem) {
      const ini = inicioMin + g;
      for (const prof of it.profissionais) {
        const fim = ini + prof.duracao;
        const ocupFim = fim + (it.preparo || 0);
        if (!livre(prof.id, ini, fim, ocupFim, p.agenda, escolhidos)) continue;
        if (!clienteLivre(ini, fim, p.clienteOcupado)) continue;
        const r = montar(i + 1, fim, escolhidos.concat([{
          servicoId: it.servicoId, profissionalId: prof.id, ini: ini, fim: fim, ocupFim: ocupFim
        }]), p, folgas);
        if (r) return r;
      }
    }
    return null;
  }

  /** Gera os horários possíveis para uma sequência de serviços (na ordem dada). */
  function gerarOpcoes(p) {
    const passo = p.passo || 30;
    const folgas = listaFolgas(p.folgaMax, p.folgaPasso || 5);
    const opcoes = [];
    const t0 = Math.ceil((p.minInicio || 0) / passo) * passo;
    for (let t = t0; t < 24 * 60; t += passo) {
      const cadeia = montar(0, t, [], p, folgas);
      if (cadeia) opcoes.push({ ini: t, fim: cadeia[cadeia.length - 1].fim, itens: cadeia });
    }
    return opcoes;
  }

  /** Revalida uma cadeia escolhida pelo cliente (usada na gravação). */
  function validarCadeia(p) {
    const escolhidos = [];
    let anteriorFim = null;
    for (let i = 0; i < p.itens.length; i++) {
      const it = p.itens[i];
      const ini = it.ini;
      const fim = ini + it.duracao;
      const ocupFim = fim + (it.preparo || 0);
      if (isNaN(ini)) return { ok: false, erro: 'horario_invalido' };
      if (i === 0 && ini < (p.minInicio || 0)) return { ok: false, erro: 'antecedencia_insuficiente' };
      if (anteriorFim !== null) {
        const folga = ini - anteriorFim;
        if (folga < 0 || folga > (p.folgaMax || 0)) return { ok: false, erro: 'sequencia_invalida' };
      }
      if (!livre(it.profissionalId, ini, fim, ocupFim, p.agenda, escolhidos)) return { ok: false, erro: 'horario_indisponivel' };
      if (!clienteLivre(ini, fim, p.clienteOcupado)) return { ok: false, erro: 'cliente_ocupado' };
      escolhidos.push({ servicoId: it.servicoId, profissionalId: it.profissionalId, ini: ini, fim: fim, ocupFim: ocupFim });
      anteriorFim = fim;
    }
    return { ok: true, itens: escolhidos };
  }

  // ---------- armazenamento em memória (demo e testes) ----------
  function criarMemStore(dados, persistir) {
    const t = dados || {};
    Object.keys(TABELAS).forEach((k) => { if (!t[k]) t[k] = []; });
    const clone = (o) => JSON.parse(JSON.stringify(o));
    return {
      dados: t,
      rows: (n) => t[n].map(clone),
      insert: (n, o) => { t[n].push(clone(o)); if (persistir) persistir(t); },
      update: (n, onde, patch) => {
        let c = 0;
        t[n].forEach((r) => { if (onde(r)) { Object.assign(r, patch); c++; } });
        if (c && persistir) persistir(t);
        return c;
      }
    };
  }

  function hashSimples(s) {   // apenas para demo/testes (o Apps Script usa SHA-256)
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
    }
    return h1.toString(16) + h2.toString(16);
  }

  function agoraSaoPaulo() {
    const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // "2026-11-23 08:00:00"
    return { data: s.slice(0, 10), min: Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)), epoch: Date.now() };
  }

  /** Contexto de demonstração/testes. 'agora' pode ser fixado: {data, min}. */
  function criarCtxDemo(opcoes) {
    opcoes = opcoes || {};
    const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
    const unb64 = (s) => (typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'));
    const ctx = {
      debug: true,
      relogio: opcoes.agora || null,
      agora() {
        if (ctx.relogio) return { data: ctx.relogio.data, min: ctx.relogio.min, epoch: ctx.relogio.epoch || Date.now() };
        return agoraSaoPaulo();
      },
      assinar: (payload) => b64(JSON.stringify(payload)),
      verificar: (tok) => { try { return JSON.parse(unb64(tok)); } catch (e) { return null; } },
      hash: hashSimples,
      aleatorio6: () => String(Math.floor(100000 + Math.random() * 900000)),
      enviarMensagem: null,   // definido abaixo (precisa do store)
      travar: (fn) => fn()
    };
    return ctx;
  }

  // ---------- dados de demonstração ----------
  function semear(ctx) {
    const t = {};
    Object.keys(TABELAS).forEach((k) => { t[k] = []; });
    t.Prestadores.push({
      id: 'PR1', slug: 'demo', nome: 'Studio Exemplo', cor: '#2b2f36', logo: '', pin_hash: ctx.hash('1234'),
      folga_max: 15, passo: 30, antecedencia_min: 60, dias_max: 30, cancel_antecedencia_min: 120,
      verificacao: 'nenhuma', ativo: true
    });
    [['P1', 'Ana'], ['P2', 'Bruno'], ['P3', 'Carla']].forEach((p) => t.Profissionais.push({ id: p[0], prestador_id: 'PR1', nome: p[1], ativo: true }));
    [['S1', 'Aparar cabelo', 30, 5], ['S2', 'Pintura', 90, 10], ['S3', 'Hidratação', 45, 5], ['S4', 'Barba', 20, 0]]
      .forEach((s) => t.Servicos.push({ id: s[0], prestador_id: 'PR1', nome: s[1], duracao: s[2], preparo: s[3], ativo: true }));
    // quem faz o quê (duracao vazia = usa o tempo médio do serviço)
    [['P1', 'S1'], ['P1', 'S3'], ['P2', 'S1'], ['P2', 'S2'], ['P2', 'S4'], ['P3', 'S2'], ['P3', 'S3']]
      .forEach((x) => t.ProfServ.push({ profissional_id: x[0], servico_id: x[1], duracao: '' }));
    const disp = (id, dias, i, f) => dias.forEach((d) => t.Disponibilidade.push({ profissional_id: id, dia_semana: d, inicio: i, fim: f }));
    disp('P1', [1, 2, 3, 4, 5], '09:00', '12:00'); disp('P1', [1, 2, 3, 4, 5], '13:00', '18:00'); disp('P1', [6], '09:00', '13:00');
    disp('P2', [2, 3, 4, 5, 6], '10:00', '19:00');
    disp('P3', [1, 2, 3, 4, 5], '09:00', '17:00');
    return t;
  }

  // ---------- API ----------
  const ACOES = {};

  function prestadorPorSlug(store, slug) {
    const pr = store.rows('Prestadores').find((p) => p.slug === slug && ativo(p));
    return pr || falha('prestador_inexistente', 'Prestador não encontrado.');
  }
  const numCfg = (v, padrao) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? padrao : Number(v));

  function parametros(pr) {
    return {
      folgaMax: numCfg(pr.folga_max, 0), passo: numCfg(pr.passo, 30),
      antecedenciaMin: numCfg(pr.antecedencia_min, 60), diasMax: numCfg(pr.dias_max, 30),
      cancelAntecedenciaMin: numCfg(pr.cancel_antecedencia_min, 120), verificacao: pr.verificacao || 'nenhuma'
    };
  }

  function emitirToken(ctx, tipo, pr, extra, ttlHoras) {
    const ag = ctx.agora();
    const payload = Object.assign({ k: tipo, pid: pr.id, exp: ag.epoch + ttlHoras * 3600 * 1000 }, extra);
    return ctx.assinar(payload);
  }
  function autenticar(req, store, ctx, tipo) {
    const pr = prestadorPorSlug(store, req.slug);
    const p = req.token ? ctx.verificar(req.token) : null;
    if (!p || p.exp < ctx.agora().epoch || p.pid !== pr.id) falha('sessao_expirada', 'Sessão expirada. Entre novamente.');
    if (tipo && p.k !== tipo) falha('nao_autorizado', 'Acesso não autorizado.');
    return { pr: pr, sessao: p };
  }

  function montarAgendaDia(store, data, profIds) {
    const dow = diaSemana(data);
    const agenda = {};
    profIds.forEach((id) => { agenda[id] = { disp: [], ocupado: [] }; });
    store.rows('Disponibilidade').forEach((r) => {
      if (agenda[r.profissional_id] && Number(r.dia_semana) === dow) agenda[r.profissional_id].disp.push([min(r.inicio), min(r.fim)]);
    });
    store.rows('Bloqueios').forEach((r) => {
      if (r.data !== data) return;
      (r.profissional_id === '*' ? profIds : [r.profissional_id]).forEach((id) => { if (agenda[id]) agenda[id].ocupado.push([min(r.inicio), min(r.fim)]); });
    });
    store.rows('Itens').forEach((r) => {
      if (r.data === data && r.status === 'agendado' && agenda[r.profissional_id]) agenda[r.profissional_id].ocupado.push([min(r.ini), min(r.ocup_fim)]);
    });
    return agenda;
  }
  function ocupacaoCliente(store, clienteId, data) {
    return store.rows('Itens').filter((r) => r.cliente_id === clienteId && r.data === data && r.status === 'agendado').map((r) => [min(r.ini), min(r.fim)]);
  }
  function minimoInicio(pr, ag, data) {
    const cfg = parametros(pr);
    if (data < ag.data) falha('data_passada', 'Escolha uma data a partir de hoje.');
    if (data > somarDias(ag.data, cfg.diasMax)) falha('data_distante', 'Data além do período permitido para agendamento.');
    return data === ag.data ? ag.min + cfg.antecedenciaMin : 0;
  }

  function defsItens(store, pr, itensReq) {
    if (!Array.isArray(itensReq) || itensReq.length < 1 || itensReq.length > 4) falha('itens_invalidos', 'Escolha de 1 a 4 serviços.');
    const servicos = store.rows('Servicos').filter((s) => s.prestador_id === pr.id && ativo(s));
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p));
    const ps = store.rows('ProfServ');
    return itensReq.map((ir) => {
      const s = servicos.find((x) => x.id === ir.servicoId);
      if (!s) falha('servico_invalido', 'Serviço inválido.');
      let cands = ps.filter((x) => x.servico_id === s.id)
        .map((x) => ({ prof: profs.find((p) => p.id === x.profissional_id), dur: numCfg(x.duracao, 0) }))
        .filter((x) => x.prof);
      if (ir.profissionalId) {
        cands = cands.filter((c) => c.prof.id === ir.profissionalId);
        if (!cands.length) falha('profissional_invalido', 'Este profissional não realiza o serviço escolhido.');
      }
      if (!cands.length) falha('sem_profissional', 'Nenhum profissional disponível para este serviço.');
      return {
        servicoId: s.id, nome: s.nome, preparo: numCfg(s.preparo, 0), duracaoMedia: numCfg(s.duracao, 30),
        profissionais: cands.map((c) => ({ id: c.prof.id, nome: c.prof.nome, duracao: c.dur || numCfg(s.duracao, 30) }))
      };
    });
  }

  // --- identificação do cliente ---
  function exigirDadosCadastro(req) {
    const nome = String(req.nome || '').trim().replace(/\s+/g, ' ');
    if (nome.length < 2 || nome.length > 80) falha('nome_invalido', 'Informe seu nome.');
    const tel = normalizarTelefone(req.telefone);
    if (!tel) falha('telefone_invalido', 'Telefone inválido. Informe o DDD e o número.');
    if (req.consentimento !== true) falha('consentimento_obrigatorio', 'É necessário aceitar a Política de Privacidade.');
    return { nome: nome, tel: tel };
  }
  function registrarCliente(store, ctx, pr, nome, tel, versao) {
    const ag = ctx.agora();
    const carimbo = ag.data + ' ' + hm(ag.min);
    let cli = store.rows('Clientes').find((c) => String(c.telefone) === tel);
    if (!cli) {
      cli = { id: 'C' + tel, telefone: tel, nome: nome, criado_em: carimbo, consent_versao: versao || '1', consent_em: carimbo };
      store.insert('Clientes', cli);
    } else if (versao && String(cli.consent_versao) !== String(versao)) {
      store.update('Clientes', (c) => c.id === cli.id, { consent_versao: versao, consent_em: carimbo });
    }
    if (!store.rows('Vinculos').some((v) => v.cliente_id === cli.id && v.prestador_id === pr.id)) {
      store.insert('Vinculos', { cliente_id: cli.id, prestador_id: pr.id, desde: carimbo });
    }
    return cli;
  }
  function sessaoCliente(store, ctx, pr, cli) {
    return { token: emitirToken(ctx, 'cli', pr, { cid: cli.id }, 24 * 90), cliente: { id: cli.id, nome: cli.nome, telefone: cli.telefone } };
  }

  ACOES.config = (req, store) => {
    const pr = prestadorPorSlug(store, req.slug);
    const cfg = parametros(pr);
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p));
    const servs = store.rows('Servicos').filter((s) => s.prestador_id === pr.id && ativo(s));
    const ps = store.rows('ProfServ');
    const disp = store.rows('Disponibilidade');
    return {
      prestador: { slug: pr.slug, nome: pr.nome, cor: pr.cor, logo: pr.logo, ...cfg },
      profissionais: profs.map((p) => ({ id: p.id, nome: p.nome, dias: Array.from(new Set(disp.filter((d) => d.profissional_id === p.id).map((d) => Number(d.dia_semana)))) })),
      servicos: servs.map((s) => ({
        id: s.id, nome: s.nome, duracao: numCfg(s.duracao, 30), preparo: numCfg(s.preparo, 0),
        profissionais: ps.filter((x) => x.servico_id === s.id && profs.some((p) => p.id === x.profissional_id)).map((x) => x.profissional_id)
      })).filter((s) => s.profissionais.length)
    };
  };

  ACOES.cadastrar = (req, store, ctx) => {
    const pr = prestadorPorSlug(store, req.slug);
    if (parametros(pr).verificacao === 'codigo') falha('verificacao_obrigatoria', 'É necessário verificar o telefone.');
    const d = exigirDadosCadastro(req);
    const cli = registrarCliente(store, ctx, pr, d.nome, d.tel, req.consentimentoVersao);
    return sessaoCliente(store, ctx, pr, cli);
  };

  ACOES.enviarCodigo = (req, store, ctx) => {
    const pr = prestadorPorSlug(store, req.slug);
    const d = exigirDadosCadastro(req);
    const ag = ctx.agora();
    const codigo = ctx.aleatorio6();
    const exp = ag.epoch + 10 * 60 * 1000;
    const ja = store.rows('Codigos').find((c) => String(c.telefone) === d.tel);
    if (ja) {
      if (numCfg(ja.tentativas, 0) >= 8 && Number(ja.expira_em) > ag.epoch) falha('muitas_tentativas', 'Muitas tentativas. Aguarde alguns minutos.');
      store.update('Codigos', (c) => String(c.telefone) === d.tel, { codigo_hash: ctx.hash(codigo), expira_em: String(exp), tentativas: 0 });
    } else {
      store.insert('Codigos', { telefone: d.tel, codigo_hash: ctx.hash(codigo), expira_em: String(exp), tentativas: 0 });
    }
    if (ctx.enviarMensagem) ctx.enviarMensagem(d.tel, 'Seu código de verificação (' + pr.nome + '): ' + codigo + '. Válido por 10 minutos.', 'whatsapp');
    const out = { enviado: true };
    if (ctx.debug) out.codigoTeste = codigo;
    return out;
  };

  ACOES.verificarCodigo = (req, store, ctx) => {
    const pr = prestadorPorSlug(store, req.slug);
    const d = exigirDadosCadastro(req);
    const reg = store.rows('Codigos').find((c) => String(c.telefone) === d.tel);
    if (!reg) falha('codigo_invalido', 'Solicite um novo código.');
    const tent = numCfg(reg.tentativas, 0) + 1;
    store.update('Codigos', (c) => String(c.telefone) === d.tel, { tentativas: tent });
    if (tent > 5) falha('muitas_tentativas', 'Muitas tentativas. Solicite um novo código.');
    if (Number(reg.expira_em) < ctx.agora().epoch) falha('codigo_expirado', 'Código expirado. Solicite um novo.');
    if (reg.codigo_hash !== ctx.hash(String(req.codigo || '').trim())) falha('codigo_invalido', 'Código incorreto.');
    store.update('Codigos', (c) => String(c.telefone) === d.tel, { expira_em: '0' });
    const cli = registrarCliente(store, ctx, pr, d.nome, d.tel, req.consentimentoVersao);
    return sessaoCliente(store, ctx, pr, cli);
  };

  ACOES.slots = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    if (!dataValida(req.data)) falha('data_invalida', 'Data inválida.');
    const cfg = parametros(pr);
    const ag = ctx.agora();
    const minInicio = minimoInicio(pr, ag, req.data);
    const defs = defsItens(store, pr, req.itens);
    const profIds = Array.from(new Set([].concat(...defs.map((d) => d.profissionais.map((p) => p.id)))));
    const agenda = montarAgendaDia(store, req.data, profIds);
    const opcoes = gerarOpcoes({
      passo: cfg.passo, folgaMax: cfg.folgaMax, minInicio: minInicio,
      itens: defs, agenda: agenda, clienteOcupado: ocupacaoCliente(store, sessao.cid, req.data)
    });
    const nomeProf = {};
    defs.forEach((d) => d.profissionais.forEach((p) => { nomeProf[p.id] = p.nome; }));
    const nomeServ = {};
    defs.forEach((d) => { nomeServ[d.servicoId] = d.nome; });
    return {
      data: req.data,
      opcoes: opcoes.map((o) => ({
        ini: hm(o.ini), fim: hm(o.fim),
        itens: o.itens.map((i) => ({
          servicoId: i.servicoId, servicoNome: nomeServ[i.servicoId], profissionalId: i.profissionalId,
          profissionalNome: nomeProf[i.profissionalId], ini: hm(i.ini), fim: hm(i.fim)
        }))
      }))
    };
  };

  function proximoProtocolo(store, ctx) {
    const ano = ctx.agora().data.slice(0, 4);
    const reg = store.rows('Config').find((c) => c.chave === 'seq_protocolo');
    const n = (reg ? Number(reg.valor) : 0) + 1;
    if (reg) store.update('Config', (c) => c.chave === 'seq_protocolo', { valor: String(n) });
    else store.insert('Config', { chave: 'seq_protocolo', valor: String(n) });
    return 'AG-' + ano + '-' + ('000000' + n).slice(-6);
  }

  const dataBR = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);

  ACOES.reservar = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    if (!dataValida(req.data)) falha('data_invalida', 'Data inválida.');
    const cfg = parametros(pr);
    return ctx.travar(() => {
      const ag = ctx.agora();
      const minInicio = minimoInicio(pr, ag, req.data);
      if (!Array.isArray(req.itens) || req.itens.some((i) => !i.profissionalId || !i.ini)) falha('itens_invalidos', 'Escolha um horário.');
      const defs = defsItens(store, pr, req.itens.map((i) => ({ servicoId: i.servicoId, profissionalId: i.profissionalId })));
      const profIds = Array.from(new Set(req.itens.map((i) => i.profissionalId)));
      const agenda = montarAgendaDia(store, req.data, profIds);
      const v = validarCadeia({
        folgaMax: cfg.folgaMax, minInicio: minInicio, agenda: agenda, clienteOcupado: ocupacaoCliente(store, sessao.cid, req.data),
        itens: defs.map((d, i) => ({ servicoId: d.servicoId, preparo: d.preparo, profissionalId: d.profissionais[0].id, duracao: d.profissionais[0].duracao, ini: min(req.itens[i].ini) }))
      });
      if (!v.ok) {
        const msgs = {
          horario_indisponivel: 'Este horário acabou de ser ocupado. Escolha outro.',
          sequencia_invalida: 'A sequência de serviços não é válida.',
          cliente_ocupado: 'Você já tem outro agendamento neste horário.',
          antecedencia_insuficiente: 'Horário muito próximo. Escolha outro.',
          horario_invalido: 'Horário inválido.'
        };
        falha(v.erro, msgs[v.erro] || 'Não foi possível agendar.');
      }
      const protocolo = proximoProtocolo(store, ctx);
      const carimbo = ag.data + ' ' + hm(ag.min);
      store.insert('Reservas', { protocolo: protocolo, prestador_id: pr.id, cliente_id: sessao.cid, data: req.data, status: 'agendado', criado_em: carimbo, cancelado_em: '', cancelado_por: '' });
      const nomes = {};
      store.rows('Profissionais').forEach((p) => { nomes[p.id] = p.nome; });
      const itens = v.itens.map((it, i) => {
        const id = protocolo + '-' + (i + 1);
        store.insert('Itens', {
          id: id, protocolo: protocolo, prestador_id: pr.id, profissional_id: it.profissionalId, servico_id: it.servicoId,
          cliente_id: sessao.cid, data: req.data, ini: hm(it.ini), fim: hm(it.fim), ocup_fim: hm(it.ocupFim), status: 'agendado'
        });
        return { servicoNome: defs[i].nome, profissionalNome: nomes[it.profissionalId], ini: hm(it.ini), fim: hm(it.fim) };
      });
      const cli = store.rows('Clientes').find((c) => c.id === sessao.cid);
      if (ctx.enviarMensagem && cli) {
        const linhas = itens.map((i) => i.ini + ' ' + i.servicoNome + ' (' + i.profissionalNome + ')').join('; ');
        try { ctx.enviarMensagem(String(cli.telefone), 'Agendamento confirmado! Protocolo ' + protocolo + ' — ' + pr.nome + ', ' + dataBR(req.data) + ': ' + linhas + '.', 'whatsapp'); } catch (e) { /* não bloqueia a reserva */ }
      }
      return { protocolo: protocolo, data: req.data, prestador: pr.nome, itens: itens };
    });
  };

  function reservaComItens(store, protocolo) {
    const nomesP = {}; store.rows('Profissionais').forEach((p) => { nomesP[p.id] = p.nome; });
    const nomesS = {}; store.rows('Servicos').forEach((s) => { nomesS[s.id] = s.nome; });
    return store.rows('Itens').filter((i) => i.protocolo === protocolo).map((i) => ({
      id: i.id, servicoNome: nomesS[i.servico_id], profissionalNome: nomesP[i.profissional_id], ini: i.ini, fim: i.fim, status: i.status
    }));
  }

  ACOES.minhasReservas = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    const ag = ctx.agora();
    const todas = store.rows('Reservas').filter((r) => r.prestador_id === pr.id && r.cliente_id === sessao.cid);
    const lista = todas.map((r) => ({ protocolo: r.protocolo, data: r.data, status: r.status, itens: reservaComItens(store, r.protocolo) }));
    const futura = (r) => r.data > ag.data || (r.data === ag.data && min(r.itens[0] ? r.itens[0].ini : '00:00') >= ag.min);
    return {
      proximas: lista.filter((r) => r.status === 'agendado' && futura(r)).sort((a, b) => (a.data + a.itens[0].ini).localeCompare(b.data + b.itens[0].ini)),
      anteriores: lista.filter((r) => !(r.status === 'agendado' && futura(r))).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10)
    };
  };

  function cancelarInterno(store, ctx, pr, protocolo, quem, respeitarAntecedencia) {
    return ctx.travar(() => {
      const r = store.rows('Reservas').find((x) => x.protocolo === protocolo && x.prestador_id === pr.id);
      if (!r) falha('reserva_inexistente', 'Reserva não encontrada.');
      if (r.status !== 'agendado') falha('reserva_ja_cancelada', 'Esta reserva não está ativa.');
      if (respeitarAntecedencia) {
        const ag = ctx.agora();
        const primeira = store.rows('Itens').filter((i) => i.protocolo === protocolo).map((i) => min(i.ini)).sort((a, b) => a - b)[0];
        const faltam = diasEntre(ag.data, r.data) * 1440 + primeira - ag.min;
        if (faltam < parametros(pr).cancelAntecedenciaMin) falha('cancelamento_fora_do_prazo', 'Prazo de cancelamento encerrado. Entre em contato com o estabelecimento.');
      }
      const ag2 = ctx.agora();
      store.update('Reservas', (x) => x.protocolo === protocolo, { status: 'cancelado', cancelado_em: ag2.data + ' ' + hm(ag2.min), cancelado_por: quem });
      store.update('Itens', (i) => i.protocolo === protocolo && i.status === 'agendado', { status: 'cancelado' });
      return { protocolo: protocolo, status: 'cancelado' };
    });
  }

  ACOES.cancelarReserva = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    const r = store.rows('Reservas').find((x) => x.protocolo === req.protocolo && x.prestador_id === pr.id);
    if (!r || r.cliente_id !== sessao.cid) falha('reserva_inexistente', 'Reserva não encontrada.');
    return cancelarInterno(store, ctx, pr, req.protocolo, 'cliente', true);
  };

  // --- painel do prestador ---
  ACOES.painelLogin = (req, store, ctx) => {
    const pr = prestadorPorSlug(store, req.slug);
    if (!req.pin || pr.pin_hash !== ctx.hash(String(req.pin))) falha('pin_invalido', 'PIN incorreto.');
    return { token: emitirToken(ctx, 'adm', pr, {}, 12), prestador: { nome: pr.nome, cor: pr.cor } };
  };

  ACOES.painelAgenda = (req, store, ctx) => {
    const { pr } = autenticar(req, store, ctx, 'adm');
    if (!dataValida(req.data)) falha('data_invalida', 'Data inválida.');
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p));
    const servs = {}; store.rows('Servicos').forEach((s) => { servs[s.id] = s.nome; });
    const clis = {}; store.rows('Clientes').forEach((c) => { clis[c.id] = c; });
    const itens = store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.data === req.data);
    const bloqueios = store.rows('Bloqueios').filter((b) => b.data === req.data && (b.profissional_id === '*' || profs.some((p) => p.id === b.profissional_id)));
    return {
      data: req.data,
      profissionais: profs.map((p) => ({
        id: p.id, nome: p.nome,
        itens: itens.filter((i) => i.profissional_id === p.id).sort((a, b) => a.ini.localeCompare(b.ini)).map((i) => ({
          id: i.id, protocolo: i.protocolo, ini: i.ini, fim: i.fim, status: i.status, servico: servs[i.servico_id],
          cliente: clis[i.cliente_id] ? clis[i.cliente_id].nome : '', telefone: clis[i.cliente_id] ? String(clis[i.cliente_id].telefone) : ''
        })),
        bloqueios: bloqueios.filter((b) => b.profissional_id === p.id || b.profissional_id === '*').map((b) => ({ ini: b.inicio, fim: b.fim, motivo: b.motivo }))
      }))
    };
  };

  ACOES.painelCancelar = (req, store, ctx) => {
    const { pr } = autenticar(req, store, ctx, 'adm');
    return cancelarInterno(store, ctx, pr, req.protocolo, 'prestador', false);
  };

  ACOES.painelStatus = (req, store, ctx) => {
    const { pr } = autenticar(req, store, ctx, 'adm');
    if (['agendado', 'realizado', 'faltou'].indexOf(req.status) < 0) falha('status_invalido', 'Status inválido.');
    const n = store.update('Itens', (i) => i.id === req.itemId && i.prestador_id === pr.id && i.status !== 'cancelado', { status: req.status });
    if (!n) falha('item_inexistente', 'Item não encontrado.');
    return { itemId: req.itemId, status: req.status };
  };

  ACOES.painelBloquear = (req, store, ctx) => {
    const { pr } = autenticar(req, store, ctx, 'adm');
    if (!dataValida(req.data)) falha('data_invalida', 'Data inválida.');
    const i = min(req.ini), f = min(req.fim);
    if (isNaN(i) || isNaN(f) || f <= i) falha('horario_invalido', 'Horário inválido.');
    if (req.profissionalId !== '*' && !store.rows('Profissionais').some((p) => p.id === req.profissionalId && p.prestador_id === pr.id)) falha('profissional_invalido', 'Profissional inválido.');
    store.insert('Bloqueios', { profissional_id: req.profissionalId, data: req.data, inicio: hm(i), fim: hm(f), motivo: String(req.motivo || '').slice(0, 80) });
    return { bloqueado: true };
  };

  /** Ponto de entrada único da API. */
  function handle(req, store, ctx) {
    try {
      const fn = req && ACOES[req.action];
      if (!fn) return { ok: false, erro: 'acao_invalida', mensagem: 'Ação inválida.' };
      return { ok: true, data: fn(req, store, ctx) };
    } catch (e) {
      if (e instanceof ErroApi) return { ok: false, erro: e.codigo, mensagem: e.message };
      if (ctx && typeof ctx.log === 'function') ctx.log(e);
      return { ok: false, erro: 'erro_interno', mensagem: 'Erro inesperado. Tente novamente.' };
    }
  }

  return {
    TABELAS, COL_HORA, COL_DATA, COL_NUM, COL_TEXTO,
    hm, min, diaSemana, somarDias, dataBR, normalizarTelefone, dataValida,
    gerarOpcoes, validarCadeia, handle, semear, criarMemStore, criarCtxDemo, hashSimples, ErroApi
  };
});
