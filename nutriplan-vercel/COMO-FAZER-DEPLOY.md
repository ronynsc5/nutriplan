# 🚀 Como colocar o NutriPlan no ar com pagamento real

## O que você vai precisar
- Conta gratuita no GitHub (github.com)
- Conta gratuita na Vercel (vercel.com)
- Conta no Mercado Pago com acesso à API

---

## PASSO 1 — Pegar suas chaves do Mercado Pago

1. Acesse: https://www.mercadopago.com.br/developers/panel/app
2. Clique em "Criar aplicação" → dê um nome (ex: NutriPlan)
3. Vá em **Credenciais de produção**
4. Copie o **Access Token** (começa com `APP_USR-...`)
   ⚠️ NUNCA coloque esse token no HTML — só vai no Vercel

5. Ainda no painel MP, vá em **Webhooks** → **Adicionar webhook**
   - URL: `https://SEU-SITE.vercel.app/api/webhook-mp`
   - Eventos: marque **Pagamentos**
   - Salve

---

## PASSO 2 — Subir o projeto no GitHub

1. Acesse github.com e faça login
2. Clique em **New repository** (botão verde)
3. Nome: `nutriplan` → clique em **Create repository**
4. Na próxima tela, clique em **uploading an existing file**
5. Arraste TODA a pasta `nutriplan-vercel` com os arquivos:
   ```
   nutriplan-vercel/
   ├── vercel.json
   ├── api/
   │   ├── criar-pix.js
   │   ├── verificar-pix.js
   │   └── webhook-mp.js
   └── public/
       └── index.html
   ```
6. Clique em **Commit changes**

---

## PASSO 3 — Conectar na Vercel

1. Acesse vercel.com e faça login com sua conta GitHub
2. Clique em **Add New → Project**
3. Escolha o repositório `nutriplan` que você criou
4. Clique em **Deploy** (não precisa mudar nada)

---

## PASSO 4 — Adicionar o Access Token na Vercel (IMPORTANTE)

Após o deploy:

1. No painel da Vercel, clique no seu projeto
2. Vá em **Settings → Environment Variables**
3. Clique em **Add Variable** e preencha:
   - **Name:** `MP_ACCESS_TOKEN`
   - **Value:** cole seu Access Token do Mercado Pago
   - Marque os três ambientes: Production, Preview, Development
4. Clique em **Save**
5. Vá em **Deployments** → clique nos 3 pontinhos do último deploy → **Redeploy**

✅ Pronto! Seu site estará em `https://nutriplan.vercel.app` (ou similar)

---

## PASSO 5 — Atualizar a URL do webhook no Mercado Pago

Agora que você tem a URL real do seu site:

1. Volte no painel do Mercado Pago → Webhooks
2. Edite o webhook que criou
3. Atualize a URL para: `https://SEU-SITE-REAL.vercel.app/api/webhook-mp`
4. Salve

---

## Como funciona o pagamento após o deploy

```
Usuário clica "Pagar com Pix"
        ↓
Frontend chama /api/criar-pix (seu servidor Vercel)
        ↓
Servidor chama Mercado Pago com o Access Token (seguro)
        ↓
Mercado Pago cria o Pix e retorna QR Code
        ↓
Usuário vê o QR Code e paga no banco
        ↓
Mercado Pago avisa /api/webhook-mp que foi pago
        ↓
Frontend fica verificando /api/verificar-pix a cada 4s
        ↓
Quando aprovado: crédito liberado automaticamente ✅
```

---

## Testando antes de ir a produção

O Mercado Pago tem um ambiente de testes (Sandbox):
1. No painel MP, use as **Credenciais de teste** (começam com `TEST-`)
2. Use essas credenciais na Vercel para testar
3. Quando estiver tudo certo, troque pelas credenciais de **produção**

Usuários de teste: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/your-integrations/test/accounts

---

## Atualizando o site depois

Sempre que quiser mudar algo no HTML ou nas APIs:
1. Edite os arquivos localmente
2. No GitHub, vá no arquivo → clique no lápis ✏️ → edite → commit
3. A Vercel faz o redeploy automaticamente em ~30 segundos

---

## Dúvidas comuns

**O site abre mas o Pix não gera?**
→ Verifique se o `MP_ACCESS_TOKEN` foi salvo corretamente na Vercel

**O pagamento foi feito mas o crédito não liberou?**
→ Verifique se o webhook está configurado corretamente no Mercado Pago

**Posso usar domínio próprio? (ex: nutriplan.mfctstudio.com.br)**
→ Sim! Na Vercel: Settings → Domains → Add Domain. É gratuito.

---

Criado para MFCT Estúdio — NutriPlan
