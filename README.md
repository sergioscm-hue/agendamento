# Agendamento

Aplicativo instalável (PWA) de agendamento de serviços com vários prestadores e profissionais.

- App do cliente: `p/<prestador>/` (demonstração em `p/demo/`)
- Painel do prestador: `painel/?p=<prestador>`
- Regras de negócio: `core.js` (compartilhado com o backend em Google Apps Script)

Enquanto `config-global.js` estiver sem URL de API, o app roda em modo demonstração (dados apenas no navegador).
