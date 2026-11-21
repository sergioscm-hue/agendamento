/* app.js — aplicativo do cliente (PWA). Uma única matriz para todos os prestadores:
 * o prestador é definido por <html data-slug="..."> na página de cada um (p/<slug>/index.html). */
(function () {
  'use strict';

  var raiz = document.getElementById('app');
  var slug = document.documentElement.dataset.slug;
  var base = document.documentElement.dataset.base || './';
  var DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var POLITICA_VERSAO = '1';
  var CHAVE_SESSAO = 'agenda:' + slug + ':sessao';

  var st = {
    cfg: null, token: null, cliente: null, tela: 'acesso', aviso: null,
    form: { nome: '', telefone: '', aceite: false, codigo: '' }, passoCodigo: false, codigoTeste: null,
    sel: [], mes: null, data: null, opcoes: null, opcaoSel: null, reserva: null,
    minhas: null, confirmaCancelar: null, instalar: null, instalarOculto: false
  };

  // ---------------------------------------------------------------- utilidades
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
    var kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(function (c) {
        if (Array.isArray(c)) return add(c);
        if (c == null || c === false) return;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function hojeSP() { return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10); }
  function fmtDur(m) { return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + pad(m % 60); }
  function dataLonga(d) { return DIAS[Core.diaSemana(d)] + ', ' + Core.dataBR(d); }
  function iniciais(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase(); }
  function mascara(v) {
    var d = String(v).replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function telFmt(t) { var d = String(t || '').replace(/\D/g, '').replace(/^55/, ''); return mascara(d); }
  function corTexto(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1b1d21' : '#fff';
  }
  function lerSessao() { try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)); } catch (e) { return null; } }
  // ---------------------------------------------------------------- lembretes por notificação (opt-in)
  var FIREBASE_VER = '10.12.2';
  var CHAVE_PUSH = 'agenda_push_' + slug;
  function pushConfig() { return window.AGENDA_PUSH && window.AGENDA_PUSH.vapidKey ? window.AGENDA_PUSH : null; }
  function pushSuportado() { return !!pushConfig() && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window; }
  function pushToken() { try { return localStorage.getItem(CHAVE_PUSH) || ''; } catch (e) { return ''; } }
  function pushAtivo() { return pushSuportado() && Notification.permission === 'granted' && !!pushToken(); }
  function carregarScript(src) {
    return new Promise(function (ok, erro) {
      if (document.querySelector('script[src="' + src + '"]')) { ok(); return; }
      var sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = function () { erro(new Error('script')); }; document.head.appendChild(sc);
    });
  }
  function firebaseMessaging() {
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VER + '/';
    return carregarScript(base + 'firebase-app-compat.js').then(function () { return carregarScript(base + 'firebase-messaging-compat.js'); }).then(function () {
      var c = pushConfig();
      if (!window.firebase.apps.length) window.firebase.initializeApp({ apiKey: c.apiKey, projectId: c.projectId, messagingSenderId: c.messagingSenderId, appId: c.appId });
      return window.firebase.messaging();
    });
  }
  // devolve { ok, motivo }: pede a permissão, obtém o token do aparelho e o registra para este cliente
  function ativarPush() {
    if (!pushSuportado()) return Promise.resolve({ ok: false, motivo: 'nao_suportado' });
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return { ok: false, motivo: perm === 'denied' ? 'negado' : 'adiado' };
      return navigator.serviceWorker.ready.then(function (reg) {
        return firebaseMessaging().then(function (m) { return m.getToken({ vapidKey: pushConfig().vapidKey, serviceWorkerRegistration: reg }); });
      }).then(function (tok) {
        if (!tok) return { ok: false, motivo: 'erro' };
        return chamar({ action: 'pushRegistrar', dispositivo: tok }).then(function (r) {
          if (!r.ok) return { ok: false, motivo: 'erro' };
          try { localStorage.setItem(CHAVE_PUSH, tok); } catch (e) { /* ignore */ }
          return { ok: true };
        });
      });
    }).catch(function () { return { ok: false, motivo: 'erro' }; });
  }
  // ao abrir o app: se o Firebase trocou o token deste aparelho, registra o novo (evita lembretes que nunca chegam)
  function renovarPush() {
    if (!pushAtivo() || !st.token) return;
    navigator.serviceWorker.ready.then(function (reg) {
      return firebaseMessaging().then(function (m) { return m.getToken({ vapidKey: pushConfig().vapidKey, serviceWorkerRegistration: reg }); });
    }).then(function (tok) {
      var velho = pushToken();
      if (!tok || tok === velho) return;
      return chamar({ action: 'pushRegistrar', dispositivo: tok }).then(function (r) {
        if (!r.ok) return;
        try { localStorage.setItem(CHAVE_PUSH, tok); } catch (e) { /* ignore */ }
        if (velho) return chamar({ action: 'pushRemover', dispositivo: velho });
      });
    }).catch(function () { /* ignore */ });
  }
  function desativarPush() {
    var tok = pushToken();
    try { localStorage.removeItem(CHAVE_PUSH); } catch (e) { /* ignore */ }
    if (!tok) return Promise.resolve();
    return chamar({ action: 'pushRemover', dispositivo: tok }).then(function () {
      return firebaseMessaging().then(function (m) { return m.deleteToken(); }).catch(function () { /* ignore */ });
    });
  }
  var TEXTO_PUSH = { negado: 'As notificações estão bloqueadas para este app. Para receber lembretes, libere-as nas configurações do navegador ou do aparelho.', adiado: 'Você não permitiu as notificações.', erro: 'Não foi possível ativar os lembretes agora. Tente novamente.', nao_suportado: 'Este aparelho ou navegador não permite lembretes por notificação.' };
  // cartão para a confirmação e para o Perfil
  function blocoLembretes(convite) {
    if (!pushConfig()) return null;
    var el = h('div', { class: 'card lembretes' });
    function desenhar(aviso) {
      var itens;
      if (!pushSuportado()) itens = convite ? [] : [h('b', {}, 'Lembretes por notificação'), h('div', { class: 'pequeno' }, 'Disponível no Android (Chrome). No iPhone, instale o app na tela inicial e use o iOS 16.4 ou superior.')];
      else if (pushAtivo()) itens = convite
        ? [h('b', {}, '🔔 Lembretes ativados'), h('div', { class: 'pequeno' }, 'Você receberá um aviso 24 horas e 2 horas antes do horário.')]
        : [h('b', {}, '🔔 Lembretes ativados neste aparelho'), h('div', { class: 'pequeno' }, 'Aviso 24 horas e 2 horas antes de cada horário.'),
          h('button', { class: 'btn sec', onclick: function () { desativarPush().then(function () { desenhar(); }); } }, 'Desativar lembretes')];
      else if (Notification.permission === 'denied') itens = convite ? [] : [h('b', {}, 'Lembretes por notificação'), h('div', { class: 'pequeno' }, TEXTO_PUSH.negado)];
      else itens = [h('b', {}, convite ? 'Receber lembretes deste horário?' : 'Lembretes por notificação'),
        h('div', { class: 'pequeno' }, 'Avisamos 24 horas e 2 horas antes, direto no seu celular. Você pode desativar quando quiser.'),
        h('button', { class: 'btn', onclick: function () { ativarPush().then(function (r) { desenhar(r.ok ? null : TEXTO_PUSH[r.motivo]); }); } }, 'Ativar lembretes')];
      if (!itens.length) { el.style.display = 'none'; return; }
      el.style.display = '';
      if (aviso) itens.push(h('div', { class: 'msg erro', role: 'alert' }, aviso));
      el.replaceChildren.apply(el, itens);
    }
    desenhar();
    return el;
  }

  function salvarSessao() { try { localStorage.setItem(CHAVE_SESSAO, JSON.stringify({ token: st.token, cliente: st.cliente })); } catch (e) { /* ignore */ } }
  function limparSessao() { try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignore */ } st.token = null; st.cliente = null; }

  function chamar(req) {
    return Api.chamar(Object.assign({ slug: slug, token: st.token }, req)).then(function (r) {
      if (!r.ok && r.erro === 'sessao_expirada' && st.token) {
        limparSessao();
        st.aviso = { tipo: 'info', texto: 'Sua sessão expirou. Entre novamente.' };
        ir('acesso');
      }
      return r;
    });
  }
  function avisoEl() {
    if (!st.aviso) return null;
    return h('div', { class: 'msg ' + st.aviso.tipo, role: 'alert' }, st.aviso.texto);
  }
  function setAviso(tipo, texto) { st.aviso = texto ? { tipo: tipo, texto: texto } : null; }

  // ---------------------------------------------------------------- estrutura (casca) e navegação
  function ir(tela) {
    st.tela = tela;
    if (tela !== 'acesso') { /* mantém aviso apenas se acabou de ser definido */ }
    render();
    window.scrollTo(0, 0);
  }

  function navBase() {
    var item = function (id, rotulo, alvo) {
      return h('button', { class: st.tela === id || (alvo === 'servicos' && ['servicos', 'horario', 'confirmacao'].indexOf(st.tela) >= 0) ? 'on' : '', onclick: function () { setAviso(); if (alvo === 'meus') st.minhas = null; ir(alvo); } },
        h('i'), rotulo);
    };
    return h('nav', { class: 'base', 'aria-label': 'Navegação' },
      item('servicos', 'Início', 'servicos'), item('meus', 'Meus agend.', 'meus'), item('perfil', 'Perfil', 'perfil'));
  }

  // logo do estabelecimento: a informada na planilha ou, se não houver, o arquivo p/<slug>/logo.png; sem nenhum, a inicial do nome
  function logoEl(estilo) {
    var p = st.cfg.prestador, inicial = (p.nome || '?')[0];
    var el = h('div', { class: 'logo', style: estilo || '' });
    var img = h('img', { src: p.logo || (base + 'p/' + slug + '/logo.png'), alt: '' });
    img.onerror = function () { el.replaceChildren(document.createTextNode(inicial)); };
    el.appendChild(img);
    return el;
  }

  function casca(conteudo) {
    var p = st.cfg.prestador;
    var logo = logoEl('');
    var banner = null;
    if (st.instalar && !st.instalarOculto && st.tela === 'servicos') {
      banner = h('div', { class: 'faixa' }, h('span', {}, 'Instale o app no seu celular para agendar mais rápido.'),
        h('button', { class: 'btn mini', onclick: instalarApp }, 'Instalar'),
        h('button', { class: 'link', 'aria-label': 'Dispensar', onclick: function () { st.instalarOculto = true; render(); } }, '✕'));
    }
    var partes = [
      Api.demo ? h('div', { class: 'faixa-demo' }, 'Modo demonstração: os dados ficam só neste aparelho.') : null,
      h('header', { class: 'topo' }, logo, h('div', { class: 'nome' }, p.nome),
        st.cliente ? h('button', { class: 'avatar', 'aria-label': 'Meu perfil', onclick: function () { ir('perfil'); } }, iniciais(st.cliente.nome)) : null),
      banner,
      h('main', {}, conteudo),
      st.token ? navBase() : null
    ].filter(Boolean);                       // replaceChildren(null) escreveria o texto "null"
    raiz.replaceChildren.apply(raiz, partes);
  }

  function passos(ativo) {
    var nomes = ['Serviços', 'Horário', 'Confirmar'];
    return h('div', { class: 'passos', 'aria-label': 'Etapas' }, nomes.map(function (n, i) {
      return h('div', { class: 'passo' + (i + 1 <= ativo ? ' on' : '') }, h('i', {}, i + 1), n);
    }));
  }

  var TELAS = {};
  function render() { if (st.tela === 'promo') raiz.replaceChildren(telaPromo()); else casca(TELAS[st.tela]()); }

  // ---------------------------------------------------------------- tela promocional (opcional, definida pelo gestor)
  function fecharPromo() {
    document.removeEventListener('keydown', teclaPromo);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', st.cfg.prestador.cor || '#2b2f36');
    var destino = st.depoisPromo || 'servicos'; st.promo = null;
    ir(destino);
  }
  function teclaPromo(e) { if (e.key === 'Escape') fecharPromo(); }
  function telaPromo() {
    var pm = st.promo, fundo = /^#[0-9a-f]{6}$/i.test(pm.cor) ? pm.cor : '#2b2f36', letra = corTexto(fundo);
    var botao = h('button', { class: 'promo-ok', type: 'button', style: 'background:' + letra + ';color:' + fundo, onclick: fecharPromo }, 'Continuar');
    document.addEventListener('keydown', teclaPromo);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', fundo);
    setTimeout(function () { botao.focus(); }, 0);
    return h('div', { class: 'promo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Promoção', style: 'background:' + fundo + ';color:' + letra },
      h('button', { class: 'promo-x', type: 'button', 'aria-label': 'Fechar', style: 'color:' + letra, onclick: fecharPromo }, '✕'),
      h('div', { class: 'promo-marca' },
        logoEl('width:84px;height:84px;margin:0 auto;font-size:1.6rem;border-radius:18px'),
        h('div', { class: 'promo-nome' }, st.cfg.prestador.nome)),
      h('div', { class: 'promo-corpo' }, h('p', { class: 'promo-texto' }, pm.texto), botao));
  }

  // ---------------------------------------------------------------- tela 1: acesso
  TELAS.acesso = function () {
    var f = st.form;
    var porCodigo = st.cfg.prestador.verificacao === 'codigo';
    var msg = h('div', { id: 'msg' }, avisoEl());
    function mostrar(tipo, texto) { msg.replaceChildren(texto ? h('div', { class: 'msg ' + tipo, role: 'alert' }, texto) : ''); }

    if (porCodigo && st.passoCodigo) {
      var cod = h('input', {
        type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', value: f.codigo, placeholder: '000000',
        oninput: function (e) { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); f.codigo = e.target.value; ok.disabled = f.codigo.length !== 6; }
      });
      var ok = h('button', { class: 'btn', type: 'button', disabled: f.codigo.length !== 6, onclick: verificar }, 'Confirmar código');
      return h('div', {},
        h('h1', {}, 'Confirme seu telefone'),
        h('p', { class: 'sub' }, 'Enviamos um código de 6 dígitos para o WhatsApp ' + f.telefone + '.'),
        st.codigoTeste ? h('div', { class: 'msg info' }, 'Modo de teste — código: ' + st.codigoTeste) : null,
        msg, h('label', { for: 'cod' }, 'Código recebido'), cod, ok,
        h('div', { class: 'centro' },
          h('button', { class: 'link', onclick: function () { enviar(true); } }, 'Reenviar código'),
          h('button', { class: 'link', onclick: function () { st.passoCodigo = false; setAviso(); render(); } }, 'Corrigir telefone')));
    }

    var nome = h('input', { type: 'text', id: 'nome', autocomplete: 'name', value: f.nome, placeholder: 'Digite seu nome', oninput: function (e) { f.nome = e.target.value; validar(); } });
    var tel = h('input', {
      type: 'tel', id: 'tel', inputmode: 'numeric', autocomplete: 'tel-national', value: f.telefone, placeholder: '(21) 99999-1234',
      oninput: function (e) { e.target.value = mascara(e.target.value); f.telefone = e.target.value; validar(); }
    });
    var aceite = h('input', { type: 'checkbox', id: 'aceite', checked: f.aceite, onchange: function (e) { f.aceite = e.target.checked; validar(); } });
    var btn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: function () { enviar(false); } }, porCodigo ? 'Enviar código por WhatsApp' : 'Entrar');
    function validar() { btn.disabled = !(f.nome.trim().length >= 2 && Core.normalizarTelefone(f.telefone) && f.aceite); }
    setTimeout(validar, 0);

    function enviar(reenvio) {
      btn.disabled = true; mostrar('', '');
      var dados = { nome: f.nome, telefone: f.telefone, consentimento: true, consentimentoVersao: POLITICA_VERSAO };
      chamar(Object.assign({ action: porCodigo ? 'enviarCodigo' : 'cadastrar' }, dados)).then(function (r) {
        if (!r.ok) { setAviso(); btn.disabled = false; mostrar('erro', r.mensagem); return; }
        if (porCodigo) { st.passoCodigo = true; st.codigoTeste = r.data.codigoTeste || null; setAviso(reenvio ? 'ok' : '', reenvio ? 'Novo código enviado.' : ''); render(); }
        else iniciarSessao(r.data);
      });
    }
    function verificar() {
      var dados = { nome: f.nome, telefone: f.telefone, consentimento: true, consentimentoVersao: POLITICA_VERSAO, codigo: f.codigo };
      chamar(Object.assign({ action: 'verificarCodigo' }, dados)).then(function (r) {
        if (!r.ok) { mostrar('erro', r.mensagem); return; }
        iniciarSessao(r.data);
      });
    }

    return h('div', {},
      h('div', { class: 'centro' }, logoEl('width:84px;height:84px;margin:.4rem auto;font-size:1.6rem;border-radius:18px')),
      h('h1', { class: 'centro' }, 'Bem-vindo(a)'),
      h('p', { class: 'sub centro' }, 'Cadastre-se uma vez; depois o app reconhece você.'),
      msg,
      h('label', { for: 'nome' }, 'Nome completo'), nome,
      h('label', { for: 'tel' }, 'Telefone (WhatsApp)'), tel,
      h('div', { class: 'consent' }, aceite,
        h('label', { for: 'aceite', style: 'margin:0;font-size:.85rem;color:inherit' }, 'Li e aceito a ',
          h('a', { href: base + 'politica.html', target: '_blank', rel: 'noopener' }, 'Política de Privacidade'), ' e os ',
          h('a', { href: base + 'termos.html', target: '_blank', rel: 'noopener' }, 'Termos de Uso'), ' (LGPD).')),
      btn,
      h('p', { class: 'pequeno centro', style: 'margin-top:1rem' }, 'Nos próximos acessos: login automático.'));
  };

  function atualizarPromocao() {
    chamar({ action: 'minhaPromocao' }).then(function (r) { if (r.ok) { st.cfg.promocao = r.data.promocao; if (st.tela === 'servicos') render(); } });
  }
  function iniciarSessao(d) {
    st.token = d.token; st.cliente = d.cliente; salvarSessao();
    st.form.codigo = ''; st.passoCodigo = false; setAviso();
    atualizarPromocao();
    ir('servicos');
  }

  // ---------------------------------------------------------------- tela 2: serviços e profissionais
  function alternar(id) {
    var i = st.sel.findIndex(function (x) { return x.servicoId === id; });
    if (i >= 0) st.sel.splice(i, 1);
    else if (st.sel.length < 4) st.sel.push({ servicoId: id, profId: '' });
    st.data = null; st.opcoes = null; st.opcaoSel = null;
    render();
  }

  // faixa fixa com a promoção vigente (mesma cor e texto da tela inicial); some sozinha ao fim do período
  function faixaPromo() {
    var pm = st.cfg && st.cfg.promocao;
    if (!pm) return null;
    var fundo = /^#[0-9a-f]{6}$/i.test(pm.cor) ? pm.cor : '#2b2f36';
    var estilo = 'background:' + fundo + ';color:' + corTexto(fundo);
    var ids = pm.servicoIds || [];
    if (!ids.length) return h('div', { class: 'faixa-promo', role: 'note', style: estilo }, pm.texto);
    // com serviços vinculados, a faixa vira atalho: seleciona os serviços e vai direto para dia e hora
    var nomes = ids.map(function (id) { var x = st.cfg.servicos.find(function (v) { return v.id === id; }); return x ? x.nome : ''; }).filter(Boolean).join(' + ');
    return h('button', { class: 'faixa-promo atalho', type: 'button', style: estilo, 'aria-label': pm.texto + '. Toque para agendar: ' + nomes, onclick: function () {
      st.sel = ids.map(function (id) { return { servicoId: id, profId: '' }; });
      st.data = null; st.opcoes = null; st.opcaoSel = null; setAviso(); ir('horario');
    } }, h('span', {}, pm.texto), h('span', { class: 'faixa-cta' }, 'Toque para agendar: ' + nomes + ' ›'));
  }

  TELAS.servicos = function () {
    var cfg = st.cfg;
    var total = 0;
    var cards = cfg.servicos.map(function (s) {
      var idx = st.sel.findIndex(function (x) { return x.servicoId === s.id; });
      var on = idx >= 0;
      if (on) total += s.duracao;
      var profs = s.profissionais.map(function (id) { return cfg.profissionais.find(function (p) { return p.id === id; }); }).filter(Boolean);
      return h('div', { class: 'card' + (on ? ' sel' : '') },
        h('div', { class: 'linha', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', tabindex: '0',
          onclick: function () { alternar(s.id); },
          onkeydown: function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); alternar(s.id); } } },
        h('span', { class: 'caixa' }, on ? '✓' : ''),
        h('span', { class: 'tit' }, on ? h('span', { class: 'ordem' }, idx + 1) : null, s.nome),
        h('span', { class: 'chip' }, 'aprox. ' + fmtDur(s.duracao))),
        on ? h('select', { 'aria-label': 'Profissional para ' + s.nome, onchange: function (e) { st.sel[idx].profId = e.target.value; st.opcoes = null; st.opcaoSel = null; render(); } },
          h('option', { value: '' }, 'Sem preferência'),
          profs.map(function (p) { return h('option', { value: p.id, selected: st.sel[idx].profId === p.id }, 'Profissional: ' + p.nome); })) : null);
    });
    return h('div', {},
      h('h1', {}, 'Escolha os serviços'),
      passos(1), avisoEl(), faixaPromo(), cards,
      st.sel.length > 1 ? h('p', { class: 'pequeno' }, 'Os serviços serão feitos na ordem numerada, um após o outro.') : null,
      h('div', { class: 'resumo' },
        h('div', { class: 'pequeno' }, st.sel.length + (st.sel.length === 1 ? ' serviço' : ' serviços') + ' · tempos médios aproximados'),
        h('b', {}, st.sel.length ? 'Duração total: aprox. ' + fmtDur(total) : 'Selecione ao menos um serviço')),
      h('button', { class: 'btn', disabled: !st.sel.length, onclick: function () { setAviso(); ir('horario'); } }, 'Ver horários disponíveis'));
  };

  // ---------------------------------------------------------------- tela 3: dia e horário
  function itensReq() { return st.sel.map(function (x) { return { servicoId: x.servicoId, profissionalId: x.profId || null }; }); }

  function diaAtendido(data) {
    var dow = Core.diaSemana(data);
    return st.sel.every(function (x) {
      var s = st.cfg.servicos.find(function (y) { return y.id === x.servicoId; });
      var ids = x.profId ? [x.profId] : s.profissionais;
      return ids.some(function (id) { var p = st.cfg.profissionais.find(function (q) { return q.id === id; }); return p && p.dias.indexOf(dow) >= 0; });
    });
  }

  function carregarSlots() {
    st.opcoes = null; st.opcaoSel = null;
    render();
    chamar({ action: 'slots', data: st.data, itens: itensReq() }).then(function (r) {
      if (!r.ok) { setAviso('erro', r.mensagem); st.opcoes = []; }
      else st.opcoes = r.data.opcoes;
      if (st.tela === 'horario') render();
    });
  }

  TELAS.horario = function () {
    var p = st.cfg.prestador, hoje = hojeSP(), lim = Core.somarDias(hoje, p.diasMax);
    if (!st.mes) { var hp = hoje.split('-').map(Number); st.mes = { a: hp[0], m: hp[1] }; }
    var a = st.mes.a, m = st.mes.m;
    var primeiro = a + '-' + pad(m) + '-01';
    var nDias = new Date(a, m, 0).getDate();
    var mesHoje = hoje.slice(0, 7), mesLim = lim.slice(0, 7), mesAtual = a + '-' + pad(m);
    function mover(d) { var x = new Date(a, m - 1 + d, 1); st.mes = { a: x.getFullYear(), m: x.getMonth() + 1 }; render(); }

    var grade = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(function (d) { return h('div', { class: 'sem' }, d); });
    for (var v = 0; v < Core.diaSemana(primeiro); v++) grade.push(h('span'));
    var _loop = function (d) {
      var data = a + '-' + pad(m) + '-' + pad(d);
      var off = data < hoje || data > lim || !diaAtendido(data);
      grade.push(h('button', { class: (st.data === data ? 'sel ' : '') + (data === hoje ? 'hoje' : ''), disabled: off, 'aria-label': dataLonga(data), 'aria-pressed': st.data === data ? 'true' : 'false',
        onclick: function () { st.data = data; setAviso(); carregarSlots(); } }, d));
    };
    for (var d = 1; d <= nDias; d++) _loop(d);

    var horas = null;
    if (st.data) {
      var corpo;
      if (st.opcoes === null) corpo = h('p', { class: 'vazio' }, 'Carregando horários…');
      else if (!st.opcoes.length) corpo = h('p', { class: 'vazio' }, 'Não há horários neste dia para essa combinação. Tente outro dia.');
      else corpo = h('div', { class: 'horas' }, st.opcoes.map(function (o, i) {
        return h('button', { class: st.opcaoSel === i ? 'sel' : '', 'aria-pressed': st.opcaoSel === i ? 'true' : 'false', onclick: function () { st.opcaoSel = i; render(); } }, o.ini);
      }));
      horas = h('div', {}, h('h2', {}, 'Horários disponíveis (' + dataLonga(st.data).toLowerCase().replace('-feira', '') + ')'), corpo);
    }

    var seq = null;
    if (st.opcaoSel !== null && st.opcoes && st.opcoes[st.opcaoSel]) {
      var o = st.opcoes[st.opcaoSel];
      seq = h('div', { class: 'resumo' }, h('div', { class: 'pequeno' }, 'Sequência a partir das ' + o.ini),
        o.itens.map(function (i) { return h('div', { class: 'item-ag' }, h('div', {}, i.ini + ' – ' + i.fim + '  ' + i.servicoNome), h('div', { class: 'p' }, 'Profissional: ' + i.profissionalNome)); }),
        h('div', { class: 'pequeno' }, 'Horários previstos (duração média)'));
    }
    var cont = h('button', { class: 'btn', disabled: st.opcaoSel === null, onclick: function () { reservar(cont); } }, 'Confirmar agendamento');

    return h('div', {},
      h('h1', {}, 'Escolha o dia e o horário'), passos(2), avisoEl(),
      h('div', { class: 'cal-topo' },
        h('button', { 'aria-label': 'Mês anterior', disabled: mesAtual <= mesHoje, onclick: function () { mover(-1); } }, '‹'),
        h('b', {}, MESES[m - 1] + ' ' + a),
        h('button', { 'aria-label': 'Próximo mês', disabled: mesAtual >= mesLim, onclick: function () { mover(1); } }, '›')),
      h('div', { class: 'cal' }, grade), horas, seq, cont,
      h('button', { class: 'btn sec', onclick: function () { ir('servicos'); } }, 'Voltar'));
  };

  function reservar(btn) {
    btn.disabled = true;
    var o = st.opcoes[st.opcaoSel];
    chamar({ action: 'reservar', data: st.data, itens: o.itens.map(function (i) { return { servicoId: i.servicoId, profissionalId: i.profissionalId, ini: i.ini }; }) }).then(function (r) {
      if (r.ok) { st.reserva = r.data; st.sel = []; st.data = null; st.opcoes = null; st.opcaoSel = null; st.minhas = null; setAviso(); ir('confirmacao'); return; }
      if (st.tela !== 'horario') return;
      setAviso('erro', r.mensagem);
      if (['horario_indisponivel', 'cliente_ocupado', 'sequencia_invalida', 'antecedencia_insuficiente'].indexOf(r.erro) >= 0) carregarSlots();
      else render();
    });
  }

  // ---------------------------------------------------------------- tela 4: confirmação
  function enc(s) { return encodeURIComponent(s); }
  function resumoTexto(r) {
    return r.itens.map(function (i) { return i.ini + ' – ' + i.fim + '  ' + i.servicoNome + ' (Profissional: ' + i.profissionalNome + ')'; }).join('\n');
  }
  function linkGoogleAgenda(r) {
    var d = r.data.replace(/-/g, ''), t = function (x) { return x.replace(':', '') + '00'; };
    var titulo = r.prestador + ' — ' + r.itens.map(function (i) { return i.servicoNome; }).join(' + ');
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + enc(titulo) +
      '&dates=' + d + 'T' + t(r.itens[0].ini) + '/' + d + 'T' + t(r.itens[r.itens.length - 1].fim) +
      '&details=' + enc('Protocolo ' + r.protocolo + '\n' + resumoTexto(r)) + '&ctz=America%2FSao_Paulo';
  }
  TELAS.confirmacao = function () {
    var r = st.reserva;
    if (!r) return h('div', {}, h('p', { class: 'vazio' }, 'Nenhum agendamento recente.'));
    var meuZap = st.cliente && st.cliente.telefone ? String(st.cliente.telefone).replace(/\D/g, '') : '';
    var zap = 'https://wa.me/' + meuZap + '?text=' + enc('Agendamento confirmado — ' + r.prestador + '\nProtocolo: ' + r.protocolo + '\n' + dataLonga(r.data) + '\n' + resumoTexto(r));
    return h('div', {},
      h('h1', { class: 'centro' }, 'Agendamento confirmado!'), passos(3),
      h('div', { class: 'ok-icone', 'aria-hidden': 'true' }, '✓'),
      h('div', { class: 'protocolo' }, h('small', {}, 'PROTOCOLO'), h('code', {}, r.protocolo)),
      h('div', { class: 'card' }, h('b', {}, dataLonga(r.data)),
        r.itens.map(function (i) { return h('div', { class: 'item-ag' }, h('div', {}, i.ini + ' – ' + i.fim + '  ' + i.servicoNome), h('div', { class: 'p' }, 'Profissional: ' + i.profissionalNome)); }),
        h('div', { class: 'pequeno', style: 'margin-top:.4rem' }, 'Horários previstos (duração média)')),
      blocoLembretes(true),
      h('a', { class: 'btn', href: linkGoogleAgenda(r), target: '_blank', rel: 'noopener' }, 'Adicionar ao Google Agenda'),
      h('a', { class: 'btn sec', href: zap, target: '_blank', rel: 'noopener' }, 'Enviar protocolo para meu WhatsApp'),
      h('div', { class: 'centro' }, h('button', { class: 'link', onclick: function () { st.minhas = null; ir('meus'); } }, 'Remarcar ou cancelar')),
      h('p', { class: 'pequeno centro' }, 'Você também recebe o protocolo por mensagem.'));
  };

  // ---------------------------------------------------------------- meus agendamentos
  function carregarMinhas() {
    chamar({ action: 'minhasReservas' }).then(function (r) {
      if (!r.ok) { setAviso('erro', r.mensagem); st.minhas = { proximas: [], anteriores: [] }; }
      else st.minhas = r.data;
      if (st.tela === 'meus') render();
    });
  }
  function cartaoReserva(r, podeCancelar) {
    var confirmando = st.confirmaCancelar === r.protocolo;
    return h('div', { class: 'card reserva' },
      h('div', { class: 'topo-r' }, h('b', {}, dataLonga(r.data)), r.status !== 'agendado' ? h('span', { class: 'badge ' + r.status }, r.status) : null),
      h('div', { class: 'pequeno' }, 'Protocolo ' + r.protocolo),
      r.itens.map(function (i) { return h('div', { class: 'item-ag' }, h('div', {}, i.ini + ' – ' + i.fim + '  ' + i.servicoNome), h('div', { class: 'p' }, 'Profissional: ' + i.profissionalNome)); }),
      podeCancelar ? h('div', { class: 'acoes' },
        confirmando
          ? [h('span', { class: 'pequeno' }, 'Cancelar este agendamento?'),
            h('button', { class: 'btn mini perigo', onclick: function () { cancelar(r.protocolo); } }, 'Sim, cancelar'),
            h('button', { class: 'btn mini sec', onclick: function () { st.confirmaCancelar = null; render(); } }, 'Não')]
          : h('button', { class: 'btn mini perigo', onclick: function () { st.confirmaCancelar = r.protocolo; render(); } }, 'Cancelar agendamento')) : null);
  }
  function cancelar(protocolo) {
    chamar({ action: 'cancelarReserva', protocolo: protocolo }).then(function (r) {
      st.confirmaCancelar = null;
      setAviso(r.ok ? 'ok' : 'erro', r.ok ? 'Agendamento cancelado.' : r.mensagem);
      carregarMinhas();
    });
  }
  TELAS.meus = function () {
    if (!st.minhas) { carregarMinhas(); return h('div', {}, h('h1', {}, 'Meus agendamentos'), avisoEl(), h('p', { class: 'vazio' }, 'Carregando…')); }
    var m = st.minhas;
    return h('div', {},
      h('h1', {}, 'Meus agendamentos'), avisoEl(),
      m.proximas.length ? m.proximas.map(function (r) { return cartaoReserva(r, true); }) : h('p', { class: 'vazio' }, 'Você não tem agendamentos futuros.'),
      h('button', { class: 'btn', onclick: function () { setAviso(); ir('servicos'); } }, 'Novo agendamento'),
      m.anteriores.length ? h('h2', {}, 'Anteriores') : null,
      m.anteriores.map(function (r) { return cartaoReserva(r, false); }));
  };

  // ---------------------------------------------------------------- perfil
  function instalarApp() {
    if (!st.instalar) return;
    st.instalar.prompt();
    st.instalar.userChoice.then(function () { st.instalar = null; render(); });
  }
  // ofertas e datas especiais: opcional, com aceite próprio, editável e removível a qualquer momento
  var ROTULO_DATAS = { aniversario: 'Meu aniversário', maes: 'Dia das Mães', pais: 'Dia dos Pais', natal: 'Natal' };
  function carregarOfertas() {
    chamar({ action: 'minhasOfertas' }).then(function (r) {
      if (!r.ok) return;
      var d = r.data;
      st.ofertas = { aceito: d.aceito, dia: d.aniv ? d.aniv.slice(3) : '', mes: d.aniv ? d.aniv.slice(0, 2) : '', datas: d.datas.slice(), aceite: d.aceito, msg: null };
      if (st.tela === 'perfil') render();
    });
  }
  function salvarOfertas() {
    var o = st.ofertas;
    var aniv = o.dia && o.mes ? o.mes + '-' + o.dia : '';
    chamar({ action: 'ofertasSalvar', aniv: aniv, datas: o.datas, aceite: o.aceite === true }).then(function (r) {
      o.msg = r.ok ? { tipo: 'ok', texto: 'Preferências salvas.' } : { tipo: 'erro', texto: r.mensagem };
      if (r.ok) { o.aceito = true; atualizarPromocao(); }
      render();
    });
  }
  function removerOfertas() {
    chamar({ action: 'ofertasRemover' }).then(function (r) {
      st.ofertas = { aceito: false, dia: '', mes: '', datas: [], aceite: false, msg: r.ok ? { tipo: 'ok', texto: 'Seus dados de ofertas foram removidos.' } : { tipo: 'erro', texto: r.mensagem } };
      if (r.ok) atualizarPromocao();
      render();
    });
  }
  function blocoOfertas() {
    var o = st.ofertas;
    if (!o) { carregarOfertas(); return null; }
    var nome = st.cfg.prestador.nome;
    var dias = []; for (var d = 1; d <= 31; d++) dias.push(('0' + d).slice(-2));
    var meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var marcar = function (k) { return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: o.datas.indexOf(k) >= 0, onchange: function (e) {
      var i = o.datas.indexOf(k); if (e.target.checked && i < 0) o.datas.push(k); if (!e.target.checked && i >= 0) o.datas.splice(i, 1); render(); } }), ROTULO_DATAS[k]); };
    return h('div', { class: 'card ofertas' },
      h('b', {}, 'Ofertas em datas especiais (opcional)'),
      h('p', { class: 'pequeno' }, 'Se quiser, conte em quais datas deseja receber descontos e ofertas de ' + nome + '. Você usa o app normalmente sem preencher isto.'),
      o.msg ? h('div', { class: 'msg ' + o.msg.tipo, role: 'status' }, o.msg.texto) : null,
      h('div', { class: 'grupo-chk', role: 'group', 'aria-label': 'Datas para receber ofertas' }, ['aniversario', 'maes', 'pais', 'natal'].map(marcar)),
      o.datas.indexOf('aniversario') >= 0 ? h('div', { class: 'aniv' },
        h('label', { for: 'aniv-dia' }, 'Dia e mês do aniversário (o ano não é necessário)'),
        h('div', { class: 'linha' },
          h('select', { id: 'aniv-dia', 'aria-label': 'Dia', onchange: function (e) { o.dia = e.target.value; } }, [h('option', { value: '' }, 'Dia')].concat(dias.map(function (x) { return h('option', { value: x, selected: o.dia === x }, String(Number(x))); }))),
          h('select', { 'aria-label': 'Mês', onchange: function (e) { o.mes = e.target.value; } }, [h('option', { value: '' }, 'Mês')].concat(meses.map(function (m, i) { var v = ('0' + (i + 1)).slice(-2); return h('option', { value: v, selected: o.mes === v }, m); }))))) : null,
      h('label', { class: 'chk aceite-ofertas' }, h('input', { type: 'checkbox', checked: o.aceite === true, onchange: function (e) { o.aceite = e.target.checked; render(); } }),
        'Autorizo ' + nome + ' a usar essas informações apenas para me oferecer descontos e ofertas nessas datas. Posso alterar ou remover a qualquer momento.'),
      h('button', { class: 'btn', disabled: !(o.aceite === true && o.datas.length), onclick: salvarOfertas }, o.aceito ? 'Atualizar preferências' : 'Salvar preferências'),
      o.aceito ? h('button', { class: 'btn sec', onclick: function () { Dialogo.confirmar('Remover seus dados de ofertas?', 'Remover', true).then(function (ok) { if (ok) removerOfertas(); }); } }, 'Remover meus dados de ofertas') : null);
  }

  TELAS.perfil = function () {
    return h('div', {},
      h('h1', {}, 'Meu perfil'),
      h('div', { class: 'card' }, h('b', {}, st.cliente.nome), h('div', { class: 'pequeno' }, telFmt(st.cliente.telefone))),
      blocoOfertas(),
      blocoLembretes(false),
      h('div', { class: 'card' }, h('b', {}, 'Cor do app'), h('div', { class: 'pequeno' }, 'Vale só neste aparelho.'), Tema.seletor(st.cfg.prestador.cor || '#2b2f36')),
      st.instalar ? h('button', { class: 'btn', onclick: instalarApp }, 'Instalar o app no celular') : null,
      h('a', { class: 'btn sec', href: base + 'politica.html', target: '_blank', rel: 'noopener' }, 'Política de Privacidade'),
      h('a', { class: 'btn sec', href: base + 'termos.html', target: '_blank', rel: 'noopener' }, 'Termos de Uso'),
      h('button', { class: 'btn sec', onclick: function () { limparSessao(); st.sel = []; st.minhas = null; st.ofertas = null; setAviso(); ir('acesso'); } }, 'Sair'),
      Api.demo ? h('button', { class: 'btn perigo', onclick: function () { Api.reiniciarDemo(); limparSessao(); st.sel = []; st.minhas = null; st.form = { nome: '', telefone: '', aceite: false, codigo: '' }; ir('acesso'); } }, 'Reiniciar demonstração') : null);
  };

  // ---------------------------------------------------------------- inicialização
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); st.instalar = e; if (st.cfg && st.tela === 'servicos') render(); });

  // contagem anônima (sem dados do cliente): instalação do app e, no máximo uma vez por dia, abertura como app instalado
  function medirInstalacao() {
    function enviar(tipo) { try { Api.chamar({ action: 'instalacao', slug: slug, tipo: tipo }); } catch (e) { /* ignore */ } }
    window.addEventListener('appinstalled', function () { enviar('instalou'); });
    var instalado = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!instalado) return;
    try {
      var hoje = new Date().toISOString().slice(0, 10), k = 'agenda_app_aberto_' + slug;
      if (localStorage.getItem(k) === hoje) return;
      localStorage.setItem(k, hoje);
    } catch (e) { /* sem storage: conta a abertura mesmo assim */ }
    enviar('abriu');
  }
  function iniciar() {
    Api.chamar({ action: 'config', slug: slug }).then(function (r) {
      if (!r.ok) {
        raiz.replaceChildren(h('main', {}, h('h1', {}, 'Ops!'), h('div', { class: 'msg erro' }, r.mensagem || 'Não foi possível carregar o aplicativo.'),
          h('button', { class: 'btn', onclick: function () { location.reload(); } }, 'Tentar novamente')));
        return;
      }
      st.cfg = r.data;
      var cor = r.data.prestador.cor || '#2b2f36';
      Tema.aplicar(cor);
      document.title = r.data.prestador.nome + ' — Agendamento';
      medirInstalacao();
      var s = lerSessao();
      if (s && s.token) { st.token = s.token; st.cliente = s.cliente; renovarPush(); }
      var abrir = function (pm) {
        var destino = st.token ? 'servicos' : 'acesso';
        st.cfg.promocao = pm;
        if (pm) { st.promo = pm; st.depoisPromo = destino; ir('promo'); } else ir(destino);
      };
      // com sessão, a promoção pode ser personalizada (aniversário, datas escolhidas); sem ela, vale a geral
      if (st.token) chamar({ action: 'minhaPromocao' }).then(function (r2) { abrir(r2.ok ? r2.data.promocao : r.data.promocao); });
      else abrir(r.data.promocao);
    });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register(base + 'sw.js').catch(function () { /* ignore */ });
  }
  iniciar();
})();
