# OBD Backend — Mecânico Pessoal

Backend que recebe dados de um scanner OBD2 (via app mobile) e usa a API da Anthropic
para interpretar códigos de erro (DTC) em linguagem simples.

## Rodando localmente

```bash
npm install
cp .env.example .env   # depois edite e coloque sua ANTHROPIC_API_KEY
npm start
```

Teste rápido:

```bash
curl -X POST http://localhost:3000/simulate
```

## Endpoints

| Método | Rota         | Descrição                                       |
|--------|--------------|--------------------------------------------------|
| POST   | /obd-data    | Recebe dados reais do scanner (codes, rpm, etc.) |
| POST   | /simulate    | Roda com dados fictícios, sem hardware           |
| GET    | /ultimo      | Retorna o último diagnóstico salvo               |

## Deploy no GitHub

```bash
git init
git add .
git commit -m "Primeiro commit - backend OBD"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/obd-backend.git
git push -u origin main
```

> Confira que o `.env` NÃO subiu (o `.gitignore` já cuida disso).

## Deploy no Render

1. Acesse https://render.com e crie uma conta (dá pra logar com GitHub)
2. **New +** → **Web Service**
3. Conecte o repositório `obd-backend` que você acabou de subir
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Em **Environment Variables**, adicione:
   - `ANTHROPIC_API_KEY` = sua chave da Anthropic
6. Clique em **Create Web Service**

O Render vai te dar uma URL pública, tipo:
`https://obd-backend-xxxx.onrender.com`

Essa URL é o que o app React Native vai chamar depois, no lugar de `localhost:3000`.

## Deploy no Railway (alternativa)

1. Acesse https://railway.app e conecte com GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Selecione o repositório
4. Em **Variables**, adicione `ANTHROPIC_API_KEY`
5. Railway detecta o `npm start` automaticamente

## Configurando o bot do Telegram

1. No `.env` (ou nas variáveis de ambiente do Render), preencha:
   - `TELEGRAM_BOT_TOKEN` — token que o @BotFather te deu
   - `TELEGRAM_WEBHOOK_URL` — a URL pública do backend (ex: `https://obd-backend-xxxx.onrender.com`), **sem barra no final**
2. Suba/reinicie o servidor. Nos logs deve aparecer:
   ```
   Webhook do Telegram configurado em: https://.../telegram/webhook
   ```
3. No Telegram, mande `/start` pro seu bot. Ele salva seu `chat_id` automaticamente e confirma a conexão.
4. A partir daí:
   - `/ultimo` → mostra o último diagnóstico
   - Qualquer outra mensagem → vai direto pra IA responder
   - Quando `/obd-data` ou `/simulate` gerar urgência **média ou alta**, o bot te avisa sozinho

> ⚠️ O `chat_id` fica salvo em memória — se o servidor reiniciar (comum no plano free do Render), você precisa mandar `/start` de novo. Isso entra na lista de "próximos passos" abaixo, pra resolver com banco de dados.

## Próximos passos

- [ ] Trocar armazenamento em memória por banco real (ex: SQLite, MongoDB Atlas free tier)
- [ ] Adicionar autenticação simples no endpoint `/obd-data` (token fixo, pelo menos)
- [ ] Construir o app React Native que lê o scanner Bluetooth e chama esse backend
