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
    Servicos: ['id', 'prestador_id', 'nome', 'duracao', 'preparo', 'ativo', 'ordem'],
    ProfServ: ['profissional_id', 'servico_id', 'duracao'],
    Disponibilidade: ['profissional_id', 'dia_semana', 'inicio', 'fim'],
    Bloqueios: ['profissional_id', 'data', 'inicio', 'fim', 'motivo'],
    Clientes: ['id', 'telefone', 'nome', 'criado_em', 'consent_versao', 'consent_em'],
    Vinculos: ['cliente_id', 'prestador_id', 'desde'],
    Reservas: ['protocolo', 'prestador_id', 'cliente_id', 'data', 'status', 'criado_em', 'cancelado_em', 'cancelado_por', 'cancelado_motivo'],
    Itens: ['id', 'protocolo', 'prestador_id', 'profissional_id', 'servico_id', 'cliente_id', 'data', 'ini', 'fim', 'ocup_fim', 'status', 'cancelado_motivo'],
    Codigos: ['telefone', 'codigo_hash', 'expira_em', 'tentativas'],
    Mensagens: ['quando', 'telefone', 'canal', 'texto', 'status'],
    Config: ['chave', 'valor'],
    Usuarios: ['id', 'prestador_id', 'usuario', 'nome', 'papel', 'profissional_id', 'pode_cancelar', 'pin_hash', 'tentativas', 'bloqueado_ate', 'ativo'],
    Modelos: ['id', 'prestador_id', 'texto', 'ativo'],
    Promocoes: ['id', 'prestador_id', 'texto', 'cor', 'de', 'ate', 'ativo', 'servicos', 'publico'],
    Ofertas: ['cliente_id', 'prestador_id', 'aniv', 'datas', 'aceite_em', 'aceite_versao']
  };
  // tipos de coluna (usado pelo leitor da planilha para evitar conversões automáticas do Sheets)
  const COL_HORA = ['inicio', 'fim', 'ini', 'ocup_fim'];
  const COL_DATA = ['data', 'de', 'ate'];
  const COL_NUM = ['folga_max', 'passo', 'antecedencia_min', 'dias_max', 'cancel_antecedencia_min', 'duracao', 'preparo', 'dia_semana', 'tentativas', 'bloqueado_ate', 'ordem'];
  const COL_TEXTO = ['telefone', 'id', 'slug', 'protocolo', 'cliente_id', 'prestador_id', 'profissional_id', 'servico_id', 'pin_hash', 'codigo_hash', 'valor', 'criado_em', 'cancelado_em', 'consent_em', 'desde', 'expira_em', 'quando', 'usuario', 'cancelado_motivo', 'texto', 'cor', 'servicos', 'publico', 'aniv', 'datas', 'aceite_em', 'aceite_versao'];

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
      },
      remove: (n, onde) => {
        const antes = t[n].length;
        const manter = t[n].filter((r) => !onde(r));
        t[n].length = 0; manter.forEach((r) => t[n].push(r));
        const c = antes - manter.length;
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
    // equipe de 3 pessoas: Carla (gestora, também atende), Ana e Bruno (profissionais)
    [['U1', 'carla', 'Carla', 'gestor', 'P3', true, '123456'], ['U2', 'ana', 'Ana', 'profissional', 'P1', true, '111111'], ['U3', 'bruno', 'Bruno', 'profissional', 'P2', true, '222222']]
      .forEach((u) => t.Usuarios.push({ id: u[0], prestador_id: 'PR1', usuario: u[1], nome: u[2], papel: u[3], profissional_id: u[4], pode_cancelar: u[5], pin_hash: ctx.hash(u[6]), tentativas: 0, bloqueado_ate: 0, ativo: true }));
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

  const listaIds = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const ordemPromo = (a, b) => b.de.localeCompare(a.de) || Number(String(b.id).replace(/\D/g, '')) - Number(String(a.id).replace(/\D/g, ''));
  const promoSaida = (p) => ({ id: p.id, texto: p.texto, cor: p.cor, servicoIds: listaIds(p.servicos) });
  const promocaoVigente = (store, pr, hoje) => {
    const p = store.rows('Promocoes').filter((x) => x.prestador_id === pr.id && ativo(x) && !x.publico && x.de <= hoje && hoje <= x.ate).sort(ordemPromo)[0];
    return p ? promoSaida(p) : null;
  };
  const servicosOferecidos = (store, pr) => {
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p));
    const ps = store.rows('ProfServ');
    return store.rows('Servicos').filter((x) => x.prestador_id === pr.id && ativo(x)).sort(ordemServ).map((x) => ({
      id: x.id, nome: x.nome, duracao: numCfg(x.duracao, 30), preparo: numCfg(x.preparo, 0),
      profissionais: ps.filter((y) => y.servico_id === x.id && profs.some((p) => p.id === y.profissional_id)).map((y) => y.profissional_id)
    })).filter((x) => x.profissionais.length);
  };
  // o atalho só vale se todos os serviços da promoção ainda estiverem sendo oferecidos
  const saneiaAtalho = (promo, oferecidos) => {
    if (promo && !(promo.servicoIds.length && promo.servicoIds.every((id) => oferecidos.some((x) => x.id === id)))) promo.servicoIds = [];
    return promo;
  };

  // --- ofertas personalizadas (opcionais, com consentimento próprio) ---
  const DATAS_OFERTA = ['aniversario', 'maes', 'pais', 'natal'];
  const OFERTAS_VERSAO = '1';
  const ofertaDe = (store, pr, cid) => store.rows('Ofertas').find((o) => o.prestador_id === pr.id && o.cliente_id === cid && o.aceite_em) || null;
  const aniversarioNaJanela = (aniv, hoje) => {      // da véspera de 3 dias até 3 dias depois do aniversário
    const ano = Number(hoje.slice(0, 4));
    return [ano - 1, ano, ano + 1].some((a) => {
      const d = dataValida(a + '-' + aniv) ? a + '-' + aniv : a + '-02-28';
      return hoje >= somarDias(d, -3) && hoje <= somarDias(d, 3);
    });
  };

  ACOES.minhaPromocao = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    const hoje = ctx.agora().data, of = ofertaDe(store, pr, sessao.cid), datas = of ? listaIds(of.datas) : [];
    const elegivel = (x) => !x.publico || (of && datas.indexOf(x.publico) >= 0 && (x.publico !== 'aniversario' || (of.aniv && aniversarioNaJanela(of.aniv, hoje))));
    const todas = store.rows('Promocoes').filter((x) => x.prestador_id === pr.id && ativo(x) && x.de <= hoje && hoje <= x.ate && elegivel(x));
    const p = todas.filter((x) => x.publico).sort(ordemPromo)[0] || todas.sort(ordemPromo)[0];
    return { promocao: p ? saneiaAtalho(promoSaida(p), servicosOferecidos(store, pr)) : null };
  };

  ACOES.minhasOfertas = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    const of = ofertaDe(store, pr, sessao.cid);
    return { aceito: !!of, aniv: of ? of.aniv : '', datas: of ? listaIds(of.datas) : [] };
  };

  ACOES.ofertasSalvar = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    if (req.aceite !== true) falha('aceite_obrigatorio', 'Para receber ofertas, é preciso concordar com o uso dessas informações.');
    const datas = Array.from(new Set((Array.isArray(req.datas) ? req.datas : []).map(String)));
    if (datas.some((d) => DATAS_OFERTA.indexOf(d) < 0)) falha('data_oferta_invalida', 'Data especial inválida.');
    const aniv = String(req.aniv || '');
    if (aniv && !(/^\d{2}-\d{2}$/.test(aniv) && dataValida('2000-' + aniv))) falha('aniversario_invalido', 'Informe um dia e mês válidos.');
    if (datas.indexOf('aniversario') >= 0 && !aniv) falha('aniversario_invalido', 'Informe o dia e o mês do seu aniversário.');
    if (!datas.length) falha('sem_datas', 'Escolha ao menos uma data para receber ofertas.');
    const ag = ctx.agora(), quando = ag.data + ' ' + hm(ag.min);
    const dados = { aniv: aniv, datas: datas.join(','), aceite_em: quando, aceite_versao: OFERTAS_VERSAO };
    const atual = store.rows('Ofertas').some((o) => o.prestador_id === pr.id && o.cliente_id === sessao.cid);
    if (atual) store.update('Ofertas', (o) => o.prestador_id === pr.id && o.cliente_id === sessao.cid, dados);
    else store.insert('Ofertas', Object.assign({ cliente_id: sessao.cid, prestador_id: pr.id }, dados));
    return { salvo: true };
  };

  ACOES.ofertasRemover = (req, store, ctx) => {
    const { pr, sessao } = autenticar(req, store, ctx, 'cli');
    store.remove('Ofertas', (o) => o.prestador_id === pr.id && o.cliente_id === sessao.cid);
    return { removido: true };
  };

  ACOES.config = (req, store, ctx) => {
    const pr = prestadorPorSlug(store, req.slug);
    const cfg = parametros(pr);
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p));
    const servs = store.rows('Servicos').filter((s) => s.prestador_id === pr.id && ativo(s));
    const ps = store.rows('ProfServ');
    const disp = store.rows('Disponibilidade');
    const oferecidos = servicosOferecidos(store, pr);
    const promo = saneiaAtalho(promocaoVigente(store, pr, ctx.agora().data), oferecidos);
    return {
      prestador: { slug: pr.slug, nome: pr.nome, cor: pr.cor, logo: pr.logo, ...cfg },
      promocao: promo,
      profissionais: profs.map((p) => ({ id: p.id, nome: p.nome, dias: Array.from(new Set(disp.filter((d) => d.profissional_id === p.id).map((d) => Number(d.dia_semana)))) })),
      servicos: oferecidos
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

  function cancelarInterno(store, ctx, pr, protocolo, quem, respeitarAntecedencia, motivo) {
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
      store.update('Reservas', (x) => x.protocolo === protocolo, { status: 'cancelado', cancelado_em: ag2.data + ' ' + hm(ag2.min), cancelado_por: quem, cancelado_motivo: motivo || '' });
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

  // --- painel da equipe (perfis: gestor e profissional) ---
  const PIN_RE = /^\d{6}$/;
  const USUARIO_RE = /^[a-z0-9._-]{3,30}$/;
  const MAX_TENTATIVAS = 5, BLOQUEIO_MIN = 10;
  const MODELOS_PADRAO = [
    'Prezado(a) {nome}, infelizmente não poderemos atendê-lo(a) no serviço {servico} em {data}, às {hora}, por motivo de força maior. Pedimos desculpas pelo transtorno.',
    'Prezado(a) {nome}, precisamos cancelar o seu atendimento ({servico}) de {data}, às {hora}, devido a um imprevisto. Pedimos desculpas e ficamos à disposição para remarcar.',
    'Prezado(a) {nome}, por motivo de saúde do(a) profissional não conseguiremos realizar o seu atendimento ({servico}) de {data}, às {hora}. Pedimos desculpas e teremos prazer em reagendar.'
  ];

  function sessaoPainel(ctx, pr, u) {
    const extra = { uid: u.id || '', papel: u.papel, legado: !!u.legado };
    return {
      token: emitirToken(ctx, 'adm', pr, extra, 12),
      prestador: { nome: pr.nome, cor: pr.cor },
      usuario: { nome: u.nome, papel: u.papel, profissionalId: u.profissional_id || '', podeCancelar: u.canc }
    };
  }
  const usuariosAtivos = (store, pr) => store.rows('Usuarios').filter((u) => u.prestador_id === pr.id && ativo(u));

  ACOES.painelLogin = (req, store, ctx) => {
    const pr = prestadorPorSlug(store, req.slug);
    const lista = usuariosAtivos(store, pr);
    const usuario = String(req.usuario || '').trim().toLowerCase();
    const ag = ctx.agora();
    if (!usuario) {
      // primeiro acesso, antes de existirem usuários: vale o PIN único do estabelecimento (gestor)
      if (lista.length) falha('credenciais_invalidas', 'Informe o usuário e o PIN.');
      if (!req.pin || pr.pin_hash !== ctx.hash(String(req.pin))) falha('pin_invalido', 'PIN incorreto.');
      return sessaoPainel(ctx, pr, { id: '', nome: 'Gestor', papel: 'gestor', profissional_id: '', canc: true, legado: true });
    }
    const u = lista.find((x) => x.usuario === usuario);
    if (!u) falha('credenciais_invalidas', 'Usuário ou PIN incorreto.');
    if (numCfg(u.bloqueado_ate, 0) > ag.epoch) falha('acesso_bloqueado', 'Acesso bloqueado por alguns minutos após várias tentativas incorretas.');
    if (!req.pin || u.pin_hash !== ctx.hash(String(req.pin))) {
      const tent = numCfg(u.tentativas, 0) + 1;
      if (tent >= MAX_TENTATIVAS) store.update('Usuarios', (x) => x.id === u.id, { tentativas: 0, bloqueado_ate: ag.epoch + BLOQUEIO_MIN * 60000 });
      else store.update('Usuarios', (x) => x.id === u.id, { tentativas: tent });
      falha('credenciais_invalidas', 'Usuário ou PIN incorreto.');
    }
    if (numCfg(u.tentativas, 0) || numCfg(u.bloqueado_ate, 0)) store.update('Usuarios', (x) => x.id === u.id, { tentativas: 0, bloqueado_ate: 0 });
    return sessaoPainel(ctx, pr, Object.assign({}, u, { canc: u.papel === 'gestor' || truthy(u.pode_cancelar) }));
  };
  const truthy = (v) => v === true || v === 1 || ['TRUE', 'S', 'SIM', '1'].indexOf(String(v).toUpperCase()) >= 0;

  /** Autentica e relê o usuário a cada chamada: mudanças de perfil, permissão e desativação valem na hora. */
  function autenticarPainel(req, store, ctx) {
    const { pr, sessao } = autenticar(req, store, ctx, 'adm');
    const lista = usuariosAtivos(store, pr);
    if (sessao.legado) {
      if (lista.length) falha('sessao_expirada', 'Sessão expirada. Entre novamente.');
      return { pr: pr, u: { id: '', nome: 'Gestor', papel: 'gestor', prof: '', canc: true } };
    }
    const u = lista.find((x) => x.id === sessao.uid);
    if (!u) falha('sessao_expirada', 'Sessão expirada. Entre novamente.');
    return { pr: pr, u: { id: u.id, nome: u.nome, papel: u.papel, prof: u.profissional_id || '', canc: u.papel === 'gestor' || truthy(u.pode_cancelar) } };
  }
  const exigirGestor = (u) => { if (u.papel !== 'gestor') falha('nao_autorizado', 'Acesso restrito ao gestor.'); };
  const itemPermitido = (u, i) => u.papel === 'gestor' || i.profissional_id === u.prof;

  ACOES.painelAgenda = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    if (!dataValida(req.data)) falha('data_invalida', 'Data inválida.');
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p) && (u.papel === 'gestor' || p.id === u.prof));
    const servs = {}; store.rows('Servicos').forEach((s) => { servs[s.id] = s.nome; });
    const clis = {}; store.rows('Clientes').forEach((c) => { clis[c.id] = c; });
    const itens = store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.data === req.data);
    const bloqueios = store.rows('Bloqueios').filter((b) => b.data === req.data && (b.profissional_id === '*' || profs.some((p) => p.id === b.profissional_id)));
    return {
      data: req.data, papel: u.papel, podeCancelar: u.canc, usuarioNome: u.nome,
      profissionais: profs.map((p) => ({
        id: p.id, nome: p.nome,
        itens: itens.filter((i) => i.profissional_id === p.id).sort((a, b) => a.ini.localeCompare(b.ini)).map((i) => ({
          id: i.id, protocolo: i.protocolo, ini: i.ini, fim: i.fim, status: i.status, servico: servs[i.servico_id],
          cliente: clis[i.cliente_id] ? clis[i.cliente_id].nome : '', telefone: clis[i.cliente_id] ? String(clis[i.cliente_id].telefone) : '',
          outrosServicos: store.rows('Itens').filter((o) => o.protocolo === i.protocolo && o.id !== i.id && o.status !== 'cancelado').length
        })),
        bloqueios: bloqueios.filter((b) => b.profissional_id === p.id || b.profissional_id === '*').map((b) => ({ ini: b.inicio, fim: b.fim, motivo: b.motivo }))
      }))
    };
  };

  // --- cancelamento com mensagem ao cliente ---
  // Por padrão cancela-se UM serviço (o do cartão). Só o gestor pode cancelar o protocolo inteiro.
  const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || 'cliente';
  function dadosCancelamento(store, pr, req, u) {
    const nomesS = {}; store.rows('Servicos').forEach((x) => { nomesS[x.id] = x.nome; });
    let alvo, protocolo;
    if (req.itemId) {
      const it = store.rows('Itens').find((i) => i.id === req.itemId && i.prestador_id === pr.id);
      if (!it) falha('item_inexistente', 'Serviço não encontrado.');
      if (it.status === 'cancelado') falha('reserva_ja_cancelada', 'Este serviço já foi cancelado.');
      if (!itemPermitido(u, it)) falha('item_inexistente', 'Serviço não encontrado.');
      alvo = [it]; protocolo = it.protocolo;
    } else {
      exigirGestor(u);
      protocolo = req.protocolo;
      alvo = store.rows('Itens').filter((i) => i.protocolo === protocolo && i.prestador_id === pr.id && i.status !== 'cancelado');
      if (!alvo.length) falha('reserva_ja_cancelada', 'Esta reserva não está ativa.');
    }
    const r = store.rows('Reservas').find((x) => x.protocolo === protocolo && x.prestador_id === pr.id);
    if (!r) falha('reserva_inexistente', 'Reserva não encontrada.');
    const cli = store.rows('Clientes').find((c) => c.id === r.cliente_id) || {};
    alvo.sort((a, b) => a.ini.localeCompare(b.ini));
    return {
      r: r, alvo: alvo, cli: cli, protocolo: protocolo,
      vars: { nome: primeiroNome(cli.nome), data: dataBR(r.data), hora: alvo[0].ini, servico: alvo.map((i) => nomesS[i.servico_id]).join(' + '), protocolo: protocolo, estabelecimento: pr.nome }
    };
  }
  const aplicarModelo = (txt, v) => String(txt).replace(/\{(nome|data|hora|servico|protocolo|estabelecimento)\}/g, (m, k) => v[k] || '');
  function modelosDoPrestador(store, pr) {
    const proprios = store.rows('Modelos').filter((m) => m.prestador_id === pr.id && ativo(m));
    return proprios.length ? proprios.map((m) => ({ id: m.id, texto: m.texto })) : MODELOS_PADRAO.map((t, i) => ({ id: 'M' + (i + 1), texto: t }));
  }

  ACOES.painelModelos = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    const d = dadosCancelamento(store, pr, req, u);
    return { modelos: modelosDoPrestador(store, pr).map((m) => ({ id: m.id, texto: aplicarModelo(m.texto, d.vars) })), cliente: d.vars.nome, servico: d.vars.servico, hora: d.vars.hora };
  };

  ACOES.painelCancelar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    if (!u.canc) falha('sem_permissao', 'Você não tem permissão para cancelar agendamentos.');
    const d = dadosCancelamento(store, pr, req, u);
    const modelo = req.modeloId ? modelosDoPrestador(store, pr).find((m) => m.id === req.modeloId) : null;
    if (req.modeloId && !modelo) falha('modelo_invalido', 'Mensagem pronta inválida.');
    const livre = String(req.texto || '').trim().slice(0, 300);
    if (!modelo && !livre) falha('motivo_obrigatorio', 'Escolha uma mensagem pronta ou escreva o motivo do cancelamento.');
    const texto = (modelo
      ? aplicarModelo(modelo.texto, d.vars) + (livre ? ' ' + livre : '')
      : 'Prezado(a) ' + d.vars.nome + ', o seu atendimento (' + d.vars.servico + ') de ' + d.vars.data + ', às ' + d.vars.hora + ', em ' + pr.nome + ', foi cancelado. Motivo: ' + livre).slice(0, 500);
    const quem = u.papel === 'gestor' ? 'prestador' : 'profissional';
    const resultado = ctx.travar(() => {
      const ids = d.alvo.map((i) => i.id);
      const ativos = store.rows('Itens').filter((i) => ids.indexOf(i.id) >= 0 && i.status !== 'cancelado');
      if (!ativos.length) falha('reserva_ja_cancelada', 'Este serviço já foi cancelado.');
      store.update('Itens', (i) => ids.indexOf(i.id) >= 0 && i.status !== 'cancelado', { status: 'cancelado', cancelado_motivo: texto });
      const restantes = store.rows('Itens').filter((i) => i.protocolo === d.protocolo && i.status !== 'cancelado').length;
      if (!restantes) {
        const ag2 = ctx.agora();
        store.update('Reservas', (x) => x.protocolo === d.protocolo, { status: 'cancelado', cancelado_em: ag2.data + ' ' + hm(ag2.min), cancelado_por: quem, cancelado_motivo: texto });
      }
      return { reservaEncerrada: !restantes, restantes: restantes };
    });
    let fila = false;
    if (ctx.enviarMensagem && d.cli.telefone) { try { ctx.enviarMensagem(String(d.cli.telefone), texto, 'whatsapp'); fila = true; } catch (e) { /* não desfaz o cancelamento */ } }
    return { protocolo: d.protocolo, status: 'cancelado', escopo: req.itemId ? 'servico' : 'protocolo', reservaEncerrada: resultado.reservaEncerrada, restantes: resultado.restantes, mensagem: texto, telefone: String(d.cli.telefone || ''), emFila: fila };
  };

  ACOES.painelStatus = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    if (['agendado', 'realizado', 'faltou'].indexOf(req.status) < 0) falha('status_invalido', 'Status inválido.');
    const n = store.update('Itens', (i) => i.id === req.itemId && i.prestador_id === pr.id && i.status !== 'cancelado' && itemPermitido(u, i), { status: req.status });
    if (!n) falha('item_inexistente', 'Item não encontrado.');
    return { itemId: req.itemId, status: req.status };
  };

  // --- relatórios e histórico de clientes ---
  const contar = (lista, chave, nome) => {
    const m = {};
    lista.forEach((i) => { const k = chave(i); if (!m[k]) m[k] = { id: k, nome: nome(k), qtd: 0, minutos: 0 }; m[k].qtd++; m[k].minutos += Math.max(0, min(i.fim) - min(i.ini)); });
    return Object.keys(m).map((k) => m[k]).sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));
  };
  const periodoDe = (req, ctx) => {
    const hoje = ctx.agora().data;
    const de = req.de || hoje.slice(0, 8) + '01', ate = req.ate || hoje;
    if (!dataValida(de) || !dataValida(ate)) falha('data_invalida', 'Período inválido.');
    if (ate < de) falha('periodo_invalido', 'A data final deve ser igual ou posterior à inicial.');
    if (somarDias(de, 366) < ate) falha('periodo_longo', 'Escolha um período de até 12 meses.');
    return { de: de, ate: ate };
  };

  ACOES.painelRelatorio = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    const per = periodoDe(req, ctx);
    const gestor = u.papel === 'gestor';
    const profs = {}; store.rows('Profissionais').filter((p) => p.prestador_id === pr.id).forEach((p) => { profs[p.id] = p.nome; });
    const profsAtivos = {}; store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p)).forEach((p) => { profsAtivos[p.id] = true; });
    const servs = {}; store.rows('Servicos').filter((x) => x.prestador_id === pr.id).forEach((x) => { servs[x.id] = x.nome; });
    const clis = {}; store.rows('Clientes').forEach((c) => { clis[c.id] = c; });
    const todos = store.rows('Itens').filter((i) => i.prestador_id === pr.id && itemPermitido(u, i) && (!gestor || !req.profissionalId || i.profissional_id === req.profissionalId));
    const noPeriodo = todos.filter((i) => i.data >= per.de && i.data <= per.ate);
    const validos = noPeriodo.filter((i) => i.status !== 'cancelado');
    const cancelados = noPeriodo.filter((i) => i.status === 'cancelado');
    const primeira = {};
    todos.filter((i) => i.status !== 'cancelado').forEach((i) => { if (!primeira[i.cliente_id] || i.data < primeira[i.cliente_id]) primeira[i.cliente_id] = i.data; });
    const unicos = {}; validos.forEach((i) => { unicos[i.cliente_id] = true; });
    const ids = Object.keys(unicos);
    const dias = [0, 0, 0, 0, 0, 0, 0]; validos.forEach((i) => { dias[diaSemana(i.data)]++; });
    const motivos = {}; cancelados.forEach((i) => { const m = String(i.cancelado_motivo || '').trim() || '(sem motivo informado)'; motivos[m] = (motivos[m] || 0) + 1; });
    const nomeCli = (id) => (clis[id] ? clis[id].nome : '');
    return {
      de: per.de, ate: per.ate, escopo: gestor ? 'equipe' : 'proprio',
      profissionais: gestor ? Object.keys(profs).filter((id) => profsAtivos[id]).map((id) => ({ id: id, nome: profs[id] })) : [],
      resumo: {
        total: noPeriodo.length, atendimentos: validos.length,
        realizados: validos.filter((i) => i.status === 'realizado').length, faltas: validos.filter((i) => i.status === 'faltou').length,
        pendentes: validos.filter((i) => i.status === 'agendado').length, cancelados: cancelados.length,
        taxaCancelamento: noPeriodo.length ? Math.round(cancelados.length * 1000 / noPeriodo.length) / 10 : 0,
        minutos: validos.reduce((t, i) => t + Math.max(0, min(i.fim) - min(i.ini)), 0),
        clientes: ids.length, novos: ids.filter((id) => primeira[id] >= per.de && primeira[id] <= per.ate).length
      },
      porServico: contar(validos, (i) => i.servico_id, (k) => servs[k] || k),
      porProfissional: gestor ? contar(validos, (i) => i.profissional_id, (k) => (profs[k] || k) + (profsAtivos[k] ? '' : ' (inativo)')) : [],
      porDiaSemana: dias,
      motivos: Object.keys(motivos).map((m) => ({ motivo: m, qtd: motivos[m] })).sort((a, b) => b.qtd - a.qtd).slice(0, 10),
      linhas: noPeriodo.slice().sort((a, b) => (a.data + a.ini).localeCompare(b.data + b.ini)).slice(0, 5000).map((i) => ({
        data: i.data, ini: i.ini, fim: i.fim, profissional: profs[i.profissional_id] || '', servico: servs[i.servico_id] || '', cliente: nomeCli(i.cliente_id),
        telefone: gestor && clis[i.cliente_id] ? String(clis[i.cliente_id].telefone) : '', status: i.status, protocolo: i.protocolo, motivo: i.cancelado_motivo || ''
      }))
    };
  };

  ACOES.painelClientes = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const servs = {}; store.rows('Servicos').forEach((x) => { servs[x.id] = x.nome; });
    const clis = {}; store.rows('Clientes').forEach((c) => { clis[c.id] = c; });
    const por = {};
    store.rows('Itens').filter((i) => i.prestador_id === pr.id).forEach((i) => { (por[i.cliente_id] = por[i.cliente_id] || []).push(i); });
    const busca = String(req.busca || '').trim().toLowerCase();
    const digitos = busca.replace(/\D/g, '');
    const lista = Object.keys(por).filter((id) => clis[id]).map((id) => {
      const its = por[id], ok = its.filter((i) => i.status !== 'cancelado');
      const top = contar(ok, (i) => i.servico_id, (k) => servs[k] || k)[0];
      return {
        id: id, nome: clis[id].nome, telefone: String(clis[id].telefone), visitas: ok.filter((i) => i.status !== 'agendado' || i.data < ctx.agora().data).length,
        futuros: ok.filter((i) => i.status === 'agendado' && i.data >= ctx.agora().data).length, cancelados: its.length - ok.length, faltas: ok.filter((i) => i.status === 'faltou').length,
        primeira: ok.length ? ok.map((i) => i.data).sort()[0] : '', ultima: ok.length ? ok.map((i) => i.data).sort().slice(-1)[0] : '', servicoFavorito: top ? top.nome : ''
      };
    }).filter((c) => !busca || c.nome.toLowerCase().indexOf(busca) >= 0 || (digitos && c.telefone.replace(/\D/g, '').indexOf(digitos) >= 0))
      .sort((a, b) => b.ultima.localeCompare(a.ultima) || a.nome.localeCompare(b.nome));
    return { total: lista.length, clientes: lista.slice(0, 300) };
  };

  ACOES.painelClienteHistorico = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const cli = store.rows('Clientes').find((c) => c.id === req.clienteId);
    const its = store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.cliente_id === req.clienteId);
    if (!cli || !its.length) falha('cliente_inexistente', 'Cliente não encontrado.');
    const profs = {}; store.rows('Profissionais').forEach((p) => { profs[p.id] = p.nome; });
    const servs = {}; store.rows('Servicos').forEach((x) => { servs[x.id] = x.nome; });
    return {
      cliente: { id: cli.id, nome: cli.nome, telefone: String(cli.telefone) },
      itens: its.slice().sort((a, b) => (b.data + b.ini).localeCompare(a.data + a.ini)).map((i) => ({
        data: i.data, ini: i.ini, protocolo: i.protocolo, servico: servs[i.servico_id] || '', profissional: profs[i.profissional_id] || '', status: i.status, motivo: i.cancelado_motivo || ''
      }))
    };
  };

  // --- promoções (tela inicial do cliente; somente gestor) ---
  const COR_HEX = /^#[0-9a-fA-F]{6}$/;
  const promoPublica = (x, hoje) => ({ id: x.id, texto: x.texto, cor: x.cor, de: x.de, ate: x.ate, servicoIds: listaIds(x.servicos), publico: x.publico || '', ativo: ativo(x), situacao: !ativo(x) ? 'desativada' : x.ate < hoje ? 'encerrada' : x.de > hoje ? 'agendada' : 'vigente' });

  ACOES.painelPromocoes = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const hoje = ctx.agora().data;
    return {
      promocoes: store.rows('Promocoes').filter((x) => x.prestador_id === pr.id).sort((a, b) => b.de.localeCompare(a.de)).map((x) => promoPublica(x, hoje)),
      servicos: store.rows('Servicos').filter((x) => x.prestador_id === pr.id && ativo(x)).sort(ordemServ).map((x) => ({ id: x.id, nome: x.nome }))
    };
  };

  ACOES.painelPromocaoSalvar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const texto = String(req.texto || '').trim();
    if (!texto || texto.length > 300) falha('texto_invalido', 'Digite o texto da promoção (até 300 caracteres).');
    if (!COR_HEX.test(String(req.cor || ''))) falha('cor_invalida', 'Escolha uma cor de fundo válida.');
    if (!dataValida(req.de) || !dataValida(req.ate)) falha('data_invalida', 'Informe as datas de início e fim.');
    if (req.ate < req.de) falha('periodo_invalido', 'A data final deve ser igual ou posterior à inicial.');
    const atual = req.id ? store.rows('Promocoes').find((x) => x.id === req.id && x.prestador_id === pr.id) : null;
    if (req.id && !atual) falha('promocao_inexistente', 'Promoção não encontrada.');
    const ids = Array.from(new Set((Array.isArray(req.servicoIds) ? req.servicoIds : []).map(String)));
    if (ids.length > 4) falha('servicos_demais', 'Escolha no máximo 4 serviços para a promoção.');
    const validos = store.rows('Servicos').filter((x) => x.prestador_id === pr.id && ativo(x)).map((x) => x.id);
    if (ids.some((id) => validos.indexOf(id) < 0)) falha('servico_invalido', 'Serviço inválido na promoção.');
    const publico = String(req.publico || '');
    if (publico && DATAS_OFERTA.indexOf(publico) < 0) falha('publico_invalido', 'Público da promoção inválido.');
    const dados = { texto: texto, cor: String(req.cor).toLowerCase(), de: req.de, ate: req.ate, ativo: req.ativo !== false, servicos: ids.join(','), publico: publico };
    const id = atual ? atual.id : proximoId(store.rows('Promocoes'), 'M');
    if (atual) store.update('Promocoes', (x) => x.id === id, dados);
    else store.insert('Promocoes', Object.assign({ id: id, prestador_id: pr.id }, dados));
    return { id: id };
  };

  ACOES.painelPromocaoRemover = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    if (!store.remove('Promocoes', (x) => x.id === req.id && x.prestador_id === pr.id)) falha('promocao_inexistente', 'Promoção não encontrada.');
    return { removida: true };
  };

  ACOES.painelBloquear = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    if (!dataValida(req.data)) falha('data_invalida', 'Data inválida.');
    const i = min(req.ini), f = min(req.fim);
    if (isNaN(i) || isNaN(f) || f <= i) falha('horario_invalido', 'Horário inválido.');
    const alvo = u.papel === 'gestor' ? req.profissionalId : u.prof;
    if (alvo !== '*' && !store.rows('Profissionais').some((p) => p.id === alvo && p.prestador_id === pr.id)) falha('profissional_invalido', 'Profissional inválido.');
    store.insert('Bloqueios', { profissional_id: alvo, data: req.data, inicio: hm(i), fim: hm(f), motivo: String(req.motivo || '').slice(0, 80) });
    const conflitos = store.rows('Itens').filter((x) => x.prestador_id === pr.id && x.data === req.data && x.status === 'agendado' && (alvo === '*' || x.profissional_id === alvo) && min(x.ini) < f && i < min(x.ocup_fim)).length;
    return { bloqueado: true, conflitos: conflitos };
  };

  // --- acessos da equipe (somente gestor) ---
  const publico = (u, profs) => ({
    id: u.id, usuario: u.usuario, nome: u.nome, papel: u.papel, profissionalId: u.profissional_id || '',
    profissionalNome: (profs.find((p) => p.id === u.profissional_id) || {}).nome || '', podeCancelar: u.papel === 'gestor' || truthy(u.pode_cancelar), ativo: ativo(u)
  });

  ACOES.painelUsuarios = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const profs = store.rows('Profissionais').filter((p) => p.prestador_id === pr.id && ativo(p));
    return {
      usuarios: store.rows('Usuarios').filter((x) => x.prestador_id === pr.id).map((x) => publico(x, profs)),
      profissionais: profs.map((p) => ({ id: p.id, nome: p.nome })), eu: u.id
    };
  };

  ACOES.painelUsuarioSalvar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const todos = store.rows('Usuarios').filter((x) => x.prestador_id === pr.id);
    const atual = req.id ? todos.find((x) => x.id === req.id) : null;
    if (req.id && !atual) falha('usuario_inexistente', 'Usuário não encontrado.');
    const usuario = String(req.usuario || (atual && atual.usuario) || '').trim().toLowerCase();
    if (!USUARIO_RE.test(usuario)) falha('usuario_invalido', 'Usuário: 3 a 30 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).');
    if (todos.some((x) => x.usuario === usuario && (!atual || x.id !== atual.id))) falha('usuario_duplicado', 'Já existe um usuário com este nome.');
    const nome = String(req.nome || (atual && atual.nome) || '').trim().slice(0, 60);
    if (!nome) falha('nome_obrigatorio', 'Informe o nome.');
    const papel = req.papel || (atual && atual.papel) || 'profissional';
    if (['gestor', 'profissional'].indexOf(papel) < 0) falha('papel_invalido', 'Perfil inválido.');
    const profId = req.profissionalId !== undefined ? String(req.profissionalId || '') : (atual ? atual.profissional_id : '');
    if (profId && !store.rows('Profissionais').some((p) => p.id === profId && p.prestador_id === pr.id)) falha('profissional_invalido', 'Profissional inválido.');
    if (papel === 'profissional' && !profId) falha('profissional_obrigatorio', 'Escolha o profissional que este usuário representa.');
    const ativoNovo = req.ativo === undefined ? (atual ? ativo(atual) : true) : !!req.ativo;
    const gestoresAtivos = todos.filter((x) => x.papel === 'gestor' && ativo(x) && (!atual || x.id !== atual.id)).length + (papel === 'gestor' && ativoNovo ? 1 : 0);
    if (gestoresAtivos < 1) falha('sem_gestor', 'A equipe precisa ter ao menos um gestor ativo.');
    if (atual && atual.id === u.id && (!ativoNovo || papel !== 'gestor')) falha('proprio_acesso', 'Você não pode desativar nem rebaixar o seu próprio acesso.');
    const pin = req.pin === undefined || req.pin === '' ? null : String(req.pin);
    if (!atual && !pin) falha('pin_obrigatorio', 'Defina um PIN de 6 dígitos.');
    if (pin !== null && !PIN_RE.test(pin)) falha('pin_invalido', 'O PIN deve ter exatamente 6 dígitos.');
    const campos = { usuario: usuario, nome: nome, papel: papel, profissional_id: profId, pode_cancelar: papel === 'gestor' ? true : !!req.podeCancelar, ativo: ativoNovo };
    if (req.podeCancelar === undefined && atual) campos.pode_cancelar = truthy(atual.pode_cancelar) || papel === 'gestor';
    if (pin !== null) Object.assign(campos, { pin_hash: ctx.hash(pin), tentativas: 0, bloqueado_ate: 0 });
    if (atual) {
      store.update('Usuarios', (x) => x.id === atual.id, campos);
      return { id: atual.id };
    }
    const n = store.rows('Usuarios').reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0) + 1;
    store.insert('Usuarios', Object.assign({ id: 'U' + n, prestador_id: pr.id, tentativas: 0, bloqueado_ate: 0 }, campos));
    return { id: 'U' + n };
  };

  // --- cadastros do gestor: equipe, serviços e horários ---
  const horaOk = (v) => /^\d{2}:\d{2}$/.test(String(v)) && min(v) <= 1439;
  const proximoId = (rows, letra) => letra + (rows.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0) + 1);
  const durOk = (v) => Number.isInteger(Number(v)) && Number(v) >= 5 && Number(v) <= 480;
  const profsDo = (store, pr) => store.rows('Profissionais').filter((p) => p.prestador_id === pr.id);
  // ordem definida pelo gestor; serviços sem posição (antigos ou novos) vão ao fim, na ordem de cadastro
  const idNum = (r) => Number(String(r.id).replace(/\D/g, '')) || 0;
  const ordemServ = (a, b) => (Number(a.ordem) || 1e9) - (Number(b.ordem) || 1e9) || idNum(a) - idNum(b);
  const servsDo = (store, pr) => store.rows('Servicos').filter((x) => x.prestador_id === pr.id).sort(ordemServ);
  const futurosDoProf = (store, pr, ctx, profId) => store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.profissional_id === profId && i.status === 'agendado' && i.data >= ctx.agora().data);

  ACOES.painelEquipe = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const servs = servsDo(store, pr), ps = store.rows('ProfServ'), users = store.rows('Usuarios').filter((x) => x.prestador_id === pr.id && ativo(x));
    return {
      profissionais: profsDo(store, pr).map((p) => ({
        id: p.id, nome: p.nome, ativo: ativo(p),
        servicoIds: ps.filter((x) => x.profissional_id === p.id && servs.some((s) => s.id === x.servico_id)).map((x) => x.servico_id),
        acessos: users.filter((x) => x.profissional_id === p.id).map((x) => x.nome)
      })),
      servicos: servs.filter(ativo).map((s) => ({ id: s.id, nome: s.nome }))
    };
  };

  ACOES.painelProfissionalSalvar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const todos = profsDo(store, pr);
    const atual = req.id ? todos.find((p) => p.id === req.id) : null;
    if (req.id && !atual) falha('profissional_invalido', 'Profissional não encontrado.');
    const nome = String(req.nome !== undefined ? req.nome : (atual && atual.nome) || '').trim().slice(0, 60);
    if (!nome) falha('nome_obrigatorio', 'Informe o nome do profissional.');
    const ativoNovo = req.ativo === undefined ? (atual ? ativo(atual) : true) : !!req.ativo;
    const servs = servsDo(store, pr);
    const ids = req.servicoIds === undefined ? null : Array.from(new Set(req.servicoIds || []));
    if (ids && ids.some((id) => !servs.some((s) => s.id === id))) falha('servico_invalido', 'Serviço inválido.');
    const id = atual ? atual.id : proximoId(store.rows('Profissionais'), 'P');
    if (atual) store.update('Profissionais', (p) => p.id === id, { nome: nome, ativo: ativoNovo });
    else store.insert('Profissionais', { id: id, prestador_id: pr.id, nome: nome, ativo: ativoNovo });
    if (ids) {
      const meus = servs.map((s) => s.id);
      store.remove('ProfServ', (x) => x.profissional_id === id && meus.indexOf(x.servico_id) >= 0 && ids.indexOf(x.servico_id) < 0);
      const ja = store.rows('ProfServ').filter((x) => x.profissional_id === id).map((x) => x.servico_id);
      ids.filter((sid) => ja.indexOf(sid) < 0).forEach((sid) => store.insert('ProfServ', { profissional_id: id, servico_id: sid, duracao: '' }));
    }
    return { id: id, futuros: !ativoNovo ? futurosDoProf(store, pr, ctx, id).length : 0 };
  };

  // exclui um profissional que nunca teve agendamento; com histórico, o caminho é desativar
  ACOES.painelProfissionalRemover = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const p = profsDo(store, pr).find((x) => x.id === req.id) || falha('profissional_invalido', 'Profissional não encontrado.');
    const usos = store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.profissional_id === p.id).length;
    if (usos) falha('profissional_com_historico', p.nome + ' tem ' + usos + ' agendamento(s) no histórico e não pode ser excluído(a), pois isso apagaria o histórico e os relatórios. Você pode desativar: deixa de aparecer para novos agendamentos e nos filtros dos relatórios.');
    store.remove('ProfServ', (x) => x.profissional_id === p.id);
    store.remove('Disponibilidade', (x) => x.profissional_id === p.id);
    store.remove('Bloqueios', (x) => x.profissional_id === p.id);
    store.rows('Usuarios').filter((x) => x.prestador_id === pr.id && x.profissional_id === p.id).forEach((x) => {
      if (x.papel === 'gestor') store.update('Usuarios', (y) => y.id === x.id, { profissional_id: '' });
      else store.update('Usuarios', (y) => y.id === x.id, { ativo: false });   // acesso de profissional sem agenda não faz sentido
    });
    store.remove('Profissionais', (x) => x.id === p.id && x.prestador_id === pr.id);
    return { removido: true };
  };

  ACOES.painelServicos = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const profs = profsDo(store, pr), ps = store.rows('ProfServ');
    return {
      servicos: servsDo(store, pr).map((s) => ({
        id: s.id, nome: s.nome, duracao: numCfg(s.duracao, 30), preparo: numCfg(s.preparo, 0), ativo: ativo(s),
        profissionais: ps.filter((x) => x.servico_id === s.id && profs.some((p) => p.id === x.profissional_id)).map((x) => ({ id: x.profissional_id, duracao: x.duracao === '' || x.duracao === undefined ? '' : numCfg(x.duracao, '') }))
      })),
      profissionais: profs.filter(ativo).map((p) => ({ id: p.id, nome: p.nome }))
    };
  };

  // reordena a lista de serviços (a mesma ordem vale na tela do cliente e nos cadastros)
  ACOES.painelServicosOrdenar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const meus = servsDo(store, pr).map((x) => x.id);
    const ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
    if (ids.length !== meus.length || new Set(ids).size !== ids.length || ids.some((id) => meus.indexOf(id) < 0)) falha('ordem_invalida', 'A nova ordem não confere com a lista de serviços. Atualize a tela e tente de novo.');
    ids.forEach((id, i) => store.update('Servicos', (x) => x.id === id && x.prestador_id === pr.id, { ordem: i + 1 }));
    return { ordenados: ids.length };
  };

  // exclui um serviço que nunca foi agendado; com histórico, o caminho é desativar (preserva relatórios e clientes)
  ACOES.painelServicoRemover = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const sv = servsDo(store, pr).find((x) => x.id === req.id) || falha('servico_inexistente', 'Serviço não encontrado.');
    const usos = store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.servico_id === sv.id).length;
    if (usos) falha('servico_com_historico', 'Este serviço tem ' + usos + ' agendamento(s) no histórico e não pode ser excluído, pois isso apagaria o histórico e os relatórios. Você pode desativá-lo: ele deixa de aparecer para os clientes.');
    store.remove('ProfServ', (x) => x.servico_id === sv.id);
    store.remove('Servicos', (x) => x.id === sv.id && x.prestador_id === pr.id);
    servsDo(store, pr).forEach((x, i) => { if (Number(x.ordem) !== i + 1) store.update('Servicos', (y) => y.id === x.id, { ordem: i + 1 }); });
    store.rows('Promocoes').filter((x) => x.prestador_id === pr.id && listaIds(x.servicos).indexOf(sv.id) >= 0)
      .forEach((x) => store.update('Promocoes', (y) => y.id === x.id, { servicos: listaIds(x.servicos).filter((id) => id !== sv.id).join(',') }));
    return { removido: true };
  };

  ACOES.painelServicoSalvar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const todos = servsDo(store, pr);
    const atual = req.id ? todos.find((x) => x.id === req.id) : null;
    if (req.id && !atual) falha('servico_invalido', 'Serviço não encontrado.');
    const nome = String(req.nome !== undefined ? req.nome : (atual && atual.nome) || '').trim().slice(0, 60);
    if (!nome) falha('nome_obrigatorio', 'Informe o nome do serviço.');
    const duracao = req.duracao !== undefined ? Number(req.duracao) : (atual ? numCfg(atual.duracao, 30) : NaN);
    if (!durOk(duracao)) falha('duracao_invalida', 'A duração média deve ficar entre 5 e 480 minutos.');
    const preparo = req.preparo !== undefined && req.preparo !== '' ? Number(req.preparo) : (atual ? numCfg(atual.preparo, 0) : 0);
    if (!Number.isInteger(preparo) || preparo < 0 || preparo > 120) falha('preparo_invalido', 'O tempo de preparo deve ficar entre 0 e 120 minutos.');
    const ativoNovo = req.ativo === undefined ? (atual ? ativo(atual) : true) : !!req.ativo;
    const profs = profsDo(store, pr);
    const lista = req.profissionais === undefined ? null : (req.profissionais || []);
    if (lista) {
      if (lista.some((x) => !profs.some((p) => p.id === x.id))) falha('profissional_invalido', 'Profissional inválido.');
      if (lista.some((x) => x.duracao !== '' && x.duracao !== undefined && x.duracao !== null && !durOk(x.duracao))) falha('duracao_invalida', 'A duração por profissional deve ficar entre 5 e 480 minutos.');
    }
    const id = atual ? atual.id : proximoId(store.rows('Servicos'), 'S');
    const campos = { nome: nome, duracao: duracao, preparo: preparo, ativo: ativoNovo };
    if (atual) store.update('Servicos', (x) => x.id === id, campos);
    else {
      const atuais = servsDo(store, pr);                                   // fixa a posição dos antigos (sem 'ordem') antes de colocar o novo no fim
      atuais.forEach((x, i) => { if (Number(x.ordem) !== i + 1) store.update('Servicos', (y) => y.id === x.id, { ordem: i + 1 }); });
      store.insert('Servicos', Object.assign({ id: id, prestador_id: pr.id, ordem: atuais.length + 1 }, campos));
    }
    if (lista) {
      const meus = profs.map((p) => p.id), quer = lista.map((x) => x.id);
      store.remove('ProfServ', (x) => x.servico_id === id && meus.indexOf(x.profissional_id) >= 0 && quer.indexOf(x.profissional_id) < 0);
      lista.forEach((x) => {
        const dur = x.duracao === '' || x.duracao === undefined || x.duracao === null ? '' : Number(x.duracao);
        if (store.rows('ProfServ').some((r) => r.servico_id === id && r.profissional_id === x.id)) store.update('ProfServ', (r) => r.servico_id === id && r.profissional_id === x.id, { duracao: dur });
        else store.insert('ProfServ', { profissional_id: x.id, servico_id: id, duracao: dur });
      });
    }
    const futuros = !ativoNovo ? store.rows('Itens').filter((i) => i.prestador_id === pr.id && i.servico_id === id && i.status === 'agendado' && i.data >= ctx.agora().data).length : 0;
    return { id: id, futuros: futuros };
  };

  function profAlvo(store, pr, u, req) {
    const id = u.papel === 'gestor' ? req.profissionalId : u.prof;
    const p = profsDo(store, pr).find((x) => x.id === id);
    return p || falha('profissional_invalido', 'Profissional inválido.');
  }

  ACOES.painelHorarios = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    const profs = profsDo(store, pr).filter(ativo);
    if (u.papel !== 'gestor' && !u.prof) falha('profissional_invalido', 'Seu acesso não está vinculado a um profissional.');
    const p = u.papel === 'gestor' && !req.profissionalId ? profs[0] : profAlvo(store, pr, u, req);
    if (!p) falha('profissional_invalido', 'Cadastre um profissional primeiro.');
    const dias = [0, 1, 2, 3, 4, 5, 6].map(() => []);
    store.rows('Disponibilidade').filter((d) => d.profissional_id === p.id).forEach((d) => {
      const l = dias[Number(d.dia_semana)];
      if (l && !l.some((x) => x.inicio === d.inicio && x.fim === d.fim)) l.push({ inicio: d.inicio, fim: d.fim }); // ignora linhas repetidas na planilha
    });
    dias.forEach((l) => l.sort((a, b) => a.inicio.localeCompare(b.inicio)));
    const hoje = ctx.agora().data;
    const bloqueios = store.rows('Bloqueios').filter((b) => b.data >= hoje && (b.profissional_id === p.id || b.profissional_id === '*'))
      .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio))
      .map((b) => ({ data: b.data, inicio: b.inicio, fim: b.fim, motivo: b.motivo, todos: b.profissional_id === '*' }));
    return { profissional: { id: p.id, nome: p.nome }, profissionais: u.papel === 'gestor' ? profs.map((x) => ({ id: x.id, nome: x.nome })) : [], dias: dias, bloqueios: bloqueios, podeEditar: u.papel === 'gestor' };
  };

  ACOES.painelHorariosSalvar = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    exigirGestor(u);
    const p = profsDo(store, pr).find((x) => x.id === req.profissionalId) || falha('profissional_invalido', 'Profissional inválido.');
    const dias = req.dias || {};
    const novas = [];
    for (let d = 0; d <= 6; d++) {
      const faixas = (dias[d] || dias[String(d)] || []).map((f) => ({ inicio: f.inicio, fim: f.fim }));
      faixas.forEach((f) => {
        if (!horaOk(f.inicio) || !horaOk(f.fim)) falha('horario_invalido', 'Horário inválido.');
        if (min(f.fim) <= min(f.inicio)) falha('horario_invalido', 'O fim deve ser depois do início.');
      });
      faixas.sort((a, b) => min(a.inicio) - min(b.inicio));
      for (let k = 1; k < faixas.length; k++) if (min(faixas[k].inicio) < min(faixas[k - 1].fim)) falha('faixas_sobrepostas', 'Há faixas de horário sobrepostas no mesmo dia.');
      faixas.forEach((f) => novas.push({ profissional_id: p.id, dia_semana: d, inicio: hm(min(f.inicio)), fim: hm(min(f.fim)) }));
    }
    store.remove('Disponibilidade', (x) => x.profissional_id === p.id);
    novas.forEach((x) => store.insert('Disponibilidade', x));
    const conflitos = futurosDoProf(store, pr, ctx, p.id).filter((i) => !novas.some((x) => x.dia_semana === diaSemana(i.data) && min(i.ini) >= min(x.inicio) && min(i.fim) <= min(x.fim)))
      .map((i) => ({ protocolo: i.protocolo, data: i.data, ini: i.ini })).slice(0, 10);
    return { salvo: true, conflitos: conflitos };
  };

  ACOES.painelBloqueioRemover = (req, store, ctx) => {
    const { pr, u } = autenticarPainel(req, store, ctx);
    const ids = profsDo(store, pr).map((p) => p.id);
    const alvo = u.papel === 'gestor' ? req.profissionalId : u.prof;
    if (alvo !== '*' && ids.indexOf(alvo) < 0) falha('profissional_invalido', 'Profissional inválido.');
    const n = store.remove('Bloqueios', (b) => b.profissional_id === alvo && b.data === req.data && b.inicio === req.inicio && b.fim === req.fim);
    if (!n) falha('bloqueio_inexistente', 'Bloqueio não encontrado.');
    return { removido: n };
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
