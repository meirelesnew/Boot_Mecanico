# Mecânico Pessoal — backend

Backend do sistema que lê o carro por um adaptador **ELM327 (Bluetooth)**, avisa no **Telegram** e controla os gastos com combustível.

```
ELM327 → app (MIT App Inventor) → este backend (Render) → bot do Telegram
                                        ↓
                                  Supabase (banco)
```

## O que ele faz

- Decodifica códigos de falha (`P0130`…) e explica em português (tabela local, grátis)
- Recebe dados ao vivo (RPM, temperatura, velocidade) e alerta se o motor passar de 105 °C
- Guarda o perfil do carro, o último diagnóstico e os abastecimentos num banco que **não se perde** quando o servidor reinicia
- Responde perguntas livres no Telegram com IA gratuita (OpenRouter), se configurada

## Variáveis de ambiente

Veja o arquivo `.env.example`. No Render: **Environment → Add Environment Variable**.

| Variável | Para quê |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token do bot (@BotFather) |
| `TELEGRAM_WEBHOOK_URL` | Endereço público do serviço no Render |
| `TELEGRAM_CHAT_ID` | (opcional) Seu chat. Só ele é atendido |
| `OBD_TOKEN` | Senha das rotas do app (vai em `?token=`) |
| `SUPABASE_URL` | Endereço do projeto Supabase |
| `SUPABASE_SECRET_KEY` | Chave **secreta** do Supabase (`sb_secret_...`) |
| `OPENROUTER_API_KEY` | (opcional) Perguntas livres com IA |

## Banco de dados (Supabase)

1. Crie um projeto em https://supabase.com (plano gratuito)
2. **SQL Editor** → cole o conteúdo de `supabase.sql` → **Run**
3. **Project Settings → API Keys**: copie a **Project URL** e a chave **secret** (`sb_secret_...`)
4. Coloque as duas no Render como `SUPABASE_URL` e `SUPABASE_SECRET_KEY`

As tabelas usam RLS sem políticas: a chave pública não lê nada, só o servidor.
No plano gratuito o projeto é pausado após 7 dias sem uso; a rota `/health` faz um acesso leve
por hora, o que evita a pausa enquanto o UptimeRobot estiver ligado.

## Rotas

| Método | Rota | Proteção | Para quê |
|---|---|---|---|
| POST | `/obd-raw` | `?token=` | Resposta bruta do comando `03` → decodifica e avisa no Telegram |
| POST | `/obd-live` | `?token=` | RPM/temperatura/velocidade (`&formato=csv` → `rpm\|temp\|vel`) |
| POST | `/obd-data` | `?token=` | Dados já decodificados (JSON) |
| POST | `/simulate` | `?token=` | Simula uma leitura, sem carro |
| GET | `/ultimo` | `?token=` | Último diagnóstico |
| GET | `/health` | aberta | Manter o Render acordado (UptimeRobot) |
| POST | `/telegram/webhook` | segredo do Telegram | Mensagens do bot |

## Comandos do Telegram

`/ajuda` mostra a lista no próprio bot.

| Comando | O que faz |
|---|---|
| `/km 281900` | Atualiza a quilometragem |
| `/gnv` · `/gnv off` | Marca/desmarca GNV no perfil |
| `/obs texto` | Guarda uma observação |
| `/perfil` | Mostra o que está salvo |
| `/ultimo` | Último diagnóstico (data da leitura, KM atual) |
| `/vivo` | Última leitura de RPM, temperatura e velocidade |
| `/abastecer gasolina 32,5 6,29` | Registra abastecimento (veja abaixo) |
| `/combustivel` | Gastos do mês, custo por km, consumo |
| `/desfazer` | Apaga o último abastecimento |
| `/status` | Confere banco de dados, IA e tempo ligado |

### Controle de combustível

```
/abastecer <gasolina|etanol|gnv> <quantidade> <preço> [km281900] [parcial]
/abastecer gasolina 32,5 6,29
/abastecer gnv 12 4,89 km281900
/abastecer etanol 20 4,19 parcial
```

- Quantidade em litros (m³ no GNV). Sem `km`, usa o KM atual do perfil
- `parcial` = não encheu o tanque (esse abastecimento não entra no cálculo de consumo)
- **Custo por km:** gasto dos abastecimentos depois do primeiro ÷ km rodados no período
- **Consumo:** só entre dois abastecimentos *seguidos*, do *mesmo* combustível e com tanque cheio
- O OBD2 **não mede** o gasto de GNV (a central só conhece a injeção original), por isso o controle é feito pelos abastecimentos registrados

## Segurança

- Rotas do app exigem `?token=` (`OBD_TOKEN`); sem a variável, o servidor avisa nos logs
- O webhook do Telegram só aceita chamadas com o segredo que o próprio Telegram devolve
- O bot só atende **um chat** (o dono). Mensagens de outros chats são ignoradas
- O repositório é público: **nunca** escreva senhas, tokens ou chaves em arquivos

## Deploy

1. GitHub: suba os arquivos do projeto (a pasta `node_modules` e o `.env` ficam de fora, o `.gitignore` já cuida)
2. Render: Web Service → Build `npm install` → Start `npm start` → variáveis acima
3. UptimeRobot: monitor HTTP em `https://SEU-APP.onrender.com/health`, a cada 5 minutos

## Testes

Os testes de integração usaram Supabase e Telegram simulados. Cobrem segurança do webhook, trava de dono,
comandos, combustível, persistência após reinício, banco fora do ar e modo sem banco.

## Próximos passos

- [ ] App abrir sozinho: conectar ao ELM327 salvo e iniciar a leitura ao vivo
- [ ] Temperatura em vermelho acima de 100 °C
- [ ] Histórico de leituras e gráficos
- [ ] Gerar o APK do app
