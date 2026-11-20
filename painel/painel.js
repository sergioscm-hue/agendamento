/* painel.js — painel do prestador (gestor): agenda do dia por profissional, status, cancelamento e bloqueios.
 * Endereço: painel/?p=<slug>   (ex.: painel/?p=demo) */
(function () {
  'use strict';
  var raiz = document.getElementById('painel');
  var slug = new URLSearchParams(location.search).get('p') || 'demo';
  var CHAVE = 'agenda:painel:' + slug;
  var DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function telFmt(t) {
    var d = String(t || '').replace(/^55/, '');
    return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : d;
  }
  function hojeSP() { return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10); }

  var st = { token: null, nome: '', data: hojeSP(), ag: null, confirmando: null, aviso: null, pin: '' };
  try { st.token = sessionStorage.getItem(CHAVE); st.nome = sessionStorage.getItem(CHAVE + ':nome') || ''; } catch (e) { /* ignore */ }

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
      if (!r.ok && (r.erro === 'sessao_expirada' || r.erro === 'nao_autorizado') && st.token) { sair('Sessão expirada. Entre novamente.'); }
      return r;
    });
  }
  function sair(aviso) {
    st.token = null; st.ag = null;
    try { sessionStorage.removeItem(CHAVE); } catch (e) { /* ignore */ }
    st.aviso = aviso ? { tipo: 'info', texto: aviso } : null;
    render();
  }
  function avisoEl() { return st.aviso ? h('div', { class: 'msg ' + st.aviso.tipo, role: 'alert', style: 'margin:.8rem 1.25rem' }, st.aviso.texto) : null; }

  // ------------------------------------------------------------ login
  function telaLogin() {
    var pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', placeholder: 'PIN do prestador', value: st.pin, oninput: function (e) { st.pin = e.target.value; } });
    function entrar() {
      Api.chamar({ action: 'painelLogin', slug: slug, pin: st.pin }).then(function (r) {
        if (!r.ok) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); return; }
        st.token = r.data.token; st.nome = r.data.prestador.nome; st.pin = ''; st.aviso = null;
        try { sessionStorage.setItem(CHAVE, st.token); sessionStorage.setItem(CHAVE + ':nome', st.nome); } catch (e) { /* ignore */ }
        carregar();
      });
    }
    pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
    return h('div', { style: 'max-width:380px;margin:0 auto;padding:2rem 1.25rem' },
      h('h1', {}, 'Painel do prestador'), h('p', { class: 'sub' }, 'Informe o PIN para ver a agenda.'),
      avisoEl(), h('label', { for: 'pin' }, 'PIN'), pin,
      h('button', { class: 'btn', onclick: entrar }, 'Entrar'));
  }

  // ------------------------------------------------------------ agenda
  function carregar() {
    chamar({ action: 'painelAgenda', data: st.data }).then(function (r) {
      if (!r.ok) { if (st.token) { st.aviso = { tipo: 'erro', texto: r.mensagem }; render(); } return; }
      st.ag = r.data; render();
    });
  }
  function mudarData(d) { st.data = d; st.confirmando = null; st.aviso = null; st.ag = null; render(); carregar(); }
  function somar(n) { return Core.somarDias(st.data, n); }

  function cartao(i) {
    var cancelado = i.status === 'cancelado';
    var botoes = null;
    if (!cancelado) {
      botoes = h('div', { class: 'acoes' },
        i.status !== 'realizado' ? h('button', { class: 'btn mini sec', onclick: function () { marcar(i.id, 'realizado'); } }, 'Realizado') : null,
        i.status !== 'faltou' ? h('button', { class: 'btn mini sec', onclick: function () { marcar(i.id, 'faltou'); } }, 'Faltou') : null,
        i.status !== 'agendado' ? h('button', { class: 'btn mini sec', onclick: function () { marcar(i.id, 'agendado'); } }, 'Desfazer') : null,
        st.confirmando === i.protocolo
          ? [h('span', { class: 'pequeno' }, 'Cancelar a reserva inteira?'), h('button', { class: 'btn mini perigo', onclick: function () { cancelar(i.protocolo); } }, 'Sim'),
            h('button', { class: 'btn mini sec', onclick: function () { st.confirmando = null; render(); } }, 'Não')]
          : h('button', { class: 'btn mini perigo', onclick: function () { st.confirmando = i.protocolo; render(); } }, 'Cancelar'));
    }
    return h('div', { class: 'ag' + (cancelado ? ' cancelado' : '') },
      h('div', { class: 'h' }, i.ini + ' – ' + i.fim + '  ', i.status !== 'agendado' ? h('span', { class: 'badge ' + i.status }, i.status) : null),
      h('div', {}, i.servico),
      h('div', { class: 'meta' }, i.cliente + ' · ',
        h('a', { href: 'tel:+' + i.telefone }, telFmt(i.telefone)), ' · ',
        h('a', { href: 'https://wa.me/' + i.telefone, target: '_blank', rel: 'noopener' }, 'WhatsApp')),
      h('div', { class: 'meta' }, 'Protocolo ' + i.protocolo),
      botoes);
  }
  function marcar(id, status) { chamar({ action: 'painelStatus', itemId: id, status: status }).then(function (r) { if (!r.ok) st.aviso = { tipo: 'erro', texto: r.mensagem }; carregar(); }); }
  function cancelar(protocolo) {
    chamar({ action: 'painelCancelar', protocolo: protocolo }).then(function (r) {
      st.confirmando = null; st.aviso = { tipo: r.ok ? 'ok' : 'erro', texto: r.ok ? 'Reserva cancelada.' : r.mensagem }; carregar();
    });
  }

  function formBloqueio() {
    var prof = h('select', {}, h('option', { value: '*' }, 'Todos os profissionais'), st.ag.profissionais.map(function (p) { return h('option', { value: p.id }, p.nome); }));
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

  function telaAgenda() {
    var topo = h('div', { class: 'barra' }, h('div', { class: 'nome' }, st.nome || 'Painel'),
      h('button', { class: 'btn mini sec', onclick: carregar }, 'Atualizar'), h('button', { class: 'btn mini sec', onclick: function () { sair(); } }, 'Sair'));
    var nav = h('div', { class: 'data-nav' },
      h('button', { 'aria-label': 'Dia anterior', onclick: function () { mudarData(somar(-1)); } }, '‹'),
      h('input', { type: 'date', value: st.data, onchange: function (e) { if (e.target.value) mudarData(e.target.value); } }),
      h('button', { 'aria-label': 'Próximo dia', onclick: function () { mudarData(somar(1)); } }, '›'),
      h('button', { style: 'width:auto;padding:0 .8rem;font:inherit', onclick: function () { mudarData(hojeSP()); } }, 'Hoje'));
    var titulo = h('h1', { style: 'padding:.6rem 1.25rem 0;margin:0' }, DIAS[Core.diaSemana(st.data)] + ', ' + Core.dataBR(st.data));
    if (!st.ag) return h('div', { class: 'painel' }, topo, nav, titulo, avisoEl(), h('p', { class: 'vazio', style: 'padding:0 1.25rem' }, 'Carregando…'));
    var colunas = st.ag.profissionais.map(function (p) {
      return h('div', { class: 'col' }, h('h3', {}, p.nome),
        p.bloqueios.map(function (b) { return h('div', { class: 'bloqueio' }, 'Bloqueado ' + b.ini + ' – ' + b.fim + (b.motivo ? ' · ' + b.motivo : '')); }),
        p.itens.length ? p.itens.map(cartao) : h('div', { class: 'vazio' }, 'Sem agendamentos.'));
    });
    return h('div', { class: 'painel' }, topo, nav, titulo, avisoEl(), h('div', { class: 'cols' }, colunas), formBloqueio());
  }

  function render() { raiz.replaceChildren(st.token ? telaAgenda() : telaLogin()); }

  render();
  if (st.token) carregar();
  setInterval(function () { if (st.token && st.ag && !st.confirmando && !document.hidden) carregar(); }, 60000);
})();
