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

  window.Api = { demo: demo, chamar: chamar, reiniciarDemo: reiniciarDemo };
})();
