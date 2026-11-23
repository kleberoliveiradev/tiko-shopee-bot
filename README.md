# 🛒 Robô de Ofertas Shopee → Telegram e/ou WhatsApp (clona grupos de ofertas)

Busca promoções da Shopee, converte para o **link de afiliado** de quem é dono da conta e publica no grupo do Telegram — sozinho, nos horários definidos. 100% gratuito: sem API paga, sem mensalidade.

Sem dependências: só precisa do **Node.js 20+** (ou Docker).

## Duas páginas separadas

| Página | Quem usa | Para quê |
|---|---|---|
| `/` **Painel** (com senha) | Você (dono da plataforma) | Cria clientes, define nicho e canais contratados, vê atividade, logs e histórico; exclui clientes (🗑) |
| `/afiliado/<link-secreto>` **Página do cliente** | A pessoa dona da conta de afiliado | Informa AppID e Secret da Shopee, cria o robô no Telegram e conecta o grupo |

Cada cliente tem o seu link (aba **Link do afiliado**). O robô trabalha com a conta e o grupo **dele**.

## O que o cliente faz (e o que é automático)

| Etapa | Quem faz |
|---|---|
| Colar **AppID** e **Secret** da Shopee | Cliente |
| Criar o robô no Telegram | Automático (1 toque no botão "Criar meu robô") |
| Criar um grupo ou canal e adicionar o robô como administrador | Cliente (limite do Telegram, veja abaixo) |
| Detectar o grupo | Automático (a página confere sozinha) |
| Testar Shopee e Telegram | Automático |
| **Ligar o robô** | **Automático** quando AppID, Secret e grupo estão prontos (só na primeira vez; se o cliente pausar, não religa sozinho) |
| Nicho, filtros e horários | Pré-definidos; o cliente pode ajustar |

> **Limite do Telegram:** bots não podem criar grupos nem canais, só contas de pessoas. Por isso o cliente cria o grupo (10 segundos) e o robô faz o resto. Automatizar isso exigiria usar a conta pessoal do cliente (não oficial, com risco de banimento) e **não está incluído**.

## Rodando

```bash
npm start            # ou: node server.js
```
Abra http://localhost:3000. No primeiro acesso o terminal mostra um **código de configuração** para criar a senha do painel. Com Docker: `docker compose up -d --build` (dados no volume `/data`).

> O robô precisa ficar **ligado 24h**. Rode num servidor online (VPS, Railway/Render/Fly com disco persistente em `DATA_DIR`) ou num PC que fique ligado. Na internet, use HTTPS e `TRUST_PROXY=1`.

## Nichos e canais contratados
- Catálogo com 27 nichos; cada um filtra os produtos por palavras do nome. O cliente escolhe o nicho na própria página.
- Por cliente você escolhe o canal: **Telegram**, **WhatsApp** ou os dois (pelo menos um). No WhatsApp, o robô lê um grupo de ofertas e posta no grupo do próprio cliente.

## O que o robô faz a cada ciclo
1. Busca na Shopee (`productOfferV2`) alternando palavras-chave e páginas. Se a Shopee responder `10000 System Error` (instabilidade dela), tenta de novo sozinho.
2. Filtra: nicho, desconto, nota, vendas, preço, comissão, palavras bloqueadas, só com imagem.
3. Ignora o que já postou (padrão: 7 dias), no máximo 1 produto por loja por ciclo.
4. Converte cada produto com `generateShortLink` (com o SubID do cliente). **Nunca posta link que não seja de afiliado.**
5. Publica foto + legenda no modelo de post aprovado (se a foto falhar, vai só texto).

## WhatsApp: clonar um grupo de ofertas para o grupo do cliente
O cliente conecta um número de WhatsApp (chip dedicado), cola o **link de convite do grupo de ofertas** que quer clonar (origem) e o **link do seu próprio grupo** (destino). O robô entra nos dois. Cada link da Shopee que aparece na origem é trocado pelo **link de afiliado do cliente** e postado no grupo dele, com foto e formatação do WhatsApp.
- **Origem só é lida:** nunca recebe mensagem. O mesmo grupo não pode ser origem e destino.
- **Enviar é a parte que mais arrisca bloqueio.** Proteções automáticas: "digitando…", pausa de 45 s ou mais entre mensagens, máximo de 8 por hora e 40 por dia (só o administrador sobe esses limites), só dentro do horário ativo, só no grupo do próprio cliente e pausa automática após 5 falhas seguidas.
- **Privacidade:** da origem é guardado apenas o link da Shopee (por no máximo 2 dias). Textos e fotos não são salvos.
- Se o grupo do cliente só deixa administradores enviarem, o número do robô precisa ser administrador.
- Usa Baileys (gratuito). **Não é a API oficial**: não há garantia contra bloqueio. Use chip dedicado (nunca o número pessoal) e teste primeiro com um chip reserva. A entrada em grupos, a leitura e o envio ainda não foram validados contra o WhatsApp real (só contra um simulador).

## Segurança
- Senha do painel com scrypt; cookie `HttpOnly`/`SameSite=Strict`; limite de tentativas; proteção CSRF; CSP restrita.
- Segredos (Secret da Shopee, token do bot) ficam só em `data/config.json` (permissão 600) e nunca voltam ao navegador.
- O link do cliente dá acesso às credenciais dele: trate como senha (dá para gerar outro).
- Faça backup da pasta `data/`.

## Para vender
- Cobre pelo **serviço** (instalação, suporte, nichos), não por licença de API: tudo aqui é gratuito.
- Deixe claro ao cliente: depende da Open API da Shopee (conta de afiliado aprovada), do Telegram, e o WhatsApp é por conta e risco.
- Fluxo de venda: criar cliente no painel → definir nicho e canais → enviar o link → o cliente cola AppID/Secret e cria o grupo → o robô liga sozinho.

## Erros comuns
| Mensagem | Solução |
|---|---|
| `AppID/Secret inválidos... [10020]` | Recopie as credenciais; confira o relógio do servidor |
| `sem acesso à Open API [10035]` | A conta ainda não foi liberada para a Open API |
| `10000 System Error` | Instabilidade da Shopee; o robô tenta de novo em 3 min |
| "Ainda não vi o robô em nenhum grupo" | Criar o grupo e confirmar "Adicionar como administrador" |
| "Nenhuma promoção nova passou nos filtros" | Reduza desconto/nota mínimos ou troque o nicho |

## Testes
`npm test` roda 97 verificações ponta a ponta contra Shopee e Telegram simulados (`test/`).
