# Sistema de Agendamento — Fase 1 (MVP)

Aplicativo instalável (PWA) para agendamento de serviços com vários prestadores, vários profissionais por prestador,
serviços encadeados com folga, protocolo e painel do prestador.

**Arquitetura:** app no GitHub Pages (`web/`) → API em Google Apps Script (`apps-script/`) → Planilha Google (dados).
Toda a regra de negócio está em **um só arquivo**, `web/core.js`, que roda no backend, na demonstração e nos testes.

## O que a Fase 1 já faz

- Cadastro único do cliente (nome + telefone + aceite da LGPD) e login automático nos acessos seguintes.
- Escolha de serviços (tempos médios "aprox."), profissional por serviço ou "sem preferência".
- Cálculo dos horários para a **sequência** de serviços, com **folga** configurável entre eles, preparo entre atendimentos,
  almoço/intervalos, bloqueios e antecedência mínima.
- Reserva sem conflito (trava no servidor), protocolo `AG-AAAA-NNNNNN`, link do Google Agenda e arquivo `.ics`.
- "Meus agendamentos" com cancelamento (respeitando o prazo configurado).
- Painel do prestador: agenda do dia por profissional, marcar realizado/faltou, cancelar, bloquear horário.
- Um app por prestador (mesma matriz; muda nome, cor e logotipo), instalável no Android.
- Modo demonstração (sem backend) para testar tudo no navegador.

**Ainda não incluído (próximas fases):** envio real de WhatsApp/SMS e código de verificação do telefone,
notificações push, "Entrar com Google", painel de estatísticas do administrador, PIN por profissional.
As mensagens de confirmação ficam hoje numa fila (aba `Mensagens`), prontas para a Fase 2.

---

## Jornada de instalação (faça uma etapa de cada vez)

### Etapa A — Ver o app funcionando (modo demonstração) · ~10 min

1. Em github.com, crie um repositório **público** chamado `agendamento` (Pages gratuito exige repositório público;
   o código não contém dados nem segredos).
2. Abra a pasta `web/` deste pacote e arraste **o conteúdo** dela (`core.js`, `app.js`, `p/`, `painel/` …) para a página
   do repositório (*Add file → Upload files*) e confirme (*Commit changes*). O `index` do site não é necessário.
3. *Settings → Pages → Branch: `main` / pasta `/ (root)` → Save*. Aguarde 1–2 minutos.
4. Abra `https://SEU-USUARIO.github.io/agendamento/p/demo/` no celular. Teste o fluxo completo.
   Painel: `https://SEU-USUARIO.github.io/agendamento/painel/?p=demo` (PIN de demonstração: **1234**).
5. No Chrome do Android: menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").

Nesta etapa os dados ficam só no navegador (faixa amarela "Modo demonstração").

### Etapa B — Criar o backend (planilha + Apps Script) · ~15 min

1. Crie uma **Planilha Google nova** (de preferência na conta institucional) chamada `Agendamento`.
2. *Extensões → Apps Script*. Apague o conteúdo do arquivo padrão e cole o conteúdo de `apps-script/Code.gs`.
3. Clique em **+** (Arquivos) → *Script* → nomeie `Core` e cole o conteúdo de `apps-script/Core.gs`. Salve (Ctrl+S).
4. Volte à planilha e recarregue a página: aparece o menu **Agendamento**.
   Use **Agendamento → 1. Configurar planilha**. Na primeira vez o Google pede autorização:
   *Revisar permissões → escolha sua conta → "Avançado" → "Acessar … (não seguro)" → Permitir*
   (é o seu próprio script; o aviso aparece por ele não ser "verificado" pelo Google).
5. **Agendamento → 3. Testar a API** deve responder "OK. Prestador: Studio Exemplo…".
6. Troque o PIN de demonstração: **Agendamento → 2. Definir PIN de um prestador** (slug `demo`).
7. No Apps Script: **Implantar → Nova implantação → ⚙ Aplicativo da Web** →
   *Executar como: **Eu*** · *Quem pode acessar: **Qualquer pessoa*** → Implantar → copie a **URL** (termina em `/exec`).
   Abra essa URL no navegador: deve aparecer `{"ok":true,...}`.

### Etapa C — Conectar o app ao backend · ~3 min

1. No GitHub, abra `config-global.js` → ícone do lápis → cole a URL `/exec` entre as aspas de `AGENDA_API_URL` → *Commit*.
2. Aguarde ~1 min e abra `…/p/demo/` de novo: a faixa amarela some e os agendamentos passam a ser gravados na planilha.
3. Teste: faça um agendamento no celular e confira as abas `Reservas`, `Itens` e `Mensagens` (esta traz o texto do protocolo
   que será enviado por WhatsApp na Fase 2).

> Ao alterar o código do Apps Script depois: *Implantar → Gerenciar implantações → ✎ → Versão: Nova versão → Implantar*
> (a URL continua a mesma).

### Etapa D — Cadastrar o primeiro prestador real

