# OBD Backend — Mecânico Pessoal

Backend que recebe dados de um scanner OBD2 (via app mobile), interpreta códigos de
erro (DTC) usando uma tabela local gratuita, e opcionalmente usa a OpenRouter (modelos
gratuitos) para responder perguntas livres via Telegram.

## Rodando localmente

```bash
npm install
cp .env.example .env   # opcional: preencha OPENROUTER_API_KEY e/ou TELEGRAM_BOT_TOKEN
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
5. Em **Environment Variables**, adicione (todas opcionais, exceto se quiser Telegram/IA):
   - `OPENROUTER_API_KEY` = sua chave da OpenRouter (só se quiser perguntas livres)
   - `TELEGRAM_BOT_TOKEN` = token do seu bot
   - `TELEGRAM_WEBHOOK_URL` = a própria URL pública deste serviço no Render
6. Clique em **Create Web Service**

O Render vai te dar uma URL pública, tipo:
`https://obd-backend-xxxx.onrender.com`

Essa URL é o que o app React Native vai chamar depois, no lugar de `localhost:3000`.

## Deploy no Railway (alternativa)

1. Acesse https://railway.app e conecte com GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Selecione o repositório
4. Em **Variables**, adicione as mesmas variáveis do Render acima
5. Railway detecta o `npm start` automaticamente

## Perguntas livres com IA (OpenRouter - grátis)

O `/simulate` e `/obd-data` funcionam 100% sem IA (tabela fixa de códigos DTC). Se quiser
que o bot também responda perguntas livres no Telegram (ex: "quando devo trocar o óleo?"),
ative a OpenRouter, que tem modelos gratuitos:

1. Crie uma conta em https://openrouter.ai e gere uma chave em https://openrouter.ai/keys
2. No `.env` (ou nas variáveis do Render), preencha:
   - `OPENROUTER_API_KEY` — sua chave
   - `OPENROUTER_MODEL` — pode deixar `openrouter/free` (escolhe um modelo grátis automaticamente)
3. Reinicie o servidor

> Modelos gratuitos têm limite de uso (por volta de 20 req/min, 200 req/dia). Pra um assistente pessoal isso é de sobra.

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
   - `/km <numero>` → atualiza a quilometragem atual de verdade (ex: `/km 278860`)
   - `/gnv` → marca o carro como equipado com GNV (`/gnv off` desativa)
   - `/obs <texto>` → salva uma observação livre sobre o carro (ex: `/obs pneu dianteiro trocado em ago/2026`)
   - `/perfil` → mostra o que está salvo (GNV + observações)
   - Qualquer outra mensagem → vai direto pra IA responder
   - Quando `/obd-data` ou `/simulate` gerar urgência **média ou alta**, o bot te avisa sozinho
   - Se o carro tiver GNV marcado e aparecer um código de sensor de oxigênio (ex: P0130), o diagnóstico já inclui automaticamente o alerta de possível falso positivo

> ⚠️ O `chat_id` e o perfil do carro (GNV, observações) ficam salvos em memória — se o servidor reiniciar (comum no plano free do Render), essas informações se perdem e você precisa mandar `/start`, `/gnv` e `/obs` de novo. Isso entra na lista de "próximos passos" abaixo, pra resolver com banco de dados.

## Próximos passos

- [ ] Trocar armazenamento em memória por banco real (ex: SQLite, MongoDB Atlas free tier)
- [ ] Adicionar autenticação simples no endpoint `/obd-data` (token fixo, pelo menos)
- [ ] Construir o app React Native que lê o scanner Bluetooth e chama esse backend
