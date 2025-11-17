// =============================================
// CONFIGURAÇÕES DE SEGURANÇA E RATE LIMITING
// =============================================
const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 10,
  TIMEOUT_MS: 10000,
  ALLOWED_ORIGINS: ['*'], // Em produção, especificar domínios
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
};

// Cache simples em memória
const requestCache = new Map();
const rateLimitMap = new Map();

// =============================================
// MIDDLEWARES DE SEGURANÇA
// =============================================
class SecurityMiddleware {
  static validateOrigin(req, res) {
    const origin = req.headers.origin;
    
    if (SECURITY_CONFIG.ALLOWED_ORIGINS[0] !== '*' && 
        !SECURITY_CONFIG.ALLOWED_ORIGINS.includes(origin)) {
      return false;
    }
    
    return true;
  }

  static checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minuto
    
    // Limpar entradas antigas
    for (const [key, timestamp] of rateLimitMap.entries()) {
      if (timestamp < windowStart) {
        rateLimitMap.delete(key);
      }
    }

    const requestCount = Array.from(rateLimitMap.entries())
      .filter(([key, timestamp]) => key.startsWith(ip) && timestamp > windowStart)
      .length;

    if (requestCount >= SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }

    rateLimitMap.set(`${ip}-${now}`, now);
    return true;
  }

  static getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           'unknown';
  }

  static sanitizeCNPJ(cnpj) {
    if (typeof cnpj !== 'string') return '';
    
    // Remove caracteres não numéricos e limita a 14 dígitos
    return cnpj.replace(/\D/g, '').substring(0, 14);
  }
}

// =============================================
// GERENCIADOR DE CACHE
// =============================================
class CacheManager {
  static get(cnpj) {
    const entry = requestCache.get(cnpj);
    
    if (entry && Date.now() - entry.timestamp < SECURITY_CONFIG.CACHE_TTL) {
      return entry.data;
    }
    
    // Remove entrada expirada
    if (entry) {
      requestCache.delete(cnpj);
    }
    
    return null;
  }

  static set(cnpj, data) {
    requestCache.set(cnpj, {
      data,
      timestamp: Date.now()
    });
  }

  static clear() {
    requestCache.clear();
  }
}

// =============================================
// VALIDADOR DE CNPJ (SERVER-SIDE)
// =============================================
class CNPJValidatorServer {
  static validate(cnpj) {
    const cleaned = cnpj.replace(/\D/g, '');
    
    if (cleaned.length !== 14) {
      return { isValid: false, error: 'CNPJ deve conter 14 dígitos' };
    }

    // CNPJs com dígitos repetidos são inválidos
    if (/^(\d)\1+$/.test(cleaned)) {
      return { isValid: false, error: 'CNPJ inválido' };
    }

    // Validação dos dígitos verificadores
    let tamanho = cleaned.length - 2;
    let numeros = cleaned.substring(0, tamanho);
    let digitos = cleaned.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;

    for (let i = tamanho; i >= 1; i--) {
      soma += numeros.charAt(tamanho - i) * pos--;
      if (pos < 2) pos = 9;
    }

    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(0))) {
      return { isValid: false, error: 'CNPJ inválido' };
    }

    tamanho = tamanho + 1;
    numeros = cleaned.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;

    for (let i = tamanho; i >= 1; i--) {
      soma += numeros.charAt(tamanho - i) * pos--;
      if (pos < 2) pos = 9;
    }

    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(1))) {
      return { isValid: false, error: 'CNPJ inválido' };
    }

    return { isValid: true, cleaned };
  }
}

// =============================================
// CLIENTE DA API EXTERNA
// =============================================
class ExternalAPIClient {
  static async fetchCNPJData(cnpj) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SECURITY_CONFIG.TIMEOUT_MS);

    try {
      const apiUrl = `https://publica.cnpj.ws/cnpj/${cnpj}`;
      
      console.log('📡 Chamando API externa:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CNPJ-Finder-App/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API externa retornou status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Dados recebidos da API externa');
      
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Timeout na consulta da API externa');
      }
      
      throw error;
    }
  }
}

