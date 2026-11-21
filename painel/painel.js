/* painel.js — painel da equipe, com dois perfis:
 *  - gestor: agenda de todos, cancelamento, bloqueios e gestão de acessos;
 *  - profissional: apenas a própria agenda (o servidor só entrega os dados dele).
 * Endereço: painel/?p=<slug>   (ex.: painel/?p=demo) */
(function () {
  'use strict';
  var raiz = document.getElementById('painel');
  var slug = new URLSearchParams(location.search).get('p') || 'demo';
  var CHAVE = 'agenda:painel:' + slug;
  var DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  function telFmt(t) {
    var d = String(t || '').replace(/^55/, '');
    return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : d;
  }
  function hojeSP() { return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10); }

  var st = {
    token: null, prestador: '', usuario: null, aba: 'agenda', data: hojeSP(), ag: null, filtro: '*',
    cancel: null, aviso: null, login: { usuario: '', pin: '' }, acessos: null, form: null
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

  function barra() {
    var quem = st.usuario ? st.usuario.nome + (ehGestor() ? ' (gestor)' : '') : '';
    var topo = h('div', { class: 'barra' }, h('div', { class: 'nome' }, st.prestador || 'Painel', quem ? h('div', { class: 'pequeno' }, quem) : null),
      h('button', { class: 'btn mini sec', onclick: function () { if (st.aba === 'agenda') carregar(); else carregarAcessos(); } }, 'Atualizar'),
      h('button', { class: 'btn mini sec', onclick: function () { sair(); } }, 'Sair'));
    if (!ehGestor()) return [topo];
    var aba = function (id, rot) { return h('button', { 'aria-current': st.aba === id ? 'page' : false, onclick: function () { st.aba = id; st.aviso = null; st.cancel = null; st.form = null; if (id === 'acessos') carregarAcessos(); render(); } }, rot); };
    return [topo, h('div', { class: 'abas', role: 'navigation' }, aba('agenda', 'Agenda'), aba('acessos', 'Acessos'))];
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

  function render() {
    if (!st.token) { raiz.replaceChildren(telaLogin()); return; }
    var corpo = st.aba === 'acessos' && ehGestor() ? telaAcessos() : telaAgenda();
    raiz.replaceChildren(h('div', { class: 'painel' }, barra(), corpo));
  }

  render();
  if (st.token) carregar();
  setInterval(function () { if (st.token && st.aba === 'agenda' && st.ag && !st.cancel && !document.hidden) carregar(); }, 60000);
})();
