'use strict';
// Catálogo de nichos. A afiliada escolhe o(s) nicho(s) e o robô só pesquisa e posta o que for desse assunto.
//   keywords: o que o robô pesquisa na Shopee (alterna entre elas a cada ciclo).
//   terms:    palavras que o NOME do produto precisa ter (início de palavra, sem acento) para ser postado.
//             (começando com "=", a palavra tem de ser inteira: "=cama" não casa com "camarão").
//             Isso segura os resultados "fora do assunto" que a busca da Shopee às vezes mistura.

const NICHES = [
  {
    id: 'cama-mesa-banho', name: 'Cama, mesa e banho', emoji: '🛏️',
    keywords: [
      'jogo de cama', 'lençol com elástico', 'edredom casal', 'cobertor microfibra', 'manta de sofá', 'travesseiro', 'fronha',
      'colcha de cama', 'kit toalhas de banho', 'toalha de rosto', 'roupão de banho', 'toalha de mesa', 'jogo americano',
      'pano de prato', 'avental de cozinha', 'cortina blackout', 'tapete de banheiro', 'protetor de colchão', 'capa de almofada',
      'cobre leito', 'tapete de sala', 'jogo de banheiro', 'toalha de praia', 'kit cama box',
    ],
    terms: ['lencol', 'lencois', 'jogo de cama', 'edredom', 'edredon', 'cobertor', 'manta', 'travesseiro', 'fronha', 'colcha', 'cobre leito', 'toalha',
      'roupao', 'jogo americano', 'pano de prato', 'avental', 'cortina', 'tapete', 'jogo de banheiro', 'banheiro', 'protetor de colchao', 'capa de almofada', 'almofada', '=cama', 'colchao', 'mesa posta', 'porta copos', 'toalhinha'],
  },
  {
    id: 'informatica', name: 'Informática', emoji: '💻',
    keywords: [
      'mouse sem fio', 'teclado mecânico', 'teclado e mouse', 'mouse gamer', 'hd externo', 'ssd 240gb', 'pen drive 64gb', 'cartão de memória',
      'webcam full hd', 'headset gamer', 'suporte para notebook', 'cooler notebook', 'mousepad grande', 'hub usb', 'cabo hdmi',
      'adaptador wifi usb', 'roteador wifi', 'monitor led', 'memória ram ddr4', 'mochila para notebook', 'capa para notebook', 'carregador notebook',
      'impressora', 'cabo de rede', 'caixa de som para pc',
    ],
    terms: ['mouse', 'teclado', '=hd', 'hd externo', 'ssd', 'pen drive', 'pendrive', 'cartao de memoria', 'micro sd', 'webcam', 'headset', 'notebook', 'laptop', 'cooler',
      'mousepad', 'hub', 'usb', 'hdmi', 'wifi', 'wi-fi', 'roteador', 'monitor', 'memoria ram', 'ddr4', 'ddr3', 'computador', '=pc', 'gamer', 'impressora', 'cabo de rede', 'adaptador',
      'switch', 'placa de video', 'fonte atx', 'gabinete', 'processador', 'tablet', 'microfone', 'cabo', 'carregador', 'mochila', 'estabilizador', 'nobreak', '=tela'],
  },
  {
    id: 'moveis', name: 'Móveis', emoji: '🛋️',
    keywords: [
      'estante para livros', 'rack para tv', 'painel para tv', 'mesa de escritório', 'cadeira de escritório', 'cadeira gamer', 'sapateira',
      'guarda roupa', 'cômoda', 'criado mudo', 'mesa de centro', 'mesa de jantar', 'banco para cozinha', 'prateleira de parede', 'escrivaninha',
      'poltrona', 'puff', 'sofá retrátil', 'cabideiro', 'penteadeira', 'aparador', 'armário multiuso', 'mesa dobrável', 'cama box solteiro',
    ],
    terms: ['estante', 'rack', 'painel', 'mesa', 'cadeira', 'sapateira', 'guarda roupa', 'guarda-roupa', 'comoda', 'criado mudo', 'criado-mudo', 'banco', 'banqueta', 'prateleira',
      'escrivaninha', 'poltrona', 'puff', 'sofa', 'cabideiro', 'penteadeira', 'aparador', 'armario', 'balcao', 'nicho', '=cama', 'beliche', 'cristaleira', 'buffet', 'divisoria', 'bancada', 'organizador de'],
  },
  {
    id: 'eletronicos', name: 'Eletrônicos e áudio', emoji: '🎧',
    keywords: [
      'fone de ouvido bluetooth', 'fone tws', 'caixa de som bluetooth', 'smartwatch', 'relógio inteligente', 'carregador portátil', 'power bank',
      'ring light', 'tripé para celular', 'microfone de lapela', 'projetor portátil', 'fone com fio', 'caixa de som portátil', 'tv box',
      'câmera de segurança wifi', 'lâmpada inteligente', 'controle remoto universal', 'soundbar', 'fita led', 'ventilador usb',
    ],
    terms: ['fone', 'headphone', 'earphone', 'tws', 'caixa de som', 'smartwatch', 'smart watch', 'relogio inteligente', 'carregador', 'power bank', 'ring light', 'tripe', 'microfone',
      'projetor', 'tv box', 'camera', 'lampada', 'controle remoto', 'soundbar', '=led', 'ventilador', 'bluetooth', 'speaker', 'bateria', 'pilha', 'gravador', 'radio', 'cabo'],
  },
  {
    id: 'celulares', name: 'Celulares e acessórios', emoji: '📱',
    keywords: [
      'capinha de celular', 'película de vidro', 'carregador turbo', 'cabo usb tipo c', 'cabo lightning', 'suporte de celular para carro', 'pop socket',
      'fone de ouvido para celular', 'carregador sem fio', 'cartão de memória celular', 'celular smartphone', 'bateria externa', 'suporte de celular mesa',
      'capa para iphone', 'capa para samsung', 'adaptador otg', 'selfie stick', 'lente para celular',
    ],
    terms: ['capinha', 'capa', 'pelicula', 'carregador', 'cabo', 'suporte', 'pop socket', 'popsocket', 'fone', 'celular', 'smartphone', 'iphone', 'samsung', 'xiaomi', 'motorola',
      'bateria', 'otg', 'selfie', 'lente', 'adaptador', 'tipo c', 'lightning', 'usb', '=anel', 'aneis', 'tripe'],
  },
  {
    id: 'eletrodomesticos', name: 'Eletrodomésticos', emoji: '🔌',
    keywords: [
      'air fryer', 'fritadeira elétrica', 'liquidificador', 'batedeira', 'sanduicheira', 'cafeteira elétrica', 'chaleira elétrica', 'mixer',
      'processador de alimentos', 'ventilador', 'aspirador de pó', 'ferro de passar', 'umidificador de ar', 'purificador de ar', 'panela elétrica',
      'espremedor de frutas', 'grill elétrico', 'forno elétrico', 'máquina de lavar', 'aquecedor', 'robô aspirador', 'secador de cabelo',
    ],
    terms: ['air fryer', 'fritadeira', 'liquidificador', 'batedeira', 'sanduicheira', 'cafeteira', 'chaleira', 'mixer', 'processador', 'ventilador', 'aspirador', 'ferro de passar',
      'ferro a vapor', 'umidificador', 'purificador', 'panela eletrica', 'panela de pressao eletrica', 'espremedor', 'grill', 'forno', 'lavadora', 'maquina de lavar', 'aquecedor', 'robo', 'secador',
      'multiprocessador', 'torradeira', 'cooktop', 'fogao', 'geladeira', 'microondas', 'depurador', 'climatizador', 'arcondicionado', 'ar condicionado', 'lavadora de alta pressao'],
  },
  {
    id: 'cozinha', name: 'Cozinha e utensílios', emoji: '🍳',
    keywords: [
      'jogo de panelas', 'frigideira antiaderente', 'kit utensílios de silicone', 'potes herméticos', 'marmita', 'garrafa térmica', 'copo térmico stanley',
      'faca de cozinha', 'tábua de corte', 'ralador', 'escorredor de louça', 'porta temperos', 'organizador de geladeira', 'jogo de facas', 'forma de bolo',
      'pote de vidro', 'dispenser de detergente', 'espremedor de alho', 'jogo de pratos', 'jogo de copos', 'taça de vidro', 'bule de café', 'lunch box',
    ],
    terms: ['panela', 'frigideira', 'utensilio', 'silicone', 'pote', 'marmita', 'garrafa', 'copo', 'faca', 'tabua', 'ralador', 'escorredor', 'porta tempero', 'organizador', 'forma',
      'dispenser', 'espremedor', 'prato', 'taca', 'bule', 'lunch', 'colher', 'garfo', 'talher', 'concha', 'espatula', 'assadeira', 'cumbuca', 'tigela', 'xicara', 'caneca', 'jarra', 'cuscuzeira', 'peneira', 'abridor', 'bandeja', 'pegador', 'fatiador'],
  },
  {
    id: 'decoracao', name: 'Decoração', emoji: '🖼️',
    keywords: [
      'quadro decorativo', 'luminária de mesa', 'vaso decorativo', 'planta artificial', 'espelho decorativo', 'relógio de parede', 'almofada decorativa',
      'tapete para sala', 'cortina para sala', 'porta retrato', 'fita led quarto', 'luminária pendente', 'papel de parede', 'adesivo de parede', 'cesto organizador',
      'vela aromática', 'difusor de ambiente', 'estátua decorativa', 'castiçal', 'painel de led neon', 'varal de fotos', 'manta decorativa',
    ],
    terms: ['quadro', 'luminaria', 'abajur', 'vaso', 'planta', 'espelho', 'relogio de parede', 'almofada', 'tapete', 'cortina', 'porta retrato', '=led', 'pendente', 'papel de parede', 'adesivo',
      'cesto', 'vela', 'difusor', 'aromatizador', 'estatua', 'castical', 'neon', 'varal', 'manta', 'decorativ', 'enfeite', 'escultura', 'flor', 'prateleira', 'moldura', 'tela decorativa', 'lustre', 'arandela', 'cachepot'],
  },
  {
    id: 'beleza', name: 'Beleza e maquiagem', emoji: '💄',
    keywords: [
      'kit maquiagem', 'base líquida', 'batom matte', 'paleta de sombras', 'máscara de cílios', 'pincel de maquiagem', 'esponja de maquiagem', 'corretivo',
      'blush', 'iluminador facial', 'delineador', 'lip gloss', 'sérum facial', 'protetor solar facial', 'hidratante facial', 'sabonete facial', 'máscara facial',
      'removedor de maquiagem', 'unha postiça', 'esmalte', 'kit skincare', 'ácido hialurônico', 'vitamina c facial', 'rolo de jade',
    ],
    terms: ['maquiagem', 'base', 'batom', 'sombra', 'paleta', 'rimel', 'mascara de cilios', 'pincel', 'esponja', 'corretivo', 'blush', 'iluminador', 'delineador', 'gloss', 'serum', 'protetor solar',
      'hidratante', 'sabonete', 'mascara facial', 'demaquilante', 'removedor', 'unha', 'esmalte', 'skincare', 'acido', 'vitamina c', 'jade', 'po compacto', 'primer', 'fixador', 'cilios', 'sobrancelha', 'lapis', 'tonico', 'creme', 'locao', 'agua micelar', 'esfoliante', 'gua sha'],
  },
  {
    id: 'cabelo', name: 'Cabelo e perfumes', emoji: '💇‍♀️',
    keywords: [
      'secador de cabelo', 'prancha alisadora', 'babyliss modelador', 'escova secadora', 'shampoo', 'condicionador', 'máscara capilar', 'óleo capilar',
      'leave in', 'touca de cetim', 'presilha de cabelo', 'scrunchie', 'tiara', 'perfume importado', 'body splash', 'desodorante', 'perfume feminino',
      'perfume masculino', 'kit cabelo cacheado', 'tintura de cabelo', 'aparador de pelos', 'barbeador elétrico', 'máquina de cortar cabelo', 'pente alisador',
    ],
    terms: ['secador', 'prancha', 'babyliss', 'modelador', 'escova', 'shampoo', 'condicionador', 'mascara capilar', 'oleo', 'leave', 'touca', 'presilha', 'scrunchie', 'tiara', 'perfume',
      'body splash', 'colonia', 'desodorante', 'cabelo', 'capilar', 'tintura', 'aparador', 'barbeador', 'maquina de cortar', 'pente', 'trimmer', 'barba', 'creme de pentear', 'ativador de cachos', 'difusor', 'grampo', 'xuxinha', 'lenco'],
  },
  {
    id: 'moda-feminina', name: 'Moda feminina', emoji: '👗',
    keywords: [
      'vestido feminino', 'conjunto feminino', 'blusa feminina', 'cropped', 'calça jeans feminina', 'calça legging', 'saia midi', 'short feminino',
      'body feminino', 'camisola', 'pijama feminino', 'lingerie', 'sutiã', 'calcinha', 'biquíni', 'maiô', 'kimono', 'jaqueta feminina', 'moletom feminino',
      'macacão feminino', 'blazer feminino', 'cardigan', 'camiseta feminina', 'top academia',
    ],
    terms: ['vestido', 'conjunto', 'blusa', 'cropped', 'calca', 'legging', 'saia', 'short', 'body', 'camisola', 'pijama', 'lingerie', 'sutia', 'calcinha', 'biquini', 'maio', 'kimono', 'jaqueta',
      'moletom', 'macacao', 'blazer', 'cardigan', 'camiseta', '=top', 'feminin', 'regata', 'casaco', 'colete', 'camisa', 'bermuda', 'jardineira', 'sobretudo', 'meia', 'cinta', 'shapewear', 'canga', 'saida de praia'],
  },
  {
    id: 'moda-masculina', name: 'Moda masculina', emoji: '👔',
    keywords: [
      'camiseta masculina', 'camisa social masculina', 'camisa polo', 'bermuda masculina', 'calça jogger', 'calça jeans masculina', 'jaqueta masculina',
      'moletom masculino', 'cueca boxer', 'kit cuecas', 'meias masculinas', 'cinto masculino', 'carteira masculina', 'boné', 'camiseta dry fit', 'shorts masculino',
      'blusa de frio masculina', 'pijama masculino', 'regata masculina', 'sunga', 'terno', 'gravata',
    ],
    terms: ['camiseta', 'camisa', 'polo', 'bermuda', 'calca', 'jogger', 'jaqueta', 'moletom', 'cueca', 'boxer', 'meia', 'cinto', 'carteira', 'bone', 'dry fit', 'short', 'masculin', 'blusa',
      'pijama', 'regata', 'sunga', 'terno', 'gravata', 'casaco', 'colete', 'suspensorio', 'abotoadura', 'cardigan', 'sobretudo'],
  },
  {
    id: 'calcados', name: 'Calçados', emoji: '👟',
    keywords: [
      'tênis masculino', 'tênis feminino', 'tênis casual', 'tênis para corrida', 'sandália feminina', 'chinelo slide', 'chinelo havaianas', 'sapatênis',
      'bota feminina', 'sapato social masculino', 'rasteirinha', 'sapatilha', 'tamanco', 'papete', 'sandália plataforma', 'tênis infantil', 'chuteira',
      'bota masculina', 'sapato feminino', 'palmilha', 'crocs', 'sandália ortopédica',
    ],
    terms: ['tenis', 'sandalia', 'chinelo', 'slide', 'havaianas', 'sapatenis', '=bota', 'sapato', 'rasteira', 'rasteirinha', 'sapatilha', 'tamanco', 'papete', 'chuteira', 'palmilha', 'crocs', 'mocassim',
      'sapatilha', 'scarpin', 'salto', 'coturno', 'alpargata', 'calcado', 'oxford', 'anabela', 'botina', 'pantufa', 'galocha'],
  },
  {
    id: 'bolsas-acessorios', name: 'Bolsas, relógios e bijuterias', emoji: '👜',
    keywords: [
      'bolsa feminina', 'bolsa transversal', 'mochila feminina', 'mochila masculina', 'pochete', 'bolsa de ombro', 'carteira feminina', 'necessaire',
      'relógio feminino', 'relógio masculino', 'óculos de sol', 'brinco', 'colar feminino', 'pulseira', 'anel', 'conjunto de bijuterias', 'aliança', 'cordão masculino',
      'mala de viagem', 'bolsa térmica', 'bolsa esportiva', 'tornozeleira', 'lenço de cabelo',
    ],
    terms: ['bolsa', 'mochila', 'pochete', 'carteira', 'necessaire', 'relogio', 'oculos', 'brinco', 'colar', 'pulseira', '=anel', 'aneis', 'bijuteria', 'alianca', 'cordao', '=mala', 'tornozeleira',
      'pingente', 'corrente', 'joia', 'semijoia', 'prata', 'folheado', 'broche', 'chaveiro', 'porta cartao', 'clutch', '=bag', 'shoulder', 'lenco', 'bolsinha'],
  },
  {
    id: 'bebe-infantil', name: 'Bebê e infantil', emoji: '🍼',
    keywords: [
      'kit enxoval bebê', 'fralda de pano', 'body de bebê', 'macacão de bebê', 'mamadeira', 'chupeta', 'babá eletrônica', 'carrinho de bebê', 'bebê conforto',
      'banheira de bebê', 'toalha de bebê', 'manta de bebê', 'cobertor de bebê', 'sapatinho de bebê', 'mordedor', 'organizador de fraldas', 'cercadinho',
      'roupa infantil', 'conjunto infantil', 'pijama infantil', 'mochila infantil', 'garrafinha infantil', 'protetor de berço', 'móbile',
    ],
    terms: ['bebe', 'enxoval', 'fralda', 'body', 'macacao', 'mamadeira', 'chupeta', 'baba eletronica', 'carrinho', 'conforto', 'banheira', 'toalha', 'manta', 'cobertor', 'sapatinho', 'mordedor',
      'cercadinho', 'infantil', 'crianca', 'menino', 'menina', 'berco', 'mobile', 'babador', 'pijama', 'mochila', 'garrafinha', 'copo de treinamento', 'cadeirinha', 'trocador', 'bolsa maternidade', 'recem nascido', 'mijao'],
  },
  {
    id: 'brinquedos', name: 'Brinquedos', emoji: '🧸',
    keywords: [
      'brinquedo educativo', 'blocos de montar', 'quebra cabeça', 'boneca', 'carrinho de controle remoto', 'pelúcia', 'massinha de modelar', 'jogo de tabuleiro',
      'pista de carrinhos', 'kit de ferramentas infantil', 'slime', 'pop it', 'fidget toy', 'cozinha infantil', 'lego compatível', 'instrumento musical infantil',
      'brinquedo de banho', 'bola', 'lousa mágica', 'fantasia infantil', 'jogo de cartas', 'kit médico infantil',
    ],
    terms: ['brinquedo', 'bloco', 'montar', 'quebra cabeca', 'boneca', 'carrinho', 'controle remoto', 'pelucia', 'massinha', 'jogo', 'pista', 'slime', 'pop it', 'fidget', 'infantil', 'lego',
      '=bola', 'lousa', 'fantasia', 'baralho', 'carta', 'educativ', 'bonecos', 'dinossauro', 'urso', 'pet shop', 'peluche', 'balanco', 'escorregador', 'piscina de bolinha', 'bambole', 'hot wheels'],
  },
  {
    id: 'pets', name: 'Pet shop', emoji: '🐶',
    keywords: [
      'cama para cachorro', 'caminha pet', 'coleira para cachorro', 'peitoral para cachorro', 'guia retrátil', 'comedouro pet', 'bebedouro para gatos', 'arranhador para gatos',
      'brinquedo para cachorro', 'brinquedo para gato', 'roupa para cachorro', 'tapete higiênico', 'caixa de transporte pet', 'escova pet', 'fonte para gatos',
      'areia para gatos', 'kit banho pet', 'osso para cachorro', 'casinha para cachorro', 'ração', 'cortador de unhas pet', 'focinheira',
    ],
    terms: ['cachorro', 'gato', 'pet', '=cao', 'caes', 'coleira', 'peitoral', 'guia', 'comedouro', 'bebedouro', 'arranhador', 'caminha', 'tapete higienico', 'caixa de transporte', 'racao', 'areia', 'focinheira',
      'casinha', 'osso', 'petisco', 'aquario', 'passaro', 'gaiola', 'felino', 'canino', 'roupinha', 'fantasia pet', 'banheira pet', 'pa higienica'],
  },
  {
    id: 'esportes', name: 'Esporte e fitness', emoji: '🏋️',
    keywords: [
      'halter', 'kit elástico exercício', 'corda de pular', 'tapete de yoga', 'roda abdominal', 'caneleira e tornozeleira', 'luva de academia', 'garrafa de água academia',
      'coqueteleira', 'bola de pilates', 'faixa elástica', 'bicicleta ergométrica', 'esteira', 'camiseta dry fit', 'legging academia', 'bermuda de ciclismo',
      'luva de boxe', 'bola de futebol', 'tênis de corrida', 'mochila esportiva', 'relógio esportivo', 'bomba de bicicleta', 'capacete de bicicleta', 'smartband',
    ],
    terms: ['halter', 'eletico', 'elastic', 'corda de pular', 'yoga', 'abdominal', 'caneleira', 'tornozeleira', 'luva', 'garrafa', 'coqueteleira', 'pilates', 'faixa', 'bicicleta', 'esteira',
      'dry fit', 'legging', 'ciclismo', 'boxe', '=bola', 'tenis', 'mochila', 'relogio', 'capacete', 'smartband', 'academia', 'fitness', 'treino', 'musculacao', 'barra', 'anilha', 'colchonete', 'suporte de', 'natacao', 'oculos de natacao', 'touca', 'skate', 'patins', 'bike'],
  },
  {
    id: 'games', name: 'Games', emoji: '🎮',
    keywords: [
      'controle de playstation', 'controle xbox', 'controle gamer celular', 'headset gamer', 'cadeira gamer', 'mouse gamer', 'teclado gamer', 'mousepad gamer',
      'console retro', 'video game portátil', 'suporte para controle', 'capa para nintendo switch', 'cartão de memória switch', 'volante gamer', 'microfone gamer',
      'led gamer', 'placa de captura', 'joystick', 'jogo ps4', 'game stick',
    ],
    terms: ['controle', 'playstation', 'ps4', 'ps5', 'xbox', 'gamer', 'headset', 'cadeira', 'mouse', 'teclado', 'mousepad', 'console', 'video game', 'videogame', 'nintendo', 'switch', 'volante',
      'microfone', '=led', 'captura', 'joystick', 'jogo', 'game', 'retro', 'arcade', 'gamepad', 'fliperama', 'steam'],
  },
  {
    id: 'automotivo', name: 'Automotivo', emoji: '🚗',
    keywords: [
      'suporte de celular para carro', 'aspirador de carro', 'capa de volante', 'tapete automotivo', 'carregador veicular', 'câmera de ré', 'organizador de porta malas',
      'cheirinho para carro', 'capa de banco', 'compressor de ar', 'protetor de sol para carro', 'limpador de para brisa', 'kit de limpeza automotiva', 'cera automotiva',
      'luz de led para carro', 'capa para moto', 'capacete de moto', 'luva de moto', 'baú para moto', 'som automotivo', 'fita de led para carro', 'tapete de porta malas',
    ],
    terms: ['=carro', 'automotiv', 'veicular', 'volante', 'tapete', 'camera de re', 'porta malas', 'cheirinho', 'aromatizador', 'banco', 'compressor', 'protetor de sol', 'para brisa', 'limpeza',
      'cera', '=led', '=moto', 'capacete', 'luva', 'bau', 'som automotivo', 'farol', 'pneu', 'retrovisor', 'suporte', 'lavadora', 'polidor', 'aspirador', 'cabo', 'bateria', 'carregador', 'chave', 'antena', 'pelicula', 'adesivo', 'escova'],
  },
  {
    id: 'ferramentas', name: 'Ferramentas e construção', emoji: '🔧',
    keywords: [
      'furadeira', 'parafusadeira', 'kit de ferramentas', 'caixa de ferramentas', 'jogo de chaves', 'alicate', 'trena', 'nível a laser', 'serra tico tico',
      'lixadeira', 'multímetro', 'chave de fenda', 'martelo', 'broca', 'fita isolante', 'pistola de cola quente', 'lanterna tática', 'escada dobrável',
      'mangueira de jardim', 'pulverizador', 'ferro de solda', 'máquina de solda', 'cavalete', 'abraçadeira',
    ],
    terms: ['furadeira', 'parafusadeira', 'ferramenta', 'jogo de chave', 'chave', 'alicate', 'trena', 'nivel', 'serra', 'lixadeira', 'multimetro', 'martelo', 'broca', 'fita', 'pistola', 'cola quente',
      'lanterna', 'escada', 'mangueira', 'pulverizador', 'solda', 'cavalete', 'abracadeira', 'parafuso', '=bit', 'soquete', 'esmerilhadeira', 'tupia', 'plaina', 'tinta', 'rolo', 'pincel', 'espatula', 'cadeado', 'fechadura', 'dobradica', 'torneira', 'chuveiro', 'resistencia', 'tomada', 'extensao'],
  },
  {
    id: 'organizacao-limpeza', name: 'Organização e limpeza', emoji: '🧹',
    keywords: [
      'organizador de armário', 'caixa organizadora', 'cesto de roupa', 'cabide', 'cabide organizador', 'sapateira organizadora', 'gancho adesivo', 'porta objetos',
      'vassoura', 'rodo', 'mop giratório', 'balde', 'pano de microfibra', 'esponja de limpeza', 'kit de limpeza', 'tapete antiderrapante', 'lixeira', 'saco a vácuo',
      'varal de chão', 'tábua de passar roupa', 'organizador de gaveta', 'dispenser sabonete', 'porta papel higiênico', 'suporte para vassoura',
    ],
    terms: ['organizador', 'caixa', 'cesto', 'cabide', 'sapateira', 'gancho', 'porta objeto', 'vassoura', 'rodo', 'mop', 'balde', 'pano', 'esponja', 'limpeza', 'tapete', 'lixeira', 'saco a vacuo',
      'varal', 'tabua de passar', 'gaveta', 'dispenser', 'porta papel', 'suporte', 'prateleira', 'multiuso', 'lavanderia', 'bacia', 'cabideiro', 'mop giratorio', 'escova', 'luva', 'desentupidor', 'pa de lixo', 'rodinho', 'ventosa'],
  },
  {
    id: 'papelaria', name: 'Papelaria e escritório', emoji: '✏️',
    keywords: [
      'caderno universitário', 'caderno inteligente', 'agenda 2027', 'planner', 'caneta gel', 'kit canetas coloridas', 'marca texto', 'lápis de cor', 'estojo escolar',
      'mochila escolar', 'organizador de mesa', 'post it', 'fita adesiva', 'tesoura', 'calculadora científica', 'pasta organizadora', 'grampeador', 'adesivos fofos',
      'washi tape', 'lousa branca', 'etiquetas adesivas', 'impressora de etiquetas',
    ],
    terms: ['caderno', 'agenda', 'planner', 'caneta', 'marca texto', 'lapis', 'estojo', 'mochila', 'organizador', 'post it', 'fita', 'tesoura', 'calculadora', 'pasta', 'grampeador', 'adesivo',
      'washi', 'lousa', 'etiqueta', 'papel', 'bloco', 'caixa', 'cola', 'regua', 'apontador', 'borracha', 'giz', 'tinta', 'pincel', 'marcador', 'prancheta', 'arquivo', 'clips', 'cartolina', 'sulfite'],
  },
  {
    id: 'saude', name: 'Saúde e bem-estar', emoji: '🩺',
    keywords: [
      'massageador elétrico', 'massageador de pescoço', 'balança digital', 'balança de bioimpedância', 'termômetro digital', 'medidor de pressão', 'oxímetro', 'almofada ortopédica',
      'travesseiro cervical', 'cinta postural', 'joelheira', 'tornozeleira ortopédica', 'bolsa térmica', 'umidificador', 'difusor aromático', 'kit primeiros socorros',
      'máscara de dormir', 'tapete de massagem', 'rolo de massagem', 'pistola massageadora', 'escalda pés', 'lixa elétrica para pés',
    ],
    terms: ['massageador', 'massagem', 'balanca', 'termometro', 'medidor', 'oximetro', 'ortopedic', 'travesseiro', 'cervical', 'cinta', 'postural', 'joelheira', 'tornozeleira', 'bolsa termica',
      'umidificador', 'difusor', 'primeiros socorros', 'mascara de dormir', 'tapete de acupressao', 'rolo', 'pistola', 'escalda', 'lixa', 'almofada', 'glicose', 'nebulizador', 'inalador', 'compressa', 'faixa', 'colete'],
  },
  {
    id: 'viagem-camping', name: 'Viagem e camping', emoji: '🎒',
    keywords: [
      'mala de viagem', 'mala de bordo', 'mochila de viagem', 'organizador de mala', 'travesseiro de pescoço', 'necessaire de viagem', 'barraca de camping', 'saco de dormir',
      'lanterna recarregável', 'cadeira dobrável', 'caixa térmica', 'garrafa térmica', 'colchão inflável', 'fogareiro portátil', 'canivete', 'corda paracord',
      'cadeado para mala', 'etiqueta de mala', 'adaptador de tomada universal', 'mochila de trilha', 'guarda sol', 'toalha de secagem rápida',
    ],
    terms: ['=mala', 'mochila', 'organizador', 'travesseiro', 'necessaire', 'barraca', 'saco de dormir', 'lanterna', 'cadeira', 'caixa termica', 'garrafa', 'colchao', 'fogareiro', 'canivete', 'corda',
      'cadeado', 'etiqueta', 'adaptador', 'trilha', 'guarda sol', 'toalha', 'camping', 'viagem', 'pochete', 'bolsa', 'isca', 'pesca', 'vara', 'tenda', '=rede', 'binoculo', 'bussola', 'lampiao', 'cooler'],
  },
  {
    id: 'festa-sazonal', name: 'Festas e datas comemorativas', emoji: '🎉',
    keywords: [
      'decoração de festa', 'balões', 'kit festa', 'enfeite de natal', 'árvore de natal', 'luzes de natal', 'pisca pisca', 'decoração de aniversário', 'topo de bolo',
      'cesta de natal', 'meias de natal', 'guirlanda', 'fantasia', 'vela de aniversário', 'painel de festa', 'confete', 'lembrancinha', 'caixinha de presente',
      'embalagem para presente', 'papai noel', 'enfeite de páscoa', 'ovo de páscoa casca',
    ],
    terms: ['festa', 'balao', 'baloes', 'natal', 'natalin', 'arvore', 'luzes', 'pisca', 'aniversario', 'topo de bolo', 'cesta', 'meia', 'guirlanda', 'fantasia', 'vela', 'painel', 'confete',
      'lembrancinha', 'caixinha', 'embalagem', 'papai noel', 'pascoa', 'decoracao', 'enfeite', 'presente', 'sacola', 'laco', 'fita', 'prato descartavel', 'copo descartavel', 'bandeirinha', 'halloween', 'carnaval', 'ano novo', 'chapeu', 'tiara'],
  },
  {
    id: 'variedades', name: 'Variedades (tudo um pouco)', emoji: '🛍️',
    keywords: [
      'fone bluetooth', 'air fryer', 'smartwatch', 'tênis masculino', 'organizador', 'kit toalhas', 'jogo de panelas', 'caixa de som bluetooth', 'vestido feminino',
      'capinha de celular', 'mochila', 'garrafa térmica', 'luminária led', 'ventilador', 'relógio masculino', 'bolsa feminina', 'brinquedo educativo', 'kit maquiagem',
      'mouse sem fio', 'cadeira gamer', 'tapete de sala', 'carregador portátil', 'jaqueta', 'sandália feminina', 'caixa organizadora', 'lençol', 'cortina', 'pet cama',
      'ferramentas', 'perfume', 'calça jeans', 'copo térmico', 'ring light', 'massageador', 'balança digital', 'quadro decorativo', 'boné', 'cueca', 'pijama', 'tênis feminino',
    ],
    terms: [], // sem filtro: qualquer produto serve
  },
];