// =============================================
// MAPEADOR DE DADOS
// =============================================
class DataMapper {
  static mapToFrontendStructure(apiData) {
    const estabelecimento = apiData.estabelecimento || {};
    const simples = apiData.simples || {};

    return {
      // Dados básicos
      taxId: estabelecimento.cnpj || apiData.cnpj_raiz,
      alias: estabelecimento.nome_fantasia || null,
      founded: estabelecimento.data_inicio_atividade,
      updated: apiData.atualizado_em,
      status: {
        text: estabelecimento.situacao_cadastral || null,
      },
      statusDate: estabelecimento.data_situacao_cadastral,
      head: estabelecimento.tipo === 'MATRIZ',

      // Dados da empresa
      company: {
        name: apiData.razao_social || null,
        nature: apiData.natureza_juridica ? {
          id: apiData.natureza_juridica.id,
          text: apiData.natureza_juridica.descricao,
        } : null,
        size: apiData.porte ? {
          text: apiData.porte.descricao,
          acronym: apiData.porte.id,
        } : null,
        equity: this.parseCurrency(apiData.capital_social),
        simples: {
          optant: simples.simples === 'SIM',
          since: simples.data_opcao_simples,
        },
        simei: {
          optant: simples.mei === 'SIM',
          since: simples.data_opcao_mei,
        },
        members: this.mapMembers(apiData.socios),
      },

      // Endereço
      address: this.mapAddress(estabelecimento),

      // Contatos
      phones: this.mapPhones(estabelecimento),
      emails: this.mapEmails(estabelecimento),

      // Atividades econômicas
      mainActivity: this.mapActivity(estabelecimento.atividade_principal),
      sideActivities: this.mapActivities(estabelecimento.atividades_secundarias),

      // Inscrições estaduais
      registrations: this.mapRegistrations(estabelecimento.inscricoes_estaduais),

      // SUFRAMA - não disponível na API pública
      suframa: [],
    };
  }

  static parseCurrency(value) {
    if (!value) return 0;
    
    try {
      return parseFloat(
        value
          .replace('R$', '')
          .replace(/\./g, '')
          .replace(',', '.')
          .trim()
      ) || 0;
    } catch (error) {
      console.warn('Erro ao parsear valor monetário:', value, error);
      return 0;
    }
  }

  static mapMembers(socios) {
    if (!socios || !Array.isArray(socios)) return [];

    return socios.map(socio => ({
      person: {
        name: socio.nome || null,
        age: socio.faixa_etaria || null,
      },
      role: {
        text: socio.qualificacao_socio?.descricao || socio.tipo || 'Sócio',
      },
      since: socio.data_entrada,
    })).filter(member => member.person.name); // Remove sócios sem nome
  }

  static mapAddress(estabelecimento) {
    if (!estabelecimento) return null;

    return {
      street: `${estabelecimento.tipo_logradouro || ''} ${
        estabelecimento.logradouro || ''
      }`.trim(),
      number: estabelecimento.numero,
      details: estabelecimento.complemento,
      district: estabelecimento.bairro,
      city: estabelecimento.cidade?.nome,
      state: estabelecimento.estado?.sigla,
      zip: estabelecimento.cep,
      country: estabelecimento.pais?.nome,
      municipality: estabelecimento.cidade?.nome,
    };
  }

  static mapPhones(estabelecimento) {
    const phones = [];

    if (estabelecimento.ddd1 && estabelecimento.telefone1) {
      phones.push({
        area: estabelecimento.ddd1,
        number: estabelecimento.telefone1,
        type: 'LANDLINE',
      });
    }

    if (estabelecimento.ddd2 && estabelecimento.telefone2) {
      phones.push({
        area: estabelecimento.ddd2,
        number: estabelecimento.telefone2,
        type: 'LANDLINE',
      });
    }

    return phones;
  }

  static mapEmails(estabelecimento) {
    if (!estabelecimento.email) return [];

    return [
      {
        address: estabelecimento.email,
        ownership: 'CORPORATE',
      },
    ];
  }

  static mapActivity(activity) {
    if (!activity) return null;

    return {
      id: activity.id,
      text: activity.descricao,
    };
  }

