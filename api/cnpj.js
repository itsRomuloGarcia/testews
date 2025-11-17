export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Lidar com preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Verificar se é método GET
  if (req.method !== "GET") {
    return res.status(405).json({
      error: true,
      message: "Método não permitido",
    });
  }

  try {
    const { cnpj } = req.query;

    console.log("🔍 Consultando CNPJ:", cnpj);

    // Validar CNPJ
    if (!cnpj) {
      return res.status(400).json({
        error: true,
        message: "CNPJ não informado",
      });
    }

    const cnpjLimpo = cnpj.replace(/\D/g, "");
    if (cnpjLimpo.length !== 14) {
      return res.status(400).json({
        error: true,
        message: "CNPJ deve conter 14 dígitos",
      });
    }

    // Fazer requisição para a nova API pública
    const apiUrl = `https://publica.cnpj.ws/cnpj/${cnpjLimpo}`;
    console.log("📡 Chamando API:", apiUrl);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "*/*",
      },
    });

    console.log("📊 Status da API:", response.status);

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({
          error: true,
          message: "Empresa não encontrada",
        });
      }
      if (response.status === 429) {
        return res.status(429).json({
          error: true,
          message:
            "Limite de requisições excedido. Tente novamente mais tarde.",
        });
      }

      const errorText = await response.text();
      return res.status(response.status).json({
        error: true,
        message: `Erro na API: ${response.status}`,
      });
    }

    const apiData = await response.json();
    console.log("✅ Dados recebidos da API");

    // Mapear dados da nova API para estrutura esperada pelo frontend
    const mappedData = mapDataToFrontendStructure(apiData);

    return res.status(200).json({
      error: false,
      data: mappedData,
    });
  } catch (error) {
    console.error("💥 Erro:", error);
    return res.status(500).json({
      error: true,
      message: "Erro interno do servidor: " + error.message,
    });
  }
}

// Função para mapear dados da nova API para estrutura esperada pelo frontend
function mapDataToFrontendStructure(apiData) {
  const estabelecimento = apiData.estabelecimento || {};
  const simples = apiData.simples || {};

  return {
    // Dados básicos
    taxId: estabelecimento.cnpj || apiData.cnpj_raiz,
    alias: estabelecimento.nome_fantasia || "Não informado",
    founded: estabelecimento.data_inicio_atividade,
    updated: apiData.atualizado_em,
    status: {
      text: estabelecimento.situacao_cadastral || "Não informado",
    },
    statusDate: estabelecimento.data_situacao_cadastral,
    head: estabelecimento.tipo === "MATRIZ", // true se for matriz

    // Dados da empresa
    company: {
      name: apiData.razao_social || "Não informado",
      nature: {
        id: apiData.natureza_juridica?.id,
        text: apiData.natureza_juridica?.descricao,
      },
      size: {
        text: apiData.porte?.descricao,
        acronym: apiData.porte?.id,
      },
      equity:
        parseFloat(
          apiData.capital_social
            ?.replace("R$", "")
            ?.replace(".", "")
            ?.replace(",", ".")
        ) || 0,
      simples: {
        optant: simples.simples === "SIM",
        since: simples.data_opcao_simples,
      },
      simei: {
        optant: simples.mei === "SIM",
        since: simples.data_opcao_mei,
      },
      // Mapear sócios
      members:
        apiData.socios?.map((socio) => ({
          person: {
            name: socio.nome || "Não informado",
            age: socio.faixa_etaria || "Não informada",
          },
          role: {
            text: socio.qualificacao_socio?.descricao || socio.tipo || "Sócio",
          },
          since: socio.data_entrada,
        })) || [],
    },

    // Endereço
    address: {
      street: `${estabelecimento.tipo_logradouro || ""} ${
        estabelecimento.logradouro || ""
      }`.trim(),
      number: estabelecimento.numero,
      details: estabelecimento.complemento,
      district: estabelecimento.bairro,
      city: estabelecimento.cidade?.nome,
      state: estabelecimento.estado?.sigla,
      zip: estabelecimento.cep,
      country: estabelecimento.pais?.nome,
      municipality: estabelecimento.cidade?.nome,
    },

    // Contatos
    phones: [
      ...(estabelecimento.ddd1 && estabelecimento.telefone1
        ? [
            {
              area: estabelecimento.ddd1,
              number: estabelecimento.telefone1,
              type: "LANDLINE",
            },
          ]
        : []),
      ...(estabelecimento.ddd2 && estabelecimento.telefone2
        ? [
            {
              area: estabelecimento.ddd2,
              number: estabelecimento.telefone2,
              type: "LANDLINE",
            },
          ]
        : []),
    ],
    emails: estabelecimento.email
      ? [
          {
            address: estabelecimento.email,
            ownership: "CORPORATE",
          },
        ]
      : [],

    // Atividades econômicas
    mainActivity: {
      id: estabelecimento.atividade_principal?.id,
      text: estabelecimento.atividade_principal?.descricao,
    },
    sideActivities:
      estabelecimento.atividades_secundarias?.map((atividade) => ({
        id: atividade.id,
        text: atividade.descricao,
      })) || [],

    // Inscrições estaduais
    registrations:
      estabelecimento.inscricoes_estaduais?.map((ie) => ({
        type: { id: 1, text: "Normal" },
        number: ie.inscricao_estadual,
        state: ie.estado?.sigla,
        enabled: ie.ativo,
        status: { text: ie.ativo ? "Ativa" : "Inativa" },
      })) || [],

    // SUFRAMA - não disponível na nova API, manter vazio
    suframa: [],
  };
}
