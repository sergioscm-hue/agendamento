/* painel.js — painel da equipe, com dois perfis:
 *  - gestor: agenda de todos, cancelamento, bloqueios e gestão de acessos;
 *  - profissional: apenas a própria agenda (o servidor só entrega os dados dele).
 * Endereço: painel/?p=<slug>   (ex.: painel/?p=demo) */
(function () {
  'use strict';
  var raiz = document.getElementById('painel');
  var slug = new URLSearchParams(location.search).get('p') || 'demo';
  var CHAVE = 'agenda:painel:' + slug;
  // instalável: manifesto próprio do estabelecimento (nome, ícone e endereço de abertura), escolhido pelo ?p=
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    var lk = document.createElement('link'); lk.rel = 'manifest'; lk.href = '../p/' + slug + '/painel.webmanifest'; document.head.appendChild(lk);
    var ic = document.createElement('link'); ic.rel = 'apple-touch-icon'; ic.href = '../p/' + slug + '/painel-192.png'; document.head.appendChild(ic);
    var tc = document.createElement('meta'); tc.name = 'theme-color'; tc.content = '#2b2f36'; document.head.appendChild(tc);
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('../sw.js').catch(function () { /* ignore */ });
  }
  var DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  function telFmt(t) {
    var d = String(t || '').replace(/^55/, '');
    return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : d;
  }
  function hojeSP() { return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10); }

  var st = {
    token: null, prestador: '', usuario: null, aba: 'agenda', data: hojeSP(), ag: null, filtro: '*',
    cancel: null, aviso: null, login: { usuario: '', pin: '' }, acessos: null, form: null,
    promos: null, fpromo: null, rel: null, relProfs: null, rper: 'mes', rde: '', rate: '', rprof: '', cli: null, cbusca: '', chist: null, hor: null, hprof: '', hdias: null, hsujo: false, hconf: null, folga: null, equipe: null, fprof: null, svc: null, fsvc: null
  };
  try {
    st.token = sessionStorage.getItem(CHAVE);
    var guardado = JSON.parse(sessionStorage.getItem(CHAVE + ':u') || 'null');
    if (guardado) { st.prestador = guardado.prestador; st.usuario = guardado.usuario; }
  } catch (e) { /* ignore */ }

  function h(tag, props) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (['value', 'checked', 'disabled', 'selected'].indexOf(k) >= 0) el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (function add(list) {
      list.forEach(function (c) {
        if (Array.isArray(c)) return add(c);
        if (c == null || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(Array.prototype.slice.call(arguments, 2));
    return el;
  }

  function chamar(req) {
    return Api.chamar(Object.assign({ slug: slug, token: st.token }, req)).then(function (r) {
      if (!r.ok && (r.erro === 'sessao_expirada' || r.erro === 'nao_autorizado') && st.token && req.action !== 'painelLogin') { sair('Sessão expirada. Entre novamente.'); }
      return r;
    });
  }
  function sair(aviso) {
    st.token = null; st.ag = null; st.usuario = null; st.cancel = null; st.acessos = null; st.form = null; st.aba = 'agenda'; st.filtro = '*';
    st.promos = null; st.fpromo = null;
    st.rel = null; st.rper = 'mes'; st.rde = ''; st.rate = ''; st.rprof = ''; st.cli = null; st.cbusca = ''; st.chist = null;
    st.hor = null; st.hprof = ''; st.hdias = null; st.hsujo = false; st.hconf = null; st.folga = null; st.equipe = null; st.fprof = null; st.svc = null; st.fsvc = null;
    try { sessionStorage.removeItem(CHAVE); sessionStorage.removeItem(CHAVE + ':u'); } catch (e) { /* ignore */ }
    st.aviso = aviso ? { tipo: 'info', texto: aviso } : null;
    render();
  }
  function avisoEl() { return st.aviso ? h('div', { class: 'msg ' + st.aviso.tipo, role: 'alert', style: 'margin:.8rem 1.25rem' }, st.aviso.texto) : null; }
  var ehGestor = function () { return st.usuario && st.usuario.papel === 'gestor'; };

  // ------------------------------------------------------------ login
  function telaLogin() {
    var usuario = h('input', { type: 'text', id: 'usuario', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ex.: ana', value: st.login.usuario, oninput: function (e) { st.login.usuario = e.target.value; } });
    var pin = h('input', { type: 'password', id: 'pin', inputmode: 'numeric', autocomplete: 'current-password', placeholder: '6 dígitos', value: st.login.pin, oninput: function (e) { st.login.pin = e.target.value; } });
    function entrar() {
      Api.chamar({ action: 'painelLogin', slug: slug, usuario: st.login.usuario, pin: st.login.pin }).then(function (r) {
        if (!r.ok) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); return; }
        st.token = r.data.token; st.prestador = r.data.prestador.nome; st.usuario = r.data.usuario;
        st.login = { usuario: '', pin: '' }; st.aviso = null; st.aba = 'agenda';
        try { sessionStorage.setItem(CHAVE, st.token); sessionStorage.setItem(CHAVE + ':u', JSON.stringify({ prestador: st.prestador, usuario: st.usuario })); } catch (e) { /* ignore */ }
        carregar();
      });
    }
    pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
    usuario.addEventListener('keydown', function (e) { if (e.key === 'Enter') pin.focus(); });
    return h('div', { style: 'max-width:380px;margin:0 auto;padding:2rem 1.25rem' },
      h('h1', {}, 'Painel da equipe'), h('p', { class: 'sub' }, 'Entre com o seu usuário e o seu PIN.'),
      avisoEl(), h('label', { for: 'usuario' }, 'Usuário'), usuario, h('label', { for: 'pin' }, 'PIN'), pin,
      h('button', { class: 'btn', onclick: entrar }, 'Entrar'),
      h('p', { class: 'pequeno', style: 'margin-top:1rem' }, 'Esqueceu o PIN? Peça ao gestor para redefini-lo. Primeiro acesso, antes de existirem usuários: deixe o usuário em branco e use o PIN do estabelecimento.'));
  }

  // ------------------------------------------------------------ agenda
  function carregar() {
    chamar({ action: 'painelAgenda', data: st.data }).then(function (r) {
      if (!r.ok) { if (st.token) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); } return; }
      st.ag = r.data;
      if (st.usuario) { st.usuario.papel = r.data.papel; st.usuario.podeCancelar = r.data.podeCancelar; }
      render();
    });
  }
  function mudarData(d) { st.data = d; st.cancel = null; st.aviso = null; st.ag = null; render(); carregar(); }
  function somar(n) { return Core.somarDias(st.data, n); }

  function abrirCancelamento(i) {
    st.cancel = { protocolo: i.protocolo, itemId: i.id, servico: i.servico, ini: i.ini, outros: i.outrosServicos || 0, todos: false, carregando: true, modelos: [], modeloId: '', texto: '', resultado: null };
    render();
    chamar({ action: 'painelModelos', itemId: i.id }).then(function (r) {
      if (!r.ok) { st.cancel = null; st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); return; }
      st.cancel.carregando = false; st.cancel.modelos = r.data.modelos; st.cancel.cliente = r.data.cliente; render();
    });
  }
  function confirmarCancelamento() {
    var c = st.cancel;
    var alvo = c.todos ? { protocolo: c.protocolo } : { itemId: c.itemId };
    chamar(Object.assign({ action: 'painelCancelar', modeloId: c.modeloId, texto: c.texto }, alvo)).then(function (r) {
      if (!r.ok) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); return; }
      c.resultado = r.data; st.aviso = null; render();
    });
  }
  function caixaCancelamento(i) {
    var c = st.cancel;
    if (c.resultado) {
      var wa = 'https://wa.me/' + c.resultado.telefone + '?text=' + encodeURIComponent(c.resultado.mensagem);
      var res = c.resultado;
      var resumo = res.escopo === 'servico' && !res.reservaEncerrada
        ? 'Serviço cancelado e horário liberado. O protocolo continua com ' + res.restantes + ' serviço(s).'
        : 'Cancelado e horário liberado.';
      return h('div', { class: 'cancelar-box' }, h('h4', {}, res.escopo === 'servico' ? 'Serviço cancelado' : 'Protocolo cancelado'),
        h('div', { class: 'msg ok', style: 'margin:.3rem 0' }, resumo),
        h('p', { class: 'pequeno' }, 'Mensagem ao cliente:'), h('div', { class: 'previa' }, c.resultado.mensagem),
        h('div', { class: 'acoes' },
          h('a', { class: 'btn mini', href: wa, target: '_blank', rel: 'noopener' }, 'Enviar pelo WhatsApp'),
          h('button', { class: 'btn mini sec', onclick: function () { st.cancel = null; carregar(); } }, 'Concluir')),
        h('p', { class: 'pequeno' }, 'Nesta fase o aviso é enviado por você com um toque; o envio automático entra na Fase 2.'));
    }
    var ta = h('textarea', { maxlength: '300', placeholder: 'Complemento ou motivo (opcional se escolher uma mensagem)', oninput: function (e) { c.texto = e.target.value; } });
    ta.value = c.texto;
    return h('div', { class: 'cancelar-box' },
      h('h4', {}, 'Cancelar ' + c.servico + ' às ' + c.ini + (c.cliente ? ' · ' + c.cliente : '')),
      c.outros && ehGestor() ? h('label', { class: 'opcao' }, h('input', { type: 'checkbox', checked: c.todos, onchange: function (e) { c.todos = e.target.checked; } }),
        h('span', {}, 'Cancelar também os outros ' + c.outros + ' serviço(s) deste protocolo (' + i.protocolo + ')')) : null,
      c.outros && !ehGestor() ? h('p', { class: 'pequeno' }, 'Só este serviço será cancelado. Os demais serviços do protocolo seguem com os outros profissionais.') : null,
      c.carregando ? h('p', { class: 'pequeno' }, 'Carregando mensagens…') : [
        h('p', { class: 'pequeno' }, 'Mensagem ao cliente (escolha uma ou escreva abaixo):'),
        c.modelos.map(function (m) {
          return h('label', { class: 'opcao' },
            h('input', { type: 'radio', name: 'modelo', checked: c.modeloId === m.id, onchange: function () { c.modeloId = m.id; } }), h('span', {}, m.texto));
        }),
        h('label', { class: 'opcao' }, h('input', { type: 'radio', name: 'modelo', checked: c.modeloId === '', onchange: function () { c.modeloId = ''; } }), h('span', {}, 'Somente o meu texto')),
        ta,
        h('div', { class: 'acoes' },
          h('button', { class: 'btn mini perigo', onclick: confirmarCancelamento }, 'Confirmar cancelamento'),
          h('button', { class: 'btn mini sec', onclick: function () { st.cancel = null; st.aviso = null; render(); } }, 'Voltar'))]);
  }

  function cartao(i) {
    var cancelado = i.status === 'cancelado';
    var cancelando = st.cancel && st.cancel.protocolo === i.protocolo;
    var botoes = null;
    if (!cancelado && !cancelando) {
      botoes = h('div', { class: 'acoes' },
        i.status !== 'realizado' ? h('button', { class: 'btn mini sec', onclick: function () { marcar(i.id, 'realizado'); } }, 'Realizado') : null,
        i.status !== 'faltou' ? h('button', { class: 'btn mini sec', onclick: function () { marcar(i.id, 'faltou'); } }, 'Faltou') : null,
        i.status !== 'agendado' ? h('button', { class: 'btn mini sec', onclick: function () { marcar(i.id, 'agendado'); } }, 'Desfazer') : null,
        st.ag.podeCancelar ? h('button', { class: 'btn mini perigo', onclick: function () { abrirCancelamento(i); } }, 'Cancelar') : null);
    }
    return h('div', { class: 'ag' + (cancelado ? ' cancelado' : '') },
      h('div', { class: 'h' }, i.ini + ' – ' + i.fim + '  ', i.status !== 'agendado' ? h('span', { class: 'badge ' + i.status }, i.status) : null),
      h('div', {}, i.servico),
      h('div', { class: 'meta' }, i.cliente + ' · ',
        h('a', { href: 'tel:+' + i.telefone }, telFmt(i.telefone)), ' · ',
        h('a', { href: 'https://wa.me/' + i.telefone, target: '_blank', rel: 'noopener' }, 'WhatsApp')),
      h('div', { class: 'meta' }, 'Protocolo ' + i.protocolo),
      botoes, cancelando ? caixaCancelamento(i) : null);
  }
  function marcar(id, status) { chamar({ action: 'painelStatus', itemId: id, status: status }).then(function (r) { if (!r.ok) st.aviso = { tipo: 'erro', texto: r.mensagem }; carregar(); }); }

  function formBloqueio() {
    var profs = st.ag.profissionais;
    var prof = ehGestor()
      ? h('select', {}, h('option', { value: '*' }, 'Todos os profissionais'), profs.map(function (p) { return h('option', { value: p.id }, p.nome); }))
      : h('select', { disabled: true }, profs.map(function (p) { return h('option', { value: p.id }, p.nome); }));
    var ini = h('input', { type: 'time', value: '12:00' }), fim = h('input', { type: 'time', value: '13:00' });
    var mot = h('input', { type: 'text', placeholder: 'Motivo (opcional)', maxlength: '80' });
    return h('details', { class: 'bloq' }, h('summary', {}, 'Bloquear horário neste dia'),
      h('div', { class: 'grade-form' },
        h('div', {}, h('label', {}, 'Profissional'), prof), h('div', {}, h('label', {}, 'Início'), ini),
        h('div', {}, h('label', {}, 'Fim'), fim), h('div', {}, h('label', {}, 'Motivo'), mot),
        h('button', { class: 'btn mini', onclick: function () {
          chamar({ action: 'painelBloquear', profissionalId: prof.value, data: st.data, ini: ini.value, fim: fim.value, motivo: mot.value }).then(function (r) {
            st.aviso = { tipo: r.ok ? 'ok' : 'erro', texto: r.ok ? 'Horário bloqueado.' : r.mensagem }; carregar();
          });
        } }, 'Bloquear')));
  }

  var ROTULOS = { agenda: 'Agenda', relatorios: 'Relatórios', clientes: 'Clientes', promocoes: 'Promoções', horarios: 'Horários', equipe: 'Equipe', servicos: 'Serviços', acessos: 'Acessos' };
  function carregarAba() {
    if (st.aba === 'agenda') carregar();
    else if (st.aba === 'acessos') carregarAcessos();
    else if (st.aba === 'horarios') carregarHorarios();
    else if (st.aba === 'equipe') carregarEquipe();
    else if (st.aba === 'servicos') carregarServicos();
    else if (st.aba === 'relatorios') carregarRelatorio();
    else if (st.aba === 'clientes') carregarClientes();
    else if (st.aba === 'promocoes') carregarPromos();
  }
  function irParaAba(id) {
    st.aba = id; st.aviso = null; st.cancel = null; st.form = null; st.fprof = null; st.fsvc = null; st.folga = null; st.hconf = null; st.fpromo = null;
    render(); carregarAba();
  }
  function barra() {
    var quem = st.usuario ? st.usuario.nome + (ehGestor() ? ' (gestor)' : '') : '';
    var topo = h('div', { class: 'barra' }, h('div', { class: 'nome' }, st.prestador || 'Painel', quem ? h('div', { class: 'pequeno' }, quem) : null),
      h('button', { class: 'btn mini sec', onclick: carregarAba }, 'Atualizar'),
      h('button', { class: 'btn mini sec', onclick: function () { sair(); } }, 'Sair'));
    var ids = ehGestor() ? ['agenda', 'relatorios', 'clientes', 'promocoes', 'horarios', 'equipe', 'servicos', 'acessos'] : ['agenda', 'relatorios', 'horarios'];
    var rot = function (id) { return !ehGestor() ? ({ agenda: 'Minha agenda', relatorios: 'Meu resumo', horarios: 'Meu horário' })[id] : ROTULOS[id]; };
    var abas = ids.map(function (id) { return h('button', { 'aria-current': st.aba === id ? 'page' : false, onclick: function () { irParaAba(id); } }, rot(id)); });
    return [topo, h('div', { class: 'abas', role: 'navigation' }, abas)];
  }

  function telaAgenda() {
    var nav = h('div', { class: 'data-nav' },
      h('button', { 'aria-label': 'Dia anterior', onclick: function () { mudarData(somar(-1)); } }, '‹'),
      h('input', { type: 'date', value: st.data, onchange: function (e) { if (e.target.value) mudarData(e.target.value); } }),
      h('button', { 'aria-label': 'Próximo dia', onclick: function () { mudarData(somar(1)); } }, '›'),
      h('button', { style: 'width:auto;padding:0 .8rem;font:inherit', onclick: function () { mudarData(hojeSP()); } }, 'Hoje'));
    var rotulo = DIAS[Core.diaSemana(st.data)] + ', ' + Core.dataBR(st.data);
    var titulo = h('h1', { style: 'padding:.6rem 1.25rem 0;margin:0' }, (ehGestor() ? 'Agenda · ' : 'Minha agenda · ') + rotulo);
    if (!st.ag) return [nav, titulo, avisoEl(), h('p', { class: 'vazio', style: 'padding:0 1.25rem' }, 'Carregando…')];
    var profs = st.ag.profissionais;
    var filtros = ehGestor() && profs.length > 1 ? h('div', { class: 'filtros' },
      [{ id: '*', nome: 'Todos' }].concat(profs).map(function (p) {
        return h('button', { 'aria-pressed': String(st.filtro === p.id), onclick: function () { st.filtro = p.id; render(); } }, p.nome);
      })) : null;
    var colunas = profs.filter(function (p) { return st.filtro === '*' || p.id === st.filtro; }).map(function (p) {
      return h('div', { class: 'col' }, ehGestor() ? h('h3', {}, p.nome) : null,
        p.bloqueios.map(function (b) { return h('div', { class: 'bloqueio' }, 'Bloqueado ' + b.ini + ' – ' + b.fim + (b.motivo ? ' · ' + b.motivo : '')); }),
        p.itens.length ? p.itens.map(cartao) : h('div', { class: 'vazio' }, 'Sem agendamentos.'));
    });
    return [nav, titulo, filtros, avisoEl(), h('div', { class: 'cols' }, colunas), formBloqueio()];
  }

  // ------------------------------------------------------------ acessos (gestor)
  function carregarAcessos() {
    chamar({ action: 'painelUsuarios' }).then(function (r) {
      if (!r.ok) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); return; }
      st.acessos = r.data; render();
    });
  }
  function novoForm(u) {
    return u ? { id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel, profissionalId: u.profissionalId, podeCancelar: u.podeCancelar, ativo: u.ativo, pin: '' }
      : { id: '', nome: '', usuario: '', papel: 'profissional', profissionalId: '', podeCancelar: true, ativo: true, pin: '' };
  }
  function salvarForm() {
    var f = st.form;
    var req = { action: 'painelUsuarioSalvar', nome: f.nome, usuario: f.usuario, papel: f.papel, profissionalId: f.profissionalId, podeCancelar: f.podeCancelar, ativo: f.ativo };
    if (f.id) req.id = f.id;
    if (f.pin) req.pin = f.pin;
    chamar(req).then(function (r) {
      if (!r.ok) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); return; }
      st.aviso = { tipo: 'ok', texto: f.id ? 'Acesso atualizado.' : 'Acesso criado.' }; st.form = null; carregarAcessos();
    });
  }
  function formAcesso() {
    var f = st.form, a = st.acessos;
    var campo = function (rot, el) { return h('div', {}, h('label', {}, rot), el); };
    var profSel = h('select', { onchange: function (e) { f.profissionalId = e.target.value; } },
      h('option', { value: '' }, f.papel === 'gestor' ? '(não atende)' : 'Escolha…'),
      a.profissionais.map(function (p) { return h('option', { value: p.id, selected: f.profissionalId === p.id }, p.nome); }));
    var papelSel = h('select', { onchange: function (e) { f.papel = e.target.value; render(); } },
      h('option', { value: 'profissional', selected: f.papel === 'profissional' }, 'Profissional'), h('option', { value: 'gestor', selected: f.papel === 'gestor' }, 'Gestor'));
    return h('div', { class: 'usuario' }, h('strong', {}, f.id ? 'Editar acesso' : 'Novo acesso'),
      h('div', { class: 'form-acesso' },
        campo('Nome', h('input', { type: 'text', maxlength: '60', value: f.nome, oninput: function (e) { f.nome = e.target.value; } })),
        campo('Usuário (para entrar)', h('input', { type: 'text', autocapitalize: 'none', maxlength: '30', value: f.usuario, oninput: function (e) { f.usuario = e.target.value; } })),
        campo('Perfil', papelSel),
        campo(f.papel === 'gestor' ? 'Também atende como' : 'Profissional', profSel),
        campo(f.id ? 'Novo PIN (vazio = manter)' : 'PIN (6 dígitos)', h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'new-password', value: f.pin, oninput: function (e) { f.pin = e.target.value; } })),
        f.papel === 'profissional' ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.podeCancelar, onchange: function (e) { f.podeCancelar = e.target.checked; } }), 'Pode cancelar agendamentos') : null,
        f.id ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.ativo, disabled: f.id === a.eu, onchange: function (e) { f.ativo = e.target.checked; } }), 'Acesso ativo') : null),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn mini', onclick: salvarForm }, 'Salvar'),
        h('button', { class: 'btn mini sec', onclick: function () { st.form = null; st.aviso = null; render(); } }, 'Cancelar')));
  }
  function telaAcessos() {
    if (!st.acessos) return [h('h1', { style: 'padding:.6rem 1.25rem 0;margin:0' }, 'Acessos da equipe'), avisoEl(), h('p', { class: 'vazio', style: 'padding:0 1.25rem' }, 'Carregando…')];
    var a = st.acessos;
    var itens = a.usuarios.map(function (u) {
      if (st.form && st.form.id === u.id) return formAcesso();
      return h('div', { class: 'usuario' + (u.ativo ? '' : ' inativo') },
        h('div', { class: 'topo' }, h('strong', {}, u.nome + (u.id === a.eu ? ' (você)' : '')),
          h('span', { class: 'badge' }, u.papel === 'gestor' ? 'Gestor' : 'Profissional'), !u.ativo ? h('span', { class: 'badge cancelado' }, 'inativo') : null),
        h('div', { class: 'meta' }, 'usuário: ' + u.usuario + (u.profissionalNome ? ' · atende como ' + u.profissionalNome : '') + (u.papel === 'profissional' ? ' · ' + (u.podeCancelar ? 'pode cancelar' : 'não cancela') : '')),
        h('div', { class: 'acoes' }, h('button', { class: 'btn mini sec', onclick: function () { st.form = novoForm(u); st.aviso = null; render(); } }, 'Editar / redefinir PIN')));
    });
    return [h('h1', { style: 'padding:.6rem 1.25rem 0;margin:0' }, 'Acessos da equipe'), avisoEl(),
      h('div', { class: 'lista-acessos' }, itens, st.form && !st.form.id ? formAcesso() : h('button', { class: 'btn sec', onclick: function () { st.form = novoForm(null); st.aviso = null; render(); } }, '+ Novo acesso'),
        h('p', { class: 'pequeno' }, 'Desativar um acesso bloqueia o login na hora, mas preserva o histórico de atendimentos.'))];
  }

  // ------------------------------------------------------------ comuns dos cadastros
  var campo = function (rot, el) { return h('div', {}, h('label', {}, rot), el); };
  var tituloTela = function (t) { return h('h1', { style: 'padding:.6rem 1.25rem 0;margin:0' }, t); };
  var carregando = function (t) { return [tituloTela(t), avisoEl(), h('p', { class: 'vazio', style: 'padding:0 1.25rem' }, 'Carregando…')]; };
  var NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  var ORDEM_DIA = [1, 2, 3, 4, 5, 6, 0];
  function falhaAviso(r) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); }

  // ------------------------------------------------------------ horários de atendimento
  function carregarHorarios(profId) {
    chamar({ action: 'painelHorarios', profissionalId: profId || st.hprof }).then(function (r) {
      if (!r.ok) { falhaAviso(r); return; }
      st.hor = r.data; st.hprof = r.data.profissional.id;
      st.hdias = JSON.parse(JSON.stringify(r.data.dias)); st.hsujo = false; render();
    });
  }
  function trocarProfHorarios(id) {
    if (st.hsujo && !confirm('Há alterações não salvas. Descartá-las?')) { render(); return; }
    st.hconf = null; carregarHorarios(id);
  }
  function salvarHorarios() {
    var dias = {};
    st.hdias.forEach(function (l, d) { dias[d] = l; });
    chamar({ action: 'painelHorariosSalvar', profissionalId: st.hprof, dias: dias }).then(function (r) {
      if (!r.ok) { falhaAviso(r); return; }
      st.aviso = { tipo: 'ok', texto: 'Horários salvos.' }; st.hconf = r.data.conflitos; carregarHorarios();
    });
  }
  function linhaDia(d, edit) {
    var faixas = st.hdias[d];
    var corpo = faixas.length ? faixas.map(function (f, k) {
      if (!edit) return h('div', { class: 'faixa' }, f.inicio + ' – ' + f.fim);
      return h('div', { class: 'faixa' },
        h('input', { type: 'time', value: f.inicio, 'aria-label': 'Início', onchange: function (e) { f.inicio = e.target.value; st.hsujo = true; } }), ' às ',
        h('input', { type: 'time', value: f.fim, 'aria-label': 'Fim', onchange: function (e) { f.fim = e.target.value; st.hsujo = true; } }),
        h('button', { class: 'btn mini perigo', 'aria-label': 'Remover faixa', onclick: function () { faixas.splice(k, 1); st.hsujo = true; render(); } }, '✕'));
    }) : h('span', { class: 'pequeno' }, 'Fechado');
    return h('div', { class: 'dia-linha' }, h('strong', {}, NOMES_DIA[d]), h('div', { class: 'faixas' }, corpo,
      edit ? h('button', { class: 'btn mini sec', onclick: function () { faixas.push({ inicio: faixas.length ? '13:00' : '09:00', fim: faixas.length ? '18:00' : '12:00' }); st.hsujo = true; render(); } }, '+ faixa') : null));
  }
  function salvarFolga() {
    var f = st.folga;
    var ini = f.inteiro ? '00:00' : f.ini, fim = f.inteiro ? '23:59' : f.fim;
    chamar({ action: 'painelBloquear', profissionalId: f.todos ? '*' : st.hprof, data: f.data, ini: ini, fim: fim, motivo: f.motivo }).then(function (r) {
      if (!r.ok) { falhaAviso(r); return; }
      st.aviso = { tipo: r.data.conflitos ? 'info' : 'ok', texto: r.data.conflitos ? 'Folga registrada. Atenção: ' + r.data.conflitos + ' agendamento(s) já marcado(s) neste período; cancele ou remaneje com os clientes.' : 'Folga registrada.' };
      st.folga = null; carregarHorarios();
    });
  }
  function removerFolga(b) {
    chamar({ action: 'painelBloqueioRemover', profissionalId: b.todos ? '*' : st.hprof, data: b.data, inicio: b.inicio, fim: b.fim }).then(function (r) {
      if (!r.ok) { falhaAviso(r); return; }
      st.aviso = { tipo: 'ok', texto: 'Folga removida.' }; carregarHorarios();
    });
  }
  function formFolga() {
    var f = st.folga;
    if (!f) return h('button', { class: 'btn sec', onclick: function () { st.folga = { data: Core.somarDias(hojeSP(), 1), inteiro: true, ini: '12:00', fim: '13:00', motivo: '', todos: false }; render(); } }, '+ Adicionar folga ou feriado');
    return h('div', { class: 'usuario' }, h('strong', {}, 'Nova folga'),
      h('div', { class: 'form-acesso' },
        campo('Data', h('input', { type: 'date', value: f.data, onchange: function (e) { f.data = e.target.value; } })),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.inteiro, onchange: function (e) { f.inteiro = e.target.checked; render(); } }), 'Dia inteiro'),
        f.inteiro ? null : campo('Início', h('input', { type: 'time', value: f.ini, onchange: function (e) { f.ini = e.target.value; } })),
        f.inteiro ? null : campo('Fim', h('input', { type: 'time', value: f.fim, onchange: function (e) { f.fim = e.target.value; } })),
        campo('Motivo (opcional)', h('input', { type: 'text', maxlength: '80', value: f.motivo, oninput: function (e) { f.motivo = e.target.value; } })),
        ehGestor() ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.todos, onchange: function (e) { f.todos = e.target.checked; } }), 'Vale para todos os profissionais') : null),
      h('div', { class: 'acoes' }, h('button', { class: 'btn mini', onclick: salvarFolga }, 'Registrar'),
        h('button', { class: 'btn mini sec', onclick: function () { st.folga = null; st.aviso = null; render(); } }, 'Cancelar')));
  }
  function telaHorarios() {
    var titulo = ehGestor() ? 'Horários de atendimento' : 'Meu horário';
    if (!st.hor || !st.hdias) return carregando(titulo);
    var hr = st.hor, edit = hr.podeEditar;
    var chips = edit && hr.profissionais.length > 1 ? h('div', { class: 'filtros' }, hr.profissionais.map(function (p) {
      return h('button', { 'aria-pressed': String(st.hprof === p.id), onclick: function () { trocarProfHorarios(p.id); } }, p.nome);
    })) : null;
    var conflitos = st.hconf && st.hconf.length ? h('div', { class: 'msg info', style: 'margin:.8rem 1.25rem' },
      'Atenção: ' + st.hconf.length + ' agendamento(s) ficaram fora do novo horário: ' + st.hconf.map(function (c) { return Core.dataBR(c.data) + ' ' + c.ini + ' (' + c.protocolo + ')'; }).join('; ') + '. Cancele ou remaneje com os clientes.') : null;
    return [tituloTela(titulo + (edit ? '' : ' · ' + hr.profissional.nome)), chips, avisoEl(), conflitos,
      h('div', { class: 'lista-acessos' },
        ORDEM_DIA.map(function (d) { return linhaDia(d, edit); }),
        edit ? h('div', { class: 'acoes' }, h('button', { class: 'btn', disabled: !st.hsujo, onclick: salvarHorarios }, st.hsujo ? 'Salvar horários' : 'Sem alterações'),
          st.hsujo ? h('button', { class: 'btn sec', onclick: function () { carregarHorarios(); } }, 'Descartar') : null) : h('p', { class: 'pequeno' }, 'Os horários são definidos pelo gestor.'),
        h('h3', { style: 'margin:.8rem 0 0' }, 'Folgas e feriados'),
        hr.bloqueios.length ? hr.bloqueios.map(function (b) {
          return h('div', { class: 'usuario' }, h('div', { class: 'topo' }, h('strong', {}, Core.dataBR(b.data) + (b.inicio === '00:00' && b.fim === '23:59' ? ' · dia inteiro' : ' · ' + b.inicio + ' – ' + b.fim)),
            b.todos ? h('span', { class: 'badge' }, 'todos') : null,
            (edit || !b.todos) ? h('button', { class: 'btn mini perigo', onclick: function () { removerFolga(b); } }, 'Remover') : null),
            b.motivo ? h('div', { class: 'meta' }, b.motivo) : null);
        }) : h('p', { class: 'vazio' }, 'Nenhuma folga futura.'),
        formFolga())];
  }

  // ------------------------------------------------------------ equipe (profissionais)
  function carregarEquipe() {
    chamar({ action: 'painelEquipe' }).then(function (r) { if (!r.ok) { falhaAviso(r); return; } st.equipe = r.data; render(); });
  }
  function formProf() {
    var f = st.fprof, eq = st.equipe;
    return h('div', { class: 'usuario' }, h('strong', {}, f.id ? 'Editar profissional' : 'Novo profissional'),
      h('div', { class: 'form-acesso' },
        campo('Nome', h('input', { type: 'text', maxlength: '60', value: f.nome, oninput: function (e) { f.nome = e.target.value; } })),
        f.id ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.ativo, onchange: function (e) { f.ativo = e.target.checked; } }), 'Ativo (aparece para os clientes)') : null),
      h('p', { class: 'pequeno', style: 'margin:.6rem 0 .2rem' }, 'Serviços que realiza:'),
      eq.servicos.length ? eq.servicos.map(function (sv) {
        return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.servicoIds.indexOf(sv.id) >= 0, onchange: function (e) {
          var i = f.servicoIds.indexOf(sv.id); if (e.target.checked && i < 0) f.servicoIds.push(sv.id); if (!e.target.checked && i >= 0) f.servicoIds.splice(i, 1); } }), sv.nome);
      }) : h('p', { class: 'vazio' }, 'Cadastre os serviços na aba Serviços.'),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn mini', onclick: function () {
          chamar({ action: 'painelProfissionalSalvar', id: f.id || undefined, nome: f.nome, ativo: f.ativo, servicoIds: f.servicoIds }).then(function (r) {
            if (!r.ok) { falhaAviso(r); return; }
            var novo = !f.id;
            st.aviso = { tipo: r.data.futuros ? 'info' : 'ok', texto: r.data.futuros ? 'Profissional desativado. Atenção: ' + r.data.futuros + ' agendamento(s) futuro(s) dele continuam marcados; cancele ou remaneje.' : (novo ? 'Profissional cadastrado. Defina os horários dele na aba Horários.' : 'Profissional atualizado.') };
            st.fprof = null; carregarEquipe();
          });
        } }, 'Salvar'),
        h('button', { class: 'btn mini sec', onclick: function () { st.fprof = null; st.aviso = null; render(); } }, 'Cancelar')));
  }
  function excluirProf(p) {
    if (!confirm('Excluir "' + p.nome + '" da equipe? Esta ação não pode ser desfeita.')) return;
    chamar({ action: 'painelProfissionalRemover', id: p.id }).then(function (r) {
      if (r.ok) { st.aviso = { tipo: 'ok', texto: 'Profissional excluído(a).' }; carregarEquipe(); return; }
      if (r.erro === 'profissional_com_historico') {
        if (confirm(r.mensagem + '\n\nDesativar "' + p.nome + '" agora?')) {
          chamar({ action: 'painelProfissionalSalvar', id: p.id, nome: p.nome, ativo: false }).then(function (r2) {
            if (!r2.ok) { falhaAviso(r2); return; }
            st.aviso = { tipo: 'ok', texto: p.nome + ' foi desativado(a): sai dos novos agendamentos e dos filtros dos relatórios; o histórico foi preservado.' + (r2.data && r2.data.futuros ? ' Atenção: há ' + r2.data.futuros + ' agendamento(s) futuro(s) dessa pessoa para remarcar ou cancelar.' : '') };
            carregarEquipe();
          });
        }
        return;
      }
      falhaAviso(r);
    });
  }
  function telaEquipe() {
    if (!st.equipe) return carregando('Profissionais');
    var eq = st.equipe, nomeS = {};
    eq.servicos.forEach(function (x) { nomeS[x.id] = x.nome; });
    var itens = eq.profissionais.map(function (p) {
      if (st.fprof && st.fprof.id === p.id) return formProf();
      return h('div', { class: 'usuario' + (p.ativo ? '' : ' inativo') },
        h('div', { class: 'topo' }, h('strong', {}, p.nome), !p.ativo ? h('span', { class: 'badge cancelado' }, 'inativo') : null),
        h('div', { class: 'meta' }, p.servicoIds.length ? p.servicoIds.map(function (id) { return nomeS[id]; }).filter(Boolean).join(' · ') : 'Nenhum serviço vinculado'),
        p.acessos.length ? h('div', { class: 'meta' }, 'Acesso ao painel: ' + p.acessos.join(', ')) : null,
        h('div', { class: 'acoes' }, h('button', { class: 'btn mini sec', onclick: function () { st.fprof = { id: p.id, nome: p.nome, ativo: p.ativo, servicoIds: p.servicoIds.slice() }; st.aviso = null; render(); } }, 'Editar'),
          h('button', { class: 'btn mini sec', onclick: function () { st.hprof = p.id; irParaAba('horarios'); } }, 'Horários'),
          h('button', { class: 'btn mini perigo', onclick: function () { excluirProf(p); } }, 'Excluir')));
    });
    return [tituloTela('Profissionais'), avisoEl(), h('div', { class: 'lista-acessos' }, itens,
      st.fprof && !st.fprof.id ? formProf() : h('button', { class: 'btn sec', onclick: function () { st.fprof = { id: '', nome: '', ativo: true, servicoIds: [] }; st.aviso = null; render(); } }, '+ Novo profissional'),
      h('p', { class: 'pequeno' }, 'Desativar tira o profissional da lista de novos agendamentos, mas preserva o histórico e os relatórios.'))];
  }

  // ------------------------------------------------------------ serviços
  function carregarServicos() {
    chamar({ action: 'painelServicos' }).then(function (r) { if (!r.ok) { falhaAviso(r); return; } st.svc = r.data; render(); });
  }
  function fmtDur(m) { return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ('0' + (m % 60)).slice(-2) : '') : m + ' min'; }
  function formServico() {
    var f = st.fsvc, sv = st.svc;
    return h('div', { class: 'usuario' }, h('strong', {}, f.id ? 'Editar serviço' : 'Novo serviço'),
      h('div', { class: 'form-acesso' },
        campo('Nome do serviço', h('input', { type: 'text', maxlength: '60', value: f.nome, oninput: function (e) { f.nome = e.target.value; } })),
        campo('Duração média (min)', h('input', { type: 'number', min: '5', max: '480', step: '5', inputmode: 'numeric', value: f.duracao, oninput: function (e) { f.duracao = e.target.value; } })),
        campo('Preparo após o serviço (min)', h('input', { type: 'number', min: '0', max: '120', step: '5', inputmode: 'numeric', value: f.preparo, oninput: function (e) { f.preparo = e.target.value; } })),
        f.id ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.ativo, onchange: function (e) { f.ativo = e.target.checked; } }), 'Ativo (aparece para os clientes)') : null),
      h('p', { class: 'pequeno', style: 'margin:.6rem 0 .2rem' }, 'Quem realiza (e, se for diferente, o tempo médio de cada um):'),
      sv.profissionais.map(function (p) {
        var marc = f.profs[p.id] !== undefined;
        return h('div', { class: 'prof-dur' },
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: marc, onchange: function (e) { if (e.target.checked) f.profs[p.id] = ''; else delete f.profs[p.id]; render(); } }), p.nome),
          marc ? h('input', { type: 'number', min: '5', max: '480', step: '5', inputmode: 'numeric', placeholder: 'igual ao médio', 'aria-label': 'Duração de ' + p.nome, value: f.profs[p.id], oninput: function (e) { f.profs[p.id] = e.target.value; } }) : null);
      }),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn mini', onclick: function () {
          var lista = Object.keys(f.profs).map(function (id) { return { id: id, duracao: f.profs[id] === '' ? '' : Number(f.profs[id]) }; });
          chamar({ action: 'painelServicoSalvar', id: f.id || undefined, nome: f.nome, duracao: f.duracao === '' ? undefined : Number(f.duracao), preparo: f.preparo === '' ? 0 : Number(f.preparo), ativo: f.ativo, profissionais: lista }).then(function (r) {
            if (!r.ok) { falhaAviso(r); return; }
            st.aviso = { tipo: r.data.futuros ? 'info' : 'ok', texto: r.data.futuros ? 'Serviço desativado. Atenção: ' + r.data.futuros + ' agendamento(s) futuro(s) dele continuam marcados.' : (f.id ? 'Serviço atualizado. As mudanças valem para os novos agendamentos.' : 'Serviço cadastrado.') };
            st.fsvc = null; carregarServicos();
          });
        } }, 'Salvar'),
        h('button', { class: 'btn mini sec', onclick: function () { st.fsvc = null; st.aviso = null; render(); } }, 'Cancelar')));
  }
  // reordenação: setas (teclado e toque) e alça de arrastar (ponteiro/toque)
  function salvarOrdemServicos(focoId, sentido) {
    chamar({ action: 'painelServicosOrdenar', ids: st.svc.servicos.map(function (x) { return x.id; }) }).then(function (r) {
      if (!r.ok) { falhaAviso(r); carregarServicos(); return; }
      st.aviso = null;
      if (st.arrastando) return;                          // não troca a tela no meio de um arrasto
      render();
      if (focoId) { var b = raiz.querySelector('[data-sid="' + focoId + '"] .mover-' + sentido); if (b && !b.disabled) b.focus(); else { b = raiz.querySelector('[data-sid="' + focoId + '"] .mover'); if (b) b.focus(); } }
    });
  }
  function moverServico(de, para) {
    var l = st.svc.servicos;
    if (para < 0 || para >= l.length || de === para) return;
    var it = l.splice(de, 1)[0]; l.splice(para, 0, it);
    st.aviso = null; render();
    salvarOrdemServicos(it.id, para > de ? 'baixo' : 'cima');
  }
  function iniciarArrasto(e, idx) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    var alca = e.currentTarget, card = alca.closest('[data-sid]');
    var cards = Array.prototype.slice.call(raiz.querySelectorAll('[data-sid]'));
    var meios = cards.map(function (c) { var r = c.getBoundingClientRect(); return r.top + r.height / 2; });
    var y0 = e.clientY, alvo = idx;
    try { alca.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    card.classList.add('arrastando'); st.arrastando = true;
    var mover = function (ev) {
      card.style.transform = 'translateY(' + (ev.clientY - y0) + 'px)';
      var n = 0; meios.forEach(function (m, i) { if (i !== idx && ev.clientY > m) n++; });
      alvo = n;
      cards.forEach(function (c, i) { c.classList.toggle('alvo', i !== idx && i === alvo); });
    };
    var fim = function () {
      alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', fim); alca.removeEventListener('pointercancel', cancelar);
      card.classList.remove('arrastando'); card.style.transform = ''; st.arrastando = false;
      cards.forEach(function (c) { c.classList.remove('alvo'); });
      moverServico(idx, alvo);
    };
    var cancelar = function () {
      alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', fim); alca.removeEventListener('pointercancel', cancelar);
      card.classList.remove('arrastando'); card.style.transform = ''; st.arrastando = false; cards.forEach(function (c) { c.classList.remove('alvo'); });
    };
    alca.addEventListener('pointermove', mover); alca.addEventListener('pointerup', fim); alca.addEventListener('pointercancel', cancelar);
  }
  function excluirServico(x) {
    if (!confirm('Excluir o serviço "' + x.nome + '"? Esta ação não pode ser desfeita.')) return;
    chamar({ action: 'painelServicoRemover', id: x.id }).then(function (r) {
      if (r.ok) { st.aviso = { tipo: 'ok', texto: 'Serviço excluído.' }; carregarServicos(); return; }
      if (r.erro === 'servico_com_historico') {
        // já foi agendado: oferece desativar, que preserva histórico e relatórios
        if (confirm(r.mensagem + '\n\nDesativar "' + x.nome + '" agora?')) {
          var lista = x.profissionais.map(function (p) { return { id: p.id, duracao: p.duracao }; });
          chamar({ action: 'painelServicoSalvar', id: x.id, nome: x.nome, duracao: x.duracao, preparo: x.preparo, ativo: false, profissionais: lista }).then(function (r2) {
            if (!r2.ok) { falhaAviso(r2); return; }
            st.aviso = { tipo: 'ok', texto: 'Serviço desativado: não aparece mais para os clientes e o histórico foi preservado.' }; carregarServicos();
          });
        }
        return;
      }
      falhaAviso(r);
    });
  }
  function telaServicos() {
    if (!st.svc) return carregando('Serviços');
    var sv = st.svc, nomeP = {};
    sv.profissionais.forEach(function (p) { nomeP[p.id] = p.nome; });
    var total = sv.servicos.length;
    var itens = sv.servicos.map(function (x, i) {
      if (st.fsvc && st.fsvc.id === x.id) return formServico();
      var profs = x.profissionais.filter(function (p) { return nomeP[p.id]; });
      var ordenar = total > 1 && !st.fsvc ? h('div', { class: 'ordenar' },
        h('button', { class: 'mover arrastar', type: 'button', 'aria-label': 'Arrastar ' + x.nome + ' para outra posição', title: 'Arraste para reordenar', onpointerdown: function (e) { iniciarArrasto(e, i); } }, '⠿'),
        h('button', { class: 'mover mover-cima', type: 'button', disabled: i === 0, 'aria-label': 'Mover ' + x.nome + ' para cima', onclick: function () { moverServico(i, i - 1); } }, '▲'),
        h('button', { class: 'mover mover-baixo', type: 'button', disabled: i === total - 1, 'aria-label': 'Mover ' + x.nome + ' para baixo', onclick: function () { moverServico(i, i + 1); } }, '▼')) : null;
      return h('div', { class: 'usuario' + (x.ativo ? '' : ' inativo'), 'data-sid': x.id },
        h('div', { class: 'topo' }, ordenar, h('strong', {}, x.nome), !x.ativo ? h('span', { class: 'badge cancelado' }, 'inativo') : null,
          x.ativo && !profs.length ? h('span', { class: 'badge cancelado' }, 'sem profissional') : null),
        h('div', { class: 'meta' }, 'aprox. ' + fmtDur(x.duracao) + (x.preparo ? ' · preparo ' + x.preparo + ' min' : '')),
        h('div', { class: 'meta' }, profs.length ? profs.map(function (p) { return nomeP[p.id] + (p.duracao ? ' (' + fmtDur(p.duracao) + ')' : ''); }).join(' · ') : 'Ninguém realiza este serviço'),
        h('div', { class: 'acoes' }, h('button', { class: 'btn mini sec', onclick: function () {
          var pf = {}; x.profissionais.forEach(function (p) { if (nomeP[p.id]) pf[p.id] = p.duracao; });
          st.fsvc = { id: x.id, nome: x.nome, duracao: x.duracao, preparo: x.preparo, ativo: x.ativo, profs: pf }; st.aviso = null; render(); } }, 'Editar'),
          h('button', { class: 'btn mini perigo', onclick: function () { excluirServico(x); } }, 'Excluir')));
    });
    return [tituloTela('Serviços'), avisoEl(), h('div', { class: 'lista-acessos' }, itens,
      st.fsvc && !st.fsvc.id ? formServico() : h('button', { class: 'btn sec', onclick: function () { st.fsvc = { id: '', nome: '', duracao: 30, preparo: 0, ativo: true, profs: {} }; st.aviso = null; render(); } }, '+ Novo serviço'),
      h('p', { class: 'pequeno' }, 'Use ▲ ▼ ou arraste pela alça ⠿ para ordenar: a mesma ordem aparece para o cliente. Os tempos são médios e aparecem como "aprox."; mudanças valem só para novos agendamentos.'))];
  }

  // ------------------------------------------------------------ relatórios e clientes
  function baixarCSV(nome, cabecalho, linhas) {
    var esc = function (v) {
      var t = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;                    // evita execução de fórmula ao abrir no Excel/Sheets
      return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    var txt = '﻿' + [cabecalho].concat(linhas).map(function (l) { return l.map(esc).join(';'); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  var NOME_STATUS = { agendado: 'agendado', realizado: 'realizado', faltou: 'faltou', cancelado: 'cancelado' };
  function periodoRel() {
    var hoje = hojeSP(), p = st.rper;
    if (p === 'mes') { var prox = Core.somarDias(hoje.slice(0, 8) + '28', 4); return { de: hoje.slice(0, 8) + '01', ate: Core.somarDias(prox.slice(0, 8) + '01', -1) }; }
    if (p === 'prox') return { de: hoje, ate: Core.somarDias(hoje, 30) };
    if (p === 'ant') { var ini = hoje.slice(0, 8) + '01', fimAnt = Core.somarDias(ini, -1); return { de: fimAnt.slice(0, 8) + '01', ate: fimAnt }; }
    if (p === '30') return { de: Core.somarDias(hoje, -29), ate: hoje };
    if (p === '90') return { de: Core.somarDias(hoje, -89), ate: hoje };
    return { de: st.rde || hoje.slice(0, 8) + '01', ate: st.rate || hoje };
  }
  function carregarRelatorio() {
    var per = periodoRel();
    chamar({ action: 'painelRelatorio', de: per.de, ate: per.ate, profissionalId: st.rprof || undefined }).then(function (r) {
      if (!r.ok) { falhaAviso(r); return; }
      st.aviso = null; st.rel = r.data; render();
    });
  }
  function horasTxt(m) { return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ('0' + (m % 60)).slice(-2) : '') : m + ' min'; }
  function barras(lista, rotulo) {
    var max = Math.max.apply(null, lista.map(function (x) { return x.qtd; }).concat([1]));
    return lista.length ? h('div', { class: 'barras' }, lista.map(function (x) {
      return h('div', { class: 'barra-linha' }, h('span', { class: 'bl-nome' }, x.nome),
        h('span', { class: 'bl-trilho', role: 'img', 'aria-label': x.nome + ': ' + x.qtd }, h('span', { class: 'bl-preenche', style: 'width:' + (x.qtd ? Math.max(4, Math.round(x.qtd * 100 / max)) : 0) + '%' })),
        h('span', { class: 'bl-valor' }, x.qtd + (rotulo ? ' · ' + horasTxt(x.minutos) : '')));
    })) : h('p', { class: 'vazio' }, 'Sem dados no período.');
  }
  function exportarRelatorio() {
    var r = st.rel, gest = ehGestor();
    var cab = ['Data', 'Início', 'Fim', 'Profissional', 'Serviço', 'Cliente'].concat(gest ? ['Telefone'] : []).concat(['Situação', 'Protocolo', 'Motivo do cancelamento']);
    baixarCSV('atendimentos_' + r.de + '_a_' + r.ate + '.csv', cab, r.linhas.map(function (l) {
      return [Core.dataBR(l.data), l.ini, l.fim, l.profissional, l.servico, l.cliente].concat(gest ? [l.telefone] : []).concat([NOME_STATUS[l.status] || l.status, l.protocolo, l.motivo]);
    }));
  }
  function telaRelatorios() {
    var gest = ehGestor(), titulo = gest ? 'Relatórios' : 'Meu resumo';
    if (!st.rel) return carregando(titulo);
    var r = st.rel, sm = r.resumo;
    var presets = [['mes', 'Este mês'], ['ant', 'Mês anterior'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['prox', 'Próximos 30 dias'], ['livre', 'Escolher datas']];
    var barraPer = h('div', { class: 'filtros' }, presets.map(function (p) { return h('button', { 'aria-pressed': String(st.rper === p[0]), onclick: function () { st.rper = p[0]; if (p[0] === 'livre') { st.rde = st.rde || r.de; st.rate = st.rate || r.ate; render(); } else carregarRelatorio(); } }, p[1]); }));
    var livre = st.rper === 'livre' ? h('div', { class: 'form-acesso', style: 'padding:0 1.25rem' },
      campo('De', h('input', { type: 'date', value: st.rde, onchange: function (e) { st.rde = e.target.value; } })),
      campo('Até', h('input', { type: 'date', value: st.rate, onchange: function (e) { st.rate = e.target.value; } })),
      h('button', { class: 'btn mini', onclick: carregarRelatorio }, 'Aplicar')) : null;
    var chipsProf = gest && r.profissionais.length > 1 ? h('div', { class: 'filtros' }, [{ id: '', nome: 'Toda a equipe' }].concat(r.profissionais).map(function (p) {
      return h('button', { 'aria-pressed': String(st.rprof === p.id), onclick: function () { st.rprof = p.id; carregarRelatorio(); } }, p.nome);
    })) : null;
    var kpi = function (v, rot, sub) { return h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, String(v)), h('div', { class: 'kpi-r' }, rot), sub ? h('div', { class: 'kpi-s' }, sub) : null); };
    var DS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    var dias = ORDEM_DIA.map(function (d) { return { nome: DS[d], qtd: r.porDiaSemana[d], minutos: 0 }; });
    return [tituloTela(titulo), barraPer, livre, chipsProf, avisoEl(),
      h('p', { class: 'pequeno', style: 'padding:0 1.25rem;margin:.2rem 0' }, Core.dataBR(r.de) + ' a ' + Core.dataBR(r.ate) + (gest ? '' : ' · somente a sua agenda')),
      h('div', { class: 'kpis' },
        kpi(sm.atendimentos, 'Atendimentos', sm.realizados + ' realizados · ' + sm.pendentes + ' a realizar'),
        kpi(sm.clientes, 'Clientes', sm.novos + ' novo(s)'),
        kpi(horasTxt(sm.minutos), 'Tempo de atendimento'),
        kpi(sm.cancelados, 'Cancelamentos', sm.taxaCancelamento + '%' + (sm.faltas ? ' · ' + sm.faltas + ' falta(s)' : ''))),
      gest && r.app ? h('div', { class: 'kpis' },
        kpi(r.app.instalacoes, 'App instalado', 'instalações no período'),
        kpi(r.app.aberturas, 'Uso do app instalado', 'aberturas por dia, no período')) : null,
      h('div', { class: 'lista-acessos' },
        h('h3', { style: 'margin:.4rem 0 0' }, 'Serviços mais realizados'), barras(r.porServico, true),
        gest ? [h('h3', { style: 'margin:.8rem 0 0' }, 'Por profissional'), barras(r.porProfissional, true)] : null,
        h('h3', { style: 'margin:.8rem 0 0' }, 'Dias da semana'), barras(dias, false),
        h('h3', { style: 'margin:.8rem 0 0' }, 'Motivos de cancelamento'),
        r.motivos.length ? r.motivos.map(function (m) { return h('div', { class: 'usuario' }, h('div', { class: 'topo' }, h('span', {}, m.motivo.length > 110 ? m.motivo.slice(0, 107) + '…' : m.motivo), h('span', { class: 'badge' }, String(m.qtd)))); }) : h('p', { class: 'vazio' }, 'Nenhum cancelamento no período.'),
        h('div', { class: 'acoes' }, h('button', { class: 'btn', disabled: !r.linhas.length, onclick: exportarRelatorio }, 'Exportar CSV (' + r.linhas.length + ' linhas)')),
        h('p', { class: 'pequeno' }, 'App instalado: contagem anônima, só desde que este recurso foi ativado; desinstalações não são detectadas e a instalação no iPhone não é contabilizada. O CSV abre direto no Excel e no Google Planilhas. Contém dados pessoais de clientes: guarde e compartilhe com cuidado (LGPD).'))];
  }

  function carregarClientes() {
    chamar({ action: 'painelClientes', busca: st.cbusca }).then(function (r) { if (!r.ok) { falhaAviso(r); return; } st.aviso = null; st.cli = r.data; render(); });
  }
  function abrirHistorico(id) {
    if (st.chist && st.chist.cliente.id === id) { st.chist = null; render(); return; }
    chamar({ action: 'painelClienteHistorico', clienteId: id }).then(function (r) { if (!r.ok) { falhaAviso(r); return; } st.chist = r.data; render(); });
  }
  function exportarClientes() {
    baixarCSV('clientes.csv', ['Nome', 'Telefone', 'Visitas', 'Agendamentos futuros', 'Cancelamentos', 'Faltas', 'Primeira visita', 'Última visita', 'Serviço mais frequente'],
      st.cli.clientes.map(function (c) { return [c.nome, c.telefone, c.visitas, c.futuros, c.cancelados, c.faltas, c.primeira ? Core.dataBR(c.primeira) : '', c.ultima ? Core.dataBR(c.ultima) : '', c.servicoFavorito]; }));
  }
  function telaClientes() {
    if (!st.cli) return carregando('Clientes');
    var cs = st.cli;
    var busca = h('div', { class: 'busca-clientes' },
      campo('Buscar por nome ou telefone', h('input', { type: 'search', value: st.cbusca, oninput: function (e) { st.cbusca = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') carregarClientes(); } })),
      h('button', { class: 'btn mini', onclick: carregarClientes }, 'Buscar'));
    var itens = cs.clientes.map(function (c) {
      var aberto = st.chist && st.chist.cliente.id === c.id;
      return h('div', { class: 'usuario' },
        h('div', { class: 'topo' }, h('strong', {}, c.nome), c.futuros ? h('span', { class: 'badge' }, c.futuros + ' a vir') : null),
        h('div', { class: 'meta' }, c.telefone + ' · ' + c.visitas + ' visita(s)' + (c.ultima ? ' · última em ' + Core.dataBR(c.ultima) : '')),
        h('div', { class: 'meta' }, (c.servicoFavorito ? 'Mais frequente: ' + c.servicoFavorito : 'Sem atendimentos') + (c.cancelados ? ' · ' + c.cancelados + ' cancelamento(s)' : '') + (c.faltas ? ' · ' + c.faltas + ' falta(s)' : '')),
        h('div', { class: 'acoes' }, h('button', { class: 'btn mini sec', 'aria-expanded': String(!!aberto), onclick: function () { abrirHistorico(c.id); } }, aberto ? 'Ocultar histórico' : 'Ver histórico')),
        aberto ? h('div', { class: 'historico' }, st.chist.itens.map(function (i) {
          return h('div', { class: 'meta' }, Core.dataBR(i.data) + ' ' + i.ini + ' · ' + i.servico + ' · ' + i.profissional + ' · ' + (NOME_STATUS[i.status] || i.status) + (i.motivo ? ' (' + i.motivo + ')' : ''));
        })) : null);
    });
    return [tituloTela('Clientes'), busca, avisoEl(), h('div', { class: 'lista-acessos' },
      h('p', { class: 'pequeno' }, cs.total + ' cliente(s)' + (cs.total > cs.clientes.length ? ' · mostrando os ' + cs.clientes.length + ' mais recentes' : '')),
      itens.length ? itens : h('p', { class: 'vazio' }, 'Nenhum cliente encontrado.'),
      h('div', { class: 'acoes' }, h('button', { class: 'btn', disabled: !cs.clientes.length, onclick: exportarClientes }, 'Exportar CSV')),
      h('p', { class: 'pequeno' }, 'Dados pessoais visíveis apenas ao gestor. Use-os somente para o atendimento e para estatísticas do estabelecimento.'))];
  }

  // ------------------------------------------------------------ promoções (tela inicial do cliente)
  var CORES_PROMO = ['#c2185b', '#e65100', '#2e7d32', '#1565c0', '#6a1b9a', '#2b2f36', '#f9d949', '#ffffff'];
  function corLetra(hex) {
    var n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1b1d21' : '#ffffff';
  }
  function carregarPromos() {
    chamar({ action: 'painelPromocoes' }).then(function (r) { if (!r.ok) { falhaAviso(r); return; } st.promos = r.data; render(); });
  }
  var EMOJIS = ['🎄', '🎅', '❄️', '🎁', '⭐', '🎃', '👻', '🦇', '🌹', '💐', '💖', '🎉', '🥳', '🔥', '✨', '🏷️', '💅', '💇', '✂️', '💈', '💄', '🧴', '🛍️', '🎂', '🐰', '🌞', '🌸', '❤️', '👑', '🎓'];
  function novaPromo() { var h0 = hojeSP(); return { id: '', texto: '', cor: '#c2185b', de: h0, ate: Core.somarDias(h0, 7), ativo: true, servicoIds: [], publico: '' }; }
  function formPromo() {
    var f = st.fpromo, previa = h('div', { class: 'promo-previa' }, h('p', {}, ''));
    var atualizar = function () { previa.style.background = f.cor; previa.style.color = corLetra(f.cor); previa.firstChild.textContent = f.texto || 'Prévia do texto da promoção'; };
    var texto = h('textarea', { rows: '4', maxlength: '300', placeholder: 'Ex.: Dia das mães: Corte de Cabelo + Unha com 50% de desconto', oninput: function (e) { f.texto = e.target.value; contador.textContent = f.texto.length + '/300'; atualizar(); } });
    texto.value = f.texto;
    var contador = h('span', { class: 'pequeno' }, f.texto.length + '/300');
    var emojis = h('div', { class: 'emojis', role: 'group', 'aria-label': 'Inserir emoji no texto' }, EMOJIS.map(function (em) {
      return h('button', { type: 'button', 'aria-label': 'Inserir ' + em, onclick: function () {
        var a = texto.selectionStart === undefined ? texto.value.length : texto.selectionStart, b = texto.selectionEnd === undefined ? a : texto.selectionEnd;
        var novo = texto.value.slice(0, a) + em + texto.value.slice(b);
        if (novo.length > 300) return;
        texto.value = novo; f.texto = novo; contador.textContent = novo.length + '/300'; atualizar();
        texto.focus(); texto.setSelectionRange(a + em.length, a + em.length);
      } }, em);
    }));
    var seletor = h('input', { type: 'color', value: f.cor, 'aria-label': 'Cor de fundo', oninput: function (e) { f.cor = e.target.value; atualizar(); } });
    var amostras = h('div', { class: 'amostras' }, CORES_PROMO.map(function (c) {
      return h('button', { type: 'button', class: 'amostra', style: 'background:' + c, 'aria-label': 'Usar a cor ' + c, onclick: function () { f.cor = c; seletor.value = c; atualizar(); } });
    }));
    atualizar();
    return h('div', { class: 'usuario' }, h('strong', {}, f.id ? 'Editar promoção' : 'Nova promoção'),
      h('div', { class: 'form-acesso' },
        campo('Texto (aparece em negrito, centralizado)', texto), contador, emojis,
        campo('Cor de fundo', h('div', {}, seletor, amostras)),
        campo('Para quem', h('select', { onchange: function (e) { f.publico = e.target.value; } }, [['', 'Todos os clientes'], ['aniversario', 'Aniversariantes (3 dias antes até 3 depois)'], ['maes', 'Quem quer ofertas no Dia das Mães'], ['pais', 'Quem quer ofertas no Dia dos Pais'], ['natal', 'Quem quer ofertas no Natal']].map(function (o) { return h('option', { value: o[0], selected: f.publico === o[0] }, o[1]); }))),
        campo('Mostrar a partir de', h('input', { type: 'date', value: f.de, onchange: function (e) { f.de = e.target.value; } })),
        campo('Mostrar até (inclusive)', h('input', { type: 'date', value: f.ate, onchange: function (e) { f.ate = e.target.value; } })),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.ativo, onchange: function (e) { f.ativo = e.target.checked; } }), 'Ativa')),
      h('p', { class: 'pequeno', style: 'margin:.6rem 0 .2rem' }, 'Atalho de agendamento (opcional): ao tocar na faixa, o cliente já cai na escolha de dia e hora com estes serviços selecionados (até 4).'),
      st.promos.servicos.length ? st.promos.servicos.map(function (sv) {
        return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.servicoIds.indexOf(sv.id) >= 0, onchange: function (e) {
          var i = f.servicoIds.indexOf(sv.id);
          if (e.target.checked && i < 0) { if (f.servicoIds.length >= 4) { e.target.checked = false; return; } f.servicoIds.push(sv.id); }
          if (!e.target.checked && i >= 0) f.servicoIds.splice(i, 1);
        } }), sv.nome);
      }) : h('p', { class: 'vazio' }, 'Cadastre serviços na aba Serviços para usar o atalho.'),
      h('p', { class: 'pequeno', style: 'margin:.6rem 0 .2rem' }, 'Prévia:'), previa,
      h('div', { class: 'acoes' },
        h('button', { class: 'btn mini', onclick: function () {
          chamar({ action: 'painelPromocaoSalvar', id: f.id || undefined, texto: f.texto, cor: f.cor, de: f.de, ate: f.ate, ativo: f.ativo, servicoIds: f.servicoIds, publico: f.publico }).then(function (r) {
            if (!r.ok) { falhaAviso(r); return; }
            st.aviso = { tipo: 'ok', texto: 'Promoção salva.' }; st.fpromo = null; carregarPromos();
          });
        } }, 'Salvar'),
        h('button', { class: 'btn mini sec', onclick: function () { st.fpromo = null; st.aviso = null; render(); } }, 'Cancelar')));
  }
  function telaPromos() {
    if (!st.promos) return carregando('Promoções');
    var ROT = { vigente: 'no ar agora', agendada: 'agendada', encerrada: 'encerrada', desativada: 'desativada' };
    var itens = st.promos.promocoes.map(function (x) {
      if (st.fpromo && st.fpromo.id === x.id) return formPromo();
      return h('div', { class: 'usuario' + (x.situacao === 'vigente' || x.situacao === 'agendada' ? '' : ' inativo') },
        h('div', { class: 'topo' }, h('strong', {}, Core.dataBR(x.de) + ' a ' + Core.dataBR(x.ate)), h('span', { class: 'badge' + (x.situacao === 'vigente' ? '' : ' cancelado') }, ROT[x.situacao])),
        h('div', { class: 'promo-previa pequena', style: 'background:' + x.cor + ';color:' + corLetra(x.cor) }, h('p', {}, x.texto)),
        x.publico ? h('div', { class: 'meta' }, 'Público: ' + ({ aniversario: 'aniversariantes', maes: 'Dia das Mães', pais: 'Dia dos Pais', natal: 'Natal' })[x.publico] + ' (só quem autorizou ofertas)') : null,
        x.servicoIds.length ? h('div', { class: 'meta' }, 'Atalho: ' + x.servicoIds.map(function (id) { var sv = st.promos.servicos.find(function (v) { return v.id === id; }); return sv ? sv.nome : id; }).join(' + ')) : null,
        h('div', { class: 'acoes' },
          h('button', { class: 'btn mini sec', onclick: function () { st.fpromo = { id: x.id, texto: x.texto, cor: x.cor, de: x.de, ate: x.ate, ativo: x.ativo, servicoIds: x.servicoIds.slice(), publico: x.publico || '' }; st.aviso = null; render(); } }, 'Editar'),
          h('button', { class: 'btn mini perigo', onclick: function () {
            if (!confirm('Excluir esta promoção?')) return;
            chamar({ action: 'painelPromocaoRemover', id: x.id }).then(function (r) { if (!r.ok) { falhaAviso(r); return; } st.aviso = { tipo: 'ok', texto: 'Promoção excluída.' }; carregarPromos(); });
          } }, 'Excluir')));
    });
    return [tituloTela('Promoções'), avisoEl(), h('div', { class: 'lista-acessos' }, itens.length ? itens : h('p', { class: 'vazio' }, 'Nenhuma promoção cadastrada.'),
      st.fpromo && !st.fpromo.id ? formPromo() : h('button', { class: 'btn sec', onclick: function () { st.fpromo = novaPromo(); st.aviso = null; render(); } }, '+ Nova promoção'),
      h('p', { class: 'pequeno' }, 'Durante o período, o cliente vê a tela cheia toda vez que abre o app e, depois de fechá-la, uma faixa com o mesmo texto e cor acima dos serviços. Tudo some sozinho depois da data final. Se houver mais de uma no ar, vale a que começou por último. É só texto informativo: não altera valores nem aplica desconto no agendamento.'))];
  }

  function render() {
    if (!st.token) { raiz.replaceChildren(telaLogin()); return; }
    var corpo = !ehGestor() && st.aba !== 'agenda' && st.aba !== 'horarios' && st.aba !== 'relatorios' ? telaAgenda()
      : st.aba === 'promocoes' && ehGestor() ? telaPromos() : st.aba === 'relatorios' ? telaRelatorios() : st.aba === 'clientes' && ehGestor() ? telaClientes()
      : st.aba === 'acessos' && ehGestor() ? telaAcessos() : st.aba === 'horarios' ? telaHorarios()
      : st.aba === 'equipe' && ehGestor() ? telaEquipe() : st.aba === 'servicos' && ehGestor() ? telaServicos() : telaAgenda();
    raiz.replaceChildren(h('div', { class: 'painel' }, barra(), corpo));
  }

  render();
  if (st.token) carregar();
  setInterval(function () { if (st.token && st.aba === 'agenda' && st.ag && !st.cancel && !document.hidden) carregar(); }, 60000);
})();
