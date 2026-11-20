/* api.js — camada de comunicação, compartilhada pelo app do cliente e pelo painel.
 * - Com AGENDA_API_URL preenchida: envia as chamadas ao Apps Script (backend real).
 * - Vazia (ou ?demo=1 na URL): usa o mesmo núcleo (core.js) no próprio navegador, com dados no localStorage.
 */
(function () {
  'use strict';
  var url = window.AGENDA_API_URL || '';
  var demo = !url || /[?&]demo=1\b/.test(location.search);
  var CHAVE = 'agenda_demo_v1';
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

  window.Api = { demo: demo, chamar: chamar, reiniciarDemo: reiniciarDemo };
})();
