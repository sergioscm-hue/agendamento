/* api.js — camada de comunicação, compartilhada pelo app do cliente e pelo painel.
 * - Com AGENDA_API_URL preenchida: envia as chamadas ao Apps Script (backend real).
 * - Vazia (ou ?demo=1 na URL): usa o mesmo núcleo (core.js) no próprio navegador, com dados no localStorage.
 */
(function () {
  'use strict';
  var url = window.AGENDA_API_URL || '';
  var demo = !url || /[?&]demo=1\b/.test(location.search);
  var CHAVE = 'agenda_demo_v3';
  var store = null, ctx = null;

  function iniciarDemo() {
    ctx = Core.criarCtxDemo();
    var dados = null;
    try { dados = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) { dados = null; }
    if (!dados || !dados.Prestadores || !dados.Prestadores.length) dados = Core.semear(ctx);
    var persistir = function (t) { try { localStorage.setItem(CHAVE, JSON.stringify(t)); } catch (e) { /* quota */ } };
    store = Core.criarMemStore(dados, persistir);
    persistir(store.dados);
    ctx.enviarMensagem = function (tel, texto, canal) {
      store.insert('Mensagens', { quando: '', telefone: tel, canal: canal, texto: texto, status: 'simulado' });
    };
  }
  if (demo) iniciarDemo();

  function chamar(req) {
    if (demo) {
      return new Promise(function (resolve) { setTimeout(function () { resolve(Core.handle(req, store, ctx)); }, 120); });
    }
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, erro: 'rede', mensagem: 'Sem conexão. Verifique a internet e tente novamente.' }; });
  }

  function reiniciarDemo() {
    if (!demo) return;
    try { localStorage.removeItem(CHAVE); } catch (e) { /* ignore */ }
    iniciarDemo();
  }

  // caixa de confirmação do próprio app (o confirm() do navegador exibe o endereço do site antes da mensagem)
  function confirmar(texto, rotuloOk, perigo) {
    return new Promise(function (resolve) {
      var anterior = document.activeElement;
      var fundo = document.createElement('div'); fundo.className = 'dialogo-fundo';
      var caixa = document.createElement('div'); caixa.className = 'dialogo'; caixa.setAttribute('role', 'alertdialog'); caixa.setAttribute('aria-modal', 'true');
      var msg = document.createElement('p'); msg.className = 'dialogo-texto'; msg.textContent = texto; msg.id = 'dialogo-texto'; caixa.setAttribute('aria-labelledby', 'dialogo-texto');
      var linha = document.createElement('div'); linha.className = 'dialogo-acoes';
      var cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.className = 'btn sec'; cancelar.textContent = 'Cancelar';
      var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn' + (perigo ? ' perigo' : ''); ok.textContent = rotuloOk || 'OK';
      function fim(v) { document.removeEventListener('keydown', tecla, true); fundo.remove(); if (anterior && anterior.focus) try { anterior.focus(); } catch (e) { /* ignore */ } resolve(v); }
      function tecla(e) {
        if (e.key === 'Escape') { e.preventDefault(); fim(false); }
        else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancelar : ok).focus(); }
      }
      cancelar.onclick = function () { fim(false); }; ok.onclick = function () { fim(true); };
      fundo.onclick = function (e) { if (e.target === fundo) fim(false); };
      document.addEventListener('keydown', tecla, true);
      linha.appendChild(cancelar); linha.appendChild(ok); caixa.appendChild(msg); caixa.appendChild(linha); fundo.appendChild(caixa); document.body.appendChild(fundo);
      cancelar.focus();
    });
  }
  window.Dialogo = { confirmar: confirmar };

  // cor de destaque escolhida por quem usa (por aparelho, sem gravar nada no servidor); fundos e cards continuam brancos
  var CORES = [
    { id: 'padrao', nome: 'Padrão' },
    { id: 'azul', nome: 'Azul', cor: '#1565c0', texto: '#fff' },
    { id: 'vermelho', nome: 'Vermelho', cor: '#c62828', texto: '#fff' },
    { id: 'rosa', nome: 'Rosa', cor: '#ad1457', texto: '#fff' },
    { id: 'roxo', nome: 'Roxo', cor: '#6a1b9a', texto: '#fff' },
    { id: 'verde', nome: 'Verde', cor: '#2e7d32', texto: '#fff' },
    { id: 'laranja', nome: 'Laranja', cor: '#f57c00', texto: '#1b1d21', tinta: '#b45309' },
    { id: 'grena', nome: 'Grená', cor: '#7b1e3a', texto: '#fff' }
  ];
  var CHAVE_TEMA = 'agenda_tema';
  function temaSalvo() { try { return localStorage.getItem(CHAVE_TEMA) || 'padrao'; } catch (e) { return 'padrao'; } }
  function corDoTema(id, padrao) { var c = CORES.filter(function (x) { return x.id === id; })[0]; return c && c.cor ? c : null; }
  function luminosa(hex) { var n = parseInt(String(hex).slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160; }
  // aplica a cor escolhida; sem escolha, usa a cor padrão do estabelecimento
  function aplicarTema(padrao) {
    var c = corDoTema(temaSalvo()), cor = c ? c.cor : (padrao || '#2b2f36'), texto = c ? c.texto : (luminosa(cor) ? '#1b1d21' : '#fff');
    document.documentElement.style.setProperty('--accent', cor);
    document.documentElement.style.setProperty('--on-accent', texto);
    document.documentElement.style.setProperty('--accent-ink', c && c.tinta ? c.tinta : cor);   // texto sobre fundo branco precisa de contraste
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', cor);
  }
  function seletorTema(padrao, aoMudar) {
    var raiz = document.createElement('div'); raiz.className = 'tema-cores'; raiz.setAttribute('role', 'radiogroup'); raiz.setAttribute('aria-label', 'Cor do aplicativo');
    function desenhar() {
      raiz.replaceChildren();
      var atual = temaSalvo();
      CORES.forEach(function (c) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'tema-cor' + (c.id === atual ? ' on' : '');
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', c.id === atual ? 'true' : 'false'); b.setAttribute('aria-label', c.nome);
        var bola = document.createElement('span'); bola.className = 'tema-bola'; bola.style.background = c.cor || padrao || '#2b2f36'; bola.textContent = c.id === atual ? '✓' : '';
        bola.style.color = c.texto || (luminosa(padrao || '#2b2f36') ? '#1b1d21' : '#fff');
        var nome = document.createElement('span'); nome.className = 'tema-nome'; nome.textContent = c.nome;
        b.appendChild(bola); b.appendChild(nome);
        b.onclick = function () { try { localStorage.setItem(CHAVE_TEMA, c.id); } catch (e) { /* ignore */ } aplicarTema(padrao); desenhar(); if (aoMudar) aoMudar(); };
        raiz.appendChild(b);
      });
    }
    desenhar();
    return raiz;
  }
  window.Tema = { aplicar: aplicarTema, seletor: seletorTema };

  window.Api = { demo: demo, chamar: chamar, reiniciarDemo: reiniciarDemo };
})();