Informe: **nome**, **slug** (ex.: `studio-bela`), **cor** (`#RRGGBB`), **logotipo** (opcional), **PIN**, e as listas abaixo.
Peça ao Claude para gerar a pasta do app (ou rode `python3 tools/novo-prestador.py studio-bela "Studio Bela" "#7a2e5d"`) e
envie a pasta gerada `web/p/<slug>/` ao GitHub. Na planilha preencha:

| Aba | O que preencher |
|---|---|
| **Prestadores** | `id` (ex. PR2), `slug`, `nome`, `cor`, `logo` (URL, opcional), `folga_max` (min), `passo` (30), `antecedencia_min`, `dias_max`, `cancel_antecedencia_min`, `verificacao` (`nenhuma` ou `codigo`), `ativo` (TRUE). Depois use o menu para definir o PIN. |
| **Profissionais** | `id` (ex. P4), `prestador_id`, `nome`, `ativo` |
| **Servicos** | `id` (ex. S5), `prestador_id`, `nome`, `duracao` (min, médio), `preparo` (min), `ativo` |
| **ProfServ** | quem faz o quê: `profissional_id`, `servico_id`, `duracao` (opcional: tempo próprio do profissional) |
| **Disponibilidade** | `profissional_id`, `dia_semana` (0=dom … 6=sáb), `inicio`, `fim` (ex. 09:00). Várias linhas por dia para intervalos (almoço) |
| **Bloqueios** | `profissional_id` (ou `*` para todos), `data` (AAAA-MM-DD), `inicio`, `fim`, `motivo` — também pelo painel |

Não altere a formatação das colunas de hora/data (devem ficar como **texto simples**) nem a ordem das colunas.

---

## Lembretes por notificação (opcional, Android)

O cliente ativa na tela de confirmação ou no Perfil e recebe um aviso 24 h e 2 h antes do horário. O envio usa o Firebase Cloud Messaging (gratuito).

1. Em console.firebase.google.com, crie um projeto (sem Google Analytics).
2. Configurações do projeto > Geral > Seus apps > ícone web (`</>`): registre o app e copie `apiKey`, `projectId`, `messagingSenderId` e `appId`.
3. Configurações do projeto > Cloud Messaging > Certificados push da Web > **Gerar par de chaves**: copie a chave pública (`vapidKey`).
4. Configurações do projeto > Contas de serviço > **Gerar nova chave privada**: baixe o JSON. No Apps Script, Configurações do projeto > Propriedades do script, crie `FCM_SERVICE_ACCOUNT` com o conteúdo inteiro do JSON. É um segredo: nunca o coloque no GitHub.
5. Cole os novos `Core.gs` e `Code.gs`, rode **Configurar planilha** (cria as abas `Dispositivos` e `Lembretes`) e, no menu **Agendamento > 4. Ativar lembretes por notificação**, autorize o acesso externo. Isso cria o gatilho de 15 em 15 minutos. Reimplante (Nova versão).
6. No `web/config-global.js` do GitHub, acrescente:
```js
window.AGENDA_PUSH = { apiKey: '...', projectId: '...', messagingSenderId: '...', appId: '...', vapidKey: '...' };
```
Sem esse bloco, o app não mostra nada sobre notificações.

## Parâmetros que você controla (aba Prestadores)

- `folga_max`: folga máxima (min) entre serviços encadeados — 0 = sempre em sequência imediata.
- `passo`: de quantos em quantos minutos começam os horários oferecidos (30 ou 15).
- `antecedencia_min`: antecedência mínima para agendar hoje.
- `dias_max`: até quantos dias à frente se pode agendar.
- `cancel_antecedencia_min`: prazo mínimo para o **cliente** cancelar (o prestador pode cancelar sempre).
- `verificacao`: `nenhuma` (piloto) ou `codigo` (exige código por mensagem — ativar só na Fase 2, com WhatsApp).

## Segurança e LGPD (estado atual)

- O PIN é guardado como hash (SHA-256 com segredo). Sessões usam token assinado (HMAC) com validade.
- Os dados ficam só na sua planilha; os prestadores **nunca** têm acesso a ela, apenas ao painel, que filtra por prestador no servidor.
- `politica.html` e `termos.html` são **modelos provisórios**: revise com assessoria jurídica antes de usar com clientes reais.
- Em modo `verificacao = nenhuma` qualquer pessoa pode se cadastrar com o telefone de outra. Para o piloto com clientes
  conhecidos é aceitável; para uso aberto, ative o código (Fase 2).

## Para quem for mexer no código

- Testes: `node --test tests/test-core.js tests/test-appsscript.js` (regras e backend simulado) e `python3 tests/e2e.py`
  (navegador; exige servidor em `http://localhost:8765` servindo `web/`).
- Após editar `web/core.js`: `sh tools/build.sh` e recole `apps-script/Core.gs` no Apps Script.

## Próximas fases

- **Fase 2:** WhatsApp Cloud API (protocolo, código de verificação, lembretes 24 h/2 h), notificações push (FCM/OneSignal), "Entrar com Google".
- **Fase 3:** painel de estatísticas do administrador (Looker Studio), arquivamento anual, PIN por profissional, migração opcional para Supabase.
