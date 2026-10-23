# Controle de Estoque — BackOffice

Painel admin (HTML/JS puro + Supabase). Rodar: sirva a pasta com qualquer servidor estático
(`npx serve .`) — o service worker exige http(s), não `file://`.

- `js/utils.js` — funções puras, com testes: `npm test`
- `js/app.js` — telas e acesso ao Supabase
- `sw.js` / `manifest.json` — PWA (só o "casco" é cacheado; dados nunca)
- `supabase/001_ledger_e_consumo.sql` e `002_orcamento_cc.sql` — migrações, nessa ordem (testar em branch antes!)

Segurança: toda a proteção real está nas políticas RLS e na Edge Function `send-email`
(valide destinatário e remetente lá). A chave publishable no front é pública por desenho.