const BY_ID = new Map(NICHES.map((n) => [n.id, n]));
const NICHE_IDS = new Set(NICHES.map((n) => n.id));

const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Um regex por nicho: o termo precisa começar uma palavra do nome (ex.: "toalha" casa com "toalhas", mas "cama" não casa com "camarão").
const MATCHERS = new Map();
for (const n of NICHES) {
  if (!n.terms.length) continue;
  const alt = n.terms.map((t) => {
    const w = normalize(t).trim();
    if (!w) return '';
    return w.startsWith('=') ? `${escapeRe(w.slice(1))}(?:s|es)?(?![a-z0-9])` : escapeRe(w); // "=" → palavra inteira
  }).filter(Boolean).join('|');
  MATCHERS.set(n.id, new RegExp(`(?:^|[^a-z0-9])(?:${alt})`));
}

// Lista enviada ao navegador (sem os termos internos).
function publicNiches() {
  return NICHES.map((n) => ({ id: n.id, name: n.name, emoji: n.emoji, sample: n.keywords.slice(0, 6) }));
}

function validIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x).trim()).filter((x) => NICHE_IDS.has(x)))];
}

// Intercala as listas (1 de cada nicho por vez) para todos os nichos escolhidos aparecerem em todo ciclo.
function interleave(groups) {
  const out = [];
  const seen = new Set();
  for (let i = 0; groups.some((g) => i < g.length); i++) {
    for (const g of groups) {
      if (i < g.length && !seen.has(g[i].toLowerCase())) {
        seen.add(g[i].toLowerCase());
        out.push(g[i]);
      }
    }
  }
  return out;
}

// O que o robô vai pesquisar:
//   nichos escolhidos  → palavras desses nichos (+ as palavras extras da pessoa)
//   nada escolhido     → as palavras da pessoa; se não houver, "variedades"
function effectiveKeywords(search) {
  const niches = validIds(search?.niches);
  const custom = (search?.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  const groups = niches.map((id) => BY_ID.get(id).keywords);
  if (custom.length) groups.push(custom);
  if (!groups.length) groups.push(BY_ID.get('variedades').keywords);
  return { list: interleave(groups), custom: new Set(custom.map((k) => k.toLowerCase())), niches };
}

// O nome do produto combina com algum dos nichos escolhidos?
function matchesNiches(name, nicheIds) {
  const ids = validIds(nicheIds);
  if (!ids.length || ids.includes('variedades')) return true;
  const n = normalize(name);
  return ids.some((id) => MATCHERS.get(id)?.test(n));
}

const nicheNames = (ids) => validIds(ids).map((id) => BY_ID.get(id).name);

module.exports = { NICHES, NICHE_IDS, publicNiches, validIds, effectiveKeywords, matchesNiches, nicheNames };