  static mapActivities(activities) {
    if (!activities || !Array.isArray(activities)) return [];

    return activities.map(activity => ({
      id: activity.id,
      text: activity.descricao,
    }));
  }

  static mapRegistrations(inscricoes) {
    if (!inscricoes || !Array.isArray(inscricoes)) return [];

    return inscricoes.map(ie => ({
      type: { id: 1, text: 'Normal' },
      number: ie.inscricao_estadual,
      state: ie.estado?.sigla,
      enabled: ie.ativo,
      status: { text: ie.ativo ? 'Ativa' : 'Inativa' },
    }));
  }
}

// =============================================
// HANDLER PRINCIPAL
// =============================================
export default async function handler(req, res) {
  // Configurar headers de segurança
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Headers de segurança adicionais
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Lidar com preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verificar método HTTP
  if (req.method !== 'GET') {
    console.warn('❌ Método não permitido:', req.method);
    return res.status(405).json({
      error: true,
      message: 'Método não permitido',
    });
  }

  try {
    // Verificar rate limiting
    const clientIP = SecurityMiddleware.getClientIP(req);
    
    if (!SecurityMiddleware.checkRateLimit(clientIP)) {
      console.warn('🚫 Rate limit excedido para IP:', clientIP);
      return res.status(429).json({
        error: true,
        message: 'Limite de requisições excedido. Tente novamente em 1 minuto.',
      });
    }

    const { cnpj } = req.query;

    // Validar parâmetro CNPJ
    if (!cnpj) {
      return res.status(400).json({
        error: true,
        message: 'CNPJ não informado',
      });
    }

    // Sanitizar e validar CNPJ
    const sanitizedCNPJ = SecurityMiddleware.sanitizeCNPJ(cnpj);
    const validation = CNPJValidatorServer.validate(sanitizedCNPJ);

    if (!validation.isValid) {
      return res.status(400).json({
        error: true,
        message: validation.error,
      });
    }

    console.log('🔍 Consultando CNPJ:', validation.cleaned);

    // Verificar cache
    const cachedData = CacheManager.get(validation.cleaned);
    if (cachedData) {
      console.log('⚡ Retornando dados do cache');
      return res.status(200).json({
        error: false,
        data: cachedData,
        cached: true,
      });
    }

    // Fazer requisição para API externa
    const apiData = await ExternalAPIClient.fetchCNPJData(validation.cleaned);

    // Mapear dados para estrutura do frontend
    const mappedData = DataMapper.mapToFrontendStructure(apiData);

    // Validar dados mapeados
    if (!mappedData.taxId) {
      throw new Error('Dados inválidos retornados pela API');
    }

    // Armazenar em cache
    CacheManager.set(validation.cleaned, mappedData);

    // Retornar resposta
    return res.status(200).json({
      error: false,
      data: mappedData,
      cached: false,
    });

  } catch (error) {
    console.error('💥 Erro no handler:', error);

    // Tratamento específico de erros
    let statusCode = 500;
    let errorMessage = 'Erro interno do servidor';

    if (error.message.includes('Timeout')) {
      statusCode = 408;
      errorMessage = 'Timeout na consulta externa';
    } else if (error.message.includes('404') || error.message.includes('não encontrado')) {
      statusCode = 404;
      errorMessage = 'Empresa não encontrada';
    } else if (error.message.includes('429')) {
      statusCode = 429;
      errorMessage = 'API externa com limite excedido';
    } else if (error.message.includes('Failed to fetch') || error.message.includes('Network')) {
      statusCode = 503;
      errorMessage = 'Serviço temporariamente indisponível';
    }

    return res.status(statusCode).json({
      error: true,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

// Limpar cache periodicamente (em produção)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [cnpj, entry] of requestCache.entries()) {
      if (now - entry.timestamp > SECURITY_CONFIG.CACHE_TTL) {
        requestCache.delete(cnpj);
      }
    }
    
    // Limpar rate limit map
    const windowStart = Date.now() - 60000;
    for (const [key, timestamp] of rateLimitMap.entries()) {
      if (timestamp < windowStart) {
        rateLimitMap.delete(key);
      }
    }
  }, 60000); // A cada minuto
}