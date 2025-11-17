// =============================================
// CONFIGURAÇÕES E CONSTANTES
// =============================================
const CONFIG = {
  API_BASE_URL: "/api/cnpj",
  DEBOUNCE_DELAY: 500,
  REQUEST_TIMEOUT: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000
};

// =============================================
// VALIDAÇÃO DE CNPJ (ALGORITMO OFICIAL)
// =============================================
class CNPJValidator {
  static clean(cnpj) {
    return cnpj.replace(/\D/g, "");
  }

  static format(cnpj) {
    const cleaned = this.clean(cnpj);
    if (cleaned.length !== 14) return cnpj;
    
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }

  static validate(cnpj) {
    const cleaned = this.clean(cnpj);
    
    // Verifica tamanho
    if (cleaned.length !== 14) {
      return { isValid: false, error: "CNPJ deve conter 14 dígitos" };
    }

    // Elimina CNPJs inválidos conhecidos
    if (/^(\d)\1+$/.test(cleaned)) {
      return { isValid: false, error: "CNPJ com dígitos repetidos é inválido" };
    }

    // Valida dígitos verificadores
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
      return { isValid: false, error: "Dígito verificador inválido" };
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
      return { isValid: false, error: "Dígito verificador inválido" };
    }

    return { isValid: true, cleaned };
  }
}

// =============================================
// GERENCIADOR DE ESTADO
// =============================================
class AppState {
  constructor() {
    this.currentTheme = localStorage.getItem("theme") || "dark";
    this.lastSearch = null;
    this.isLoading = false;
    this.retryCount = 0;
  }

  setTheme(theme) {
    this.currentTheme = theme;
    localStorage.setItem("theme", theme);
  }

  setLoading(loading) {
    this.isLoading = loading;
  }

  setLastSearch(cnpj) {
    this.lastSearch = cnpj;
  }
}

// =============================================
// GERENCIADOR DE API
// =============================================
class ApiManager {
  static async fetchCNPJ(cnpj) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}?cnpj=${cnpj}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.message || "Erro na consulta");
      }

      return data.data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error("Tempo limite excedido na consulta");
      }
      
      throw error;
    }
  }
}

// =============================================
// FORMATADORES
// =============================================
class Formatters {
  static CNPJ(cnpj) {
    return CNPJValidator.format(cnpj);
  }

  static CEP(cep) {
    if (!cep) return "";
    const cleaned = cep.replace(/\D/g, "");
    return cleaned.replace(/(\d{5})(\d{3})/, "$1-$2");
  }

  static phone(phone) {
    if (!phone) return "";
    const cleaned = phone.replace(/\D/g, "");
    
    if (cleaned.length === 11) {
      return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    } else if (cleaned.length === 10) {
      return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    } else if (cleaned.length === 8) {
      return cleaned.replace(/(\d{4})(\d{4})/, "$1-$2");
    }
    
    return phone;
  }

  static date(dateString) {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("pt-BR");
    } catch (e) {
      console.warn("Erro ao formatar data:", dateString, e);
      return dateString;
    }
  }

  static dateTime(dateTimeString) {
    if (!dateTimeString) return "";
    try {
      const date = new Date(dateTimeString);
      return date.toLocaleString("pt-BR");
    } catch (e) {
      console.warn("Erro ao formatar data/hora:", dateTimeString, e);
      return dateTimeString;
    }
  }

  static currency(value) {
    if (!value) return "0,00";
    try {
      const number = typeof value === 'string' ? 
        parseFloat(value.replace('R$', '').replace('.', '').replace(',', '.')) : 
        parseFloat(value);
      
      return number.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch (e) {
      console.warn("Erro ao formatar moeda:", value, e);
      return "0,00";
    }
  }
}

// =============================================
// GERENCIADOR DE UI
// =============================================
class UIManager {
  constructor() {
    this.elements = this.initializeElements();
    this.bindEvents();
  }

  initializeElements() {
    return {
      cnpjInput: document.getElementById("cnpjInput"),
      searchBtn: document.getElementById("searchBtn"),
      errorMessage: document.getElementById("errorMessage"),
      loading: document.getElementById("loading"),
      result: document.getElementById("result"),
      partnersCard: document.getElementById("partnersCard"),
      partnersList: document.getElementById("partnersList"),
      themeToggle: document.getElementById("themeToggle"),
      completeData: document.getElementById("completeData"),
      
      // Elementos de dados
      companyName: document.getElementById("companyName"),
      tradeName: document.getElementById("tradeName"),
      cnpj: document.getElementById("cnpj"),
      ie: document.getElementById("ie"),
      status: document.getElementById("status"),
      address: document.getElementById("address"),
      cnae: document.getElementById("cnae"),
      phones: document.getElementById("phones"),
      email: document.getElementById("email")
    };
  }

  bindEvents() {
    // Evento de pesquisa
    this.elements.searchBtn.addEventListener("click", () => this.handleSearch());
    
    // Enter no input
    this.elements.cnpjInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.handleSearch();
      }
    });

    // Input com debounce e formatação automática
    this.elements.cnpjInput.addEventListener("input", (e) => {
      this.handleInputFormat(e);
    });

    // Toggle de tema
    this.elements.themeToggle.addEventListener("click", () => this.toggleTheme());

    // Tabs
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Focar no input ao carregar
    this.elements.cnpjInput.focus();
  }

  handleInputFormat(e) {
    const input = e.target;
    const cursorPosition = input.selectionStart;
    const originalLength = input.value.length;
    
    // Formata o CNPJ enquanto digita
    let value = input.value.replace(/\D/g, "");
    
    if (value.length <= 14) {
      if (value.length > 12) {
        value = value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
      } else if (value.length > 8) {
        value = value.replace(/(\d{2})(\d{3})(\d{3})(\d{0,4})/, "$1.$2.$3/$4");
      } else if (value.length > 5) {
        value = value.replace(/(\d{2})(\d{3})(\d{0,3})/, "$1.$2.$3");
      } else if (value.length > 2) {
        value = value.replace(/(\d{2})(\d{0,3})/, "$1.$2");
      }
    } else {
      value = value.substring(0, 14);
      value = value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    }
    
    input.value = value;
    
    // Mantém a posição do cursor
    const newLength = input.value.length;
    const lengthDiff = newLength - originalLength;
    const newCursorPosition = cursorPosition + lengthDiff;
    
    input.setSelectionRange(newCursorPosition, newCursorPosition);
  }

  async handleSearch() {
    const cnpjValue = this.elements.cnpjInput.value;
    
    this.clearError();
    this.hideResult();

    const validation = CNPJValidator.validate(cnpjValue);
    
    if (!validation.isValid) {
      this.showError(validation.error);
      return;
    }

    await this.searchCNPJ(validation.cleaned);
  }

  async searchCNPJ(cnpj) {
    this.showLoading();
    this.disableSearchButton(true);
    appState.setLoading(true);

    try {
      console.log("🔍 Iniciando consulta para CNPJ:", cnpj);
      
      const data = await ApiManager.fetchCNPJ(cnpj);
      console.log("✅ Dados recebidos com sucesso");

      this.displayData(data);
      appState.setLastSearch(cnpj);
      appState.retryCount = 0;
      
    } catch (error) {
      console.error("💥 Erro na consulta:", error);
      
      if (appState.retryCount < CONFIG.MAX_RETRIES) {
        appState.retryCount++;
        console.log(`🔄 Tentativa ${appState.retryCount} de ${CONFIG.MAX_RETRIES}`);
        
        await this.delay(CONFIG.RETRY_DELAY);
        return this.searchCNPJ(cnpj);
      }
      
      this.showError(this.getErrorMessage(error));
      appState.retryCount = 0;
    } finally {
      this.hideLoading();
      this.disableSearchButton(false);
      appState.setLoading(false);
    }
  }

  getErrorMessage(error) {
    const message = error.message || "Erro desconhecido";
    
    if (message.includes("Tempo limite")) {
      return "A consulta demorou muito tempo. Tente novamente.";
    } else if (message.includes("404") || message.includes("não encontrada")) {
      return "Empresa não encontrada para o CNPJ informado.";
    } else if (message.includes("429") || message.includes("Limite")) {
      return "Limite de consultas excedido. Tente novamente em alguns instantes.";
    } else if (message.includes("Failed to fetch")) {
      return "Erro de conexão. Verifique sua internet e tente novamente.";
    }
    
    return `Erro: ${message}`;
  }

  displayData(data) {
    if (!data || !data.taxId) {
      this.showError("Dados da empresa não encontrados ou inválidos");
      return;
    }

    console.log("📊 Exibindo dados:", data);

    // Dados básicos
    this.setElementText(this.elements.companyName, data.company?.name);
    this.setElementText(this.elements.tradeName, data.alias || data.company?.name);
    this.setElementText(this.elements.cnpj, Formatters.CNPJ(data.taxId));
    
    // Inscrição Estadual
    const iePrincipal = this.getPrincipalIE(data.registrations);
    this.setElementText(this.elements.ie, iePrincipal);

    // Situação cadastral
    const statusText = data.status?.text || "Não informado";
    this.setElementText(this.elements.status, statusText);
    this.elements.status.className = `value ${statusText.toLowerCase().includes("ativa") ? "status-active" : "status-inactive"}`;

    // Endereço
    const address = this.formatAddress(data.address);
    this.setElementText(this.elements.address, address);

    // CNAE Principal
    this.setElementText(this.elements.cnae, data.mainActivity?.text);

    // Telefones
    const phones = this.formatPhones(data.phones);
    this.setElementText(this.elements.phones, phones);

    // E-mail
    const email = this.getPrimaryEmail(data.emails);
    this.setElementText(this.elements.email, email);

    // Sócios e dados completos
    this.displayPartners(data.company?.members);
    this.displayCompleteData(data);

    this.showResult();
  }

  getPrincipalIE(registrations) {
    if (!registrations || !Array.isArray(registrations)) return "Não informado";

    const ieNormal = registrations.find(reg => reg.type?.id === 1);
    if (ieNormal) return `${ieNormal.number} (${ieNormal.state})`;

    const primeira = registrations[0];
    if (primeira) return `${primeira.number} (${primeira.state})`;

    return "Não informado";
  }

  formatAddress(address) {
    if (!address) return "Não informado";

    const addressParts = [
      address.street,
      address.number,
      address.details,
      address.district,
      address.city,
      address.state
    ].filter(part => part && part.trim() !== "");

    const formattedAddress = addressParts.join(", ");
    const zipCode = address.zip ? ` - CEP: ${Formatters.CEP(address.zip)}` : "";

    return formattedAddress + zipCode || "Não informado";
  }

  formatPhones(phones) {
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return "Não informado";
    }

    const formattedPhones = phones.map(phone => {
      if (phone.area && phone.number) {
        return Formatters.phone(`${phone.area}${phone.number}`);
      }
      return phone.number || "";
    }).filter(phone => phone !== "");

    return formattedPhones.join(", ") || "Não informado";
  }

  getPrimaryEmail(emails) {
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return "Não informado";
    }

    const corporateEmail = emails.find(email => email.ownership === "CORPORATE");
    const firstEmail = emails[0];

    return (corporateEmail || firstEmail)?.address || "Não informado";
  }

  displayPartners(members) {
    this.elements.partnersList.innerHTML = "";

    if (!members || members.length === 0) {
      this.elements.partnersCard.classList.add("hidden");
      return;
    }

    console.log("👥 Exibindo sócios:", members);

    // Ordenar por data (mais recente primeiro)
    const sortedMembers = [...members].sort((a, b) => {
      try {
        const dateA = a.since ? new Date(a.since) : new Date(0);
        const dateB = b.since ? new Date(b.since) : new Date(0);
        return dateB - dateA;
      } catch (e) {
        return 0;
      }
    });

    // Limitar a 6 sócios na aba principal
    const displayedMembers = sortedMembers.slice(0, 6);

    displayedMembers.forEach(member => {
      const partnerItem = this.createPartnerElement(member);
      this.elements.partnersList.appendChild(partnerItem);
    });

    // Mostrar contador se houver mais sócios
    if (sortedMembers.length > 6) {
      const morePartners = document.createElement("div");
      morePartners.className = "partner-more";
      morePartners.textContent = `+ ${sortedMembers.length - 6} outros sócios...`;
      this.elements.partnersList.appendChild(morePartners);
    }

    this.elements.partnersCard.classList.remove("hidden");
  }

  createPartnerElement(member) {
    const partnerItem = document.createElement("div");
    partnerItem.className = "partner-item";
    partnerItem.setAttribute("role", "listitem");

    const partnerName = document.createElement("div");
    partnerName.className = "partner-name";
    partnerName.textContent = member.person?.name || "Nome não informado";

    const partnerRole = document.createElement("div");
    partnerRole.className = "partner-document";
    partnerRole.textContent = `Cargo: ${member.role?.text || "Não informado"}`;

    const partnerSince = document.createElement("div");
    partnerSince.className = "partner-qualification";
    partnerSince.textContent = `Desde: ${Formatters.date(member.since) || "Data não informada"}`;

    const partnerAge = document.createElement("div");
    partnerAge.className = "partner-qualification";
    partnerAge.textContent = `Faixa Etária: ${member.person?.age || "Não informada"}`;

    partnerItem.appendChild(partnerName);
    partnerItem.appendChild(partnerRole);
    partnerItem.appendChild(partnerSince);
    partnerItem.appendChild(partnerAge);

    return partnerItem;
  }

  displayCompleteData(data) {
    this.elements.completeData.innerHTML = "";

    if (!data) {
      this.showEmptyState(this.elements.completeData, "Nenhum dado completo disponível");
      return;
    }

    const sections = [
      this.createBasicInfoSection(data),
      this.createCompanyInfoSection(data),
      this.createAddressSection(data),
      this.createContactSection(data),
      this.createActivitiesSection(data),
      this.createRegistrationsSection(data),
      this.createPartnersSection(data)
    ];

    sections.forEach(section => {
      if (section) {
        this.elements.completeData.appendChild(section);
      }
    });

    if (this.elements.completeData.children.length === 0) {
      this.showEmptyState(this.elements.completeData, "Nenhum dado completo disponível");
    }
  }

  createBasicInfoSection(data) {
    const fields = [
      { label: "CNPJ", value: Formatters.CNPJ(data.taxId) },
      { label: "Razão Social", value: data.company?.name },
      { label: "Nome Fantasia", value: data.alias },
      { label: "Data de Abertura", value: Formatters.date(data.founded) },
      { label: "Data da Última Atualização", value: Formatters.dateTime(data.updated) },
      { label: "Situação Cadastral", value: data.status?.text },
      { label: "Data da Situação", value: Formatters.date(data.statusDate) },
      { label: "Matriz/Filial", value: data.head ? "Matriz" : "Filial" }
    ];

    return this.createSection("Informações Básicas", fields);
  }

  createCompanyInfoSection(data) {
    const fields = [];

    if (data.company?.nature) {
      fields.push({
        label: "Natureza Jurídica",
        value: `${data.company.nature.id} - ${data.company.nature.text}`
      });
    }

    if (data.company?.size) {
      fields.push({
        label: "Porte da Empresa",
        value: `${data.company.size.text} (${data.company.size.acronym})`
      });
    }

    if (data.company?.equity) {
      fields.push({
        label: "Capital Social",
        value: `R$ ${Formatters.currency(data.company.equity)}`
      });
    }

    // Regimes Especiais
    const regimes = [];
    if (data.company?.simples?.optant) {
      regimes.push(`Simples Nacional desde ${Formatters.date(data.company.simples.since)}`);
    }
    if (data.company?.simei?.optant) {
      regimes.push(`MEI desde ${Formatters.date(data.company.simei.since)}`);
    }
    if (regimes.length > 0) {
      fields.push({ label: "Regimes Especiais", value: regimes });
    }

    return fields.length > 0 ? this.createSection("Informações da Empresa", fields) : null;
  }

  createAddressSection(data) {
    if (!data.address) return null;

    const fields = [
      { label: "Logradouro", value: data.address.street },
      { label: "Número", value: data.address.number },
      { label: "Complemento", value: data.address.details },
      { label: "Bairro", value: data.address.district },
      { label: "Cidade", value: data.address.city },
      { label: "Estado", value: data.address.state },
      { label: "CEP", value: Formatters.CEP(data.address.zip) },
      { label: "País", value: data.address.country?.name },
      { label: "Código Município", value: data.address.municipality }
    ].filter(field => field.value);

    return fields.length > 0 ? this.createSection("Endereço", fields) : null;
  }

  createContactSection(data) {
    const fields = [];

    // Telefones
    if (data.phones && data.phones.length > 0) {
      const phones = data.phones.map(phone => {
        const tipo = phone.type === "LANDLINE" ? "Fixo" : "Celular";
        return `${tipo}: ${phone.area && phone.number ? 
          Formatters.phone(`${phone.area}${phone.number}`) : 
          phone.number}`;
      }).filter(phone => !phone.includes("undefined"));
      
      if (phones.length > 0) {
        fields.push({ label: "Telefones", value: phones });
      }
    }

    // E-mails
    if (data.emails && data.emails.length > 0) {
      const emails = data.emails.map(email => {
        const tipo = email.ownership === "CORPORATE" ? "Corporativo" : "Outro";
        return `${tipo}: ${email.address}`;
      });
      fields.push({ label: "E-mails", value: emails });
    }

    return fields.length > 0 ? this.createSection("Contatos", fields) : null;
  }

  createActivitiesSection(data) {
    const fields = [];

    if (data.mainActivity) {
      fields.push({
        label: "CNAE Principal",
        value: `${data.mainActivity.id} - ${data.mainActivity.text}`
      });
    }

    if (data.sideActivities && data.sideActivities.length > 0) {
      const secondaryActivities = data.sideActivities.map(
        activity => `${activity.id} - ${activity.text}`
      );
      fields.push({ label: "CNAEs Secundários", value: secondaryActivities });
    }

    return fields.length > 0 ? this.createSection("Atividades Econômicas", fields) : null;
  }

  createRegistrationsSection(data) {
    const fields = [];

    if (data.registrations && data.registrations.length > 0) {
      const ies = data.registrations.map(reg => {
        const status = reg.enabled ? "✅" : "❌";
        return `${status} ${reg.number} - ${reg.state} (${reg.type?.text}) - ${reg.status?.text}`;
      });
      fields.push({ label: "Inscrições Estaduais", value: ies });
    }

    // SUFRAMA
    if (data.suframa && data.suframa.length > 0) {
      const suframaItems = data.suframa.map(suf => {
        const status = suf.approved ? "✅ Aprovado" : "❌ Pendente";
        return `Nº: ${suf.number} - ${status} - Desde: ${Formatters.date(suf.since)}`;
      });
      fields.push({ label: "Registro SUFRAMA", value: suframaItems });

      // Incentivos fiscais da SUFRAMA
      if (data.suframa[0].incentives && data.suframa[0].incentives.length > 0) {
        const incentivos = data.suframa[0].incentives.map(
          inc => `${inc.tribute}: ${inc.benefit} - ${inc.purpose}`
        );
        fields.push({ label: "Incentivos Fiscais SUFRAMA", value: incentivos });
      }
    }

    return fields.length > 0 ? this.createSection("Registros e Inscrições", fields) : null;
  }

  createPartnersSection(data) {
    if (!data.company?.members || data.company.members.length === 0) return null;

    const socios = data.company.members.map(member => {
      const since = member.since ? ` desde ${Formatters.date(member.since)}` : "";
      return `${member.person?.name} - ${member.role?.text}${since}`;
    });

    return this.createSection("Sócios e Administradores", [
      { label: "Lista Completa", value: socios }
    ]);
  }

  createSection(title, fields) {
    const validFields = fields.filter(field => 
      field.value !== undefined && 
      field.value !== null && 
      field.value !== "" && 
      field.value !== "Não informado" &&
      !(Array.isArray(field.value) && field.value.length === 0)
    );

    if (validFields.length === 0) return null;

    const section = document.createElement("div");
    section.className = "info-section";

    const sectionTitle = document.createElement("h3");
    sectionTitle.className = "section-title";
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    validFields.forEach(field => {
      const item = this.createInfoItem(field.label, field.value);
      if (item) section.appendChild(item);
    });

    return section;
  }

  createInfoItem(label, value) {
    const item = document.createElement("div");
    item.className = "info-item";

    const labelSpan = document.createElement("span");
    labelSpan.className = "label";
    labelSpan.textContent = label;

    const valueSpan = document.createElement("span");
    valueSpan.className = "value";

    if (Array.isArray(value)) {
      valueSpan.innerHTML = value.map(item => `• ${this.escapeHtml(item)}`).join("<br>");
    } else {
      valueSpan.textContent = String(value);
    }

    item.appendChild(labelSpan);
    item.appendChild(valueSpan);
    return item;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showEmptyState(container, message) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📄</div>
        <h3>Sem dados</h3>
        <p>${message}</p>
      </div>
    `;
  }

  setElementText(element, text) {
    element.textContent = text || "Não informado";
  }

  // Controles de UI
  showLoading() {
    this.elements.loading.classList.remove("hidden");
    this.elements.loading.setAttribute("aria-busy", "true");
  }

  hideLoading() {
    this.elements.loading.classList.add("hidden");
    this.elements.loading.setAttribute("aria-busy", "false");
  }

  showResult() {
    this.elements.result.classList.remove("hidden");
    this.elements.result.setAttribute("aria-live", "polite");
    
    // Focar na primeira aba para acessibilidade
    const firstTab = document.querySelector('.tab-button');
    if (firstTab) firstTab.focus();
  }

  hideResult() {
    this.elements.result.classList.add("hidden");
  }

  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.elements.errorMessage.classList.remove("hidden");
    
    // Focar na mensagem de erro para acessibilidade
    this.elements.errorMessage.focus();
  }

  clearError() {
    this.elements.errorMessage.textContent = "";
    this.elements.errorMessage.classList.add("hidden");
  }

  disableSearchButton(disabled) {
    this.elements.searchBtn.disabled = disabled;
    const buttonText = this.elements.searchBtn.querySelector(".button-text");
    const buttonLoading = this.elements.searchBtn.querySelector(".button-loading");

    if (disabled) {
      buttonText.classList.add("hidden");
      buttonLoading.classList.remove("hidden");
      this.elements.searchBtn.setAttribute("aria-label", "Consultando...");
    } else {
      buttonText.classList.remove("hidden");
      buttonLoading.classList.add("hidden");
      this.elements.searchBtn.setAttribute("aria-label", "Pesquisar CNPJ");
    }
  }

  switchTab(tabName) {
    // Atualizar botões das tabs
    document.querySelectorAll(".tab-button").forEach(button => {
      button.classList.remove("active");
      button.setAttribute("aria-selected", "false");
    });
    
    const activeButton = document.querySelector(`[data-tab="${tabName}"]`);
    activeButton.classList.add("active");
    activeButton.setAttribute("aria-selected", "true");

    // Atualizar conteúdo das tabs
    document.querySelectorAll(".tab-pane").forEach(pane => {
      pane.classList.remove("active");
    });
    
    const activePane = document.getElementById(`tab-${tabName}`);
    activePane.classList.add("active");
  }

  toggleTheme() {
    const body = document.body;
    const isDarkMode = body.classList.contains("dark-mode");
    const themeIcon = this.elements.themeToggle.querySelector(".theme-icon");

    if (isDarkMode) {
      body.classList.remove("dark-mode");
      themeIcon.textContent = "🌙";
      appState.setTheme("light");
    } else {
      body.classList.add("dark-mode");
      themeIcon.textContent = "☀️";
      appState.setTheme("dark");
    }

    // Anúncio para leitores de tela
    this.announceToScreenReader(`Modo ${isDarkMode ? 'claro' : 'escuro'} ativado`);
  }

  announceToScreenReader(message) {
    const announcer = document.getElementById('aria-announcer') || this.createAriaAnnouncer();
    announcer.textContent = message;
  }

  createAriaAnnouncer() {
    const announcer = document.createElement('div');
    announcer.id = 'aria-announcer';
    announcer.className = 'sr-only';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(announcer);
    return announcer;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================
// INICIALIZAÇÃO DA APLICAÇÃO
// =============================================
let appState;
let uiManager;

function initializeApp() {
  console.log("🚀 Inicializando CNPJ Finder...");
  
  appState = new AppState();
  uiManager = new UIManager();
  
  loadSavedTheme();
  setupServiceWorker();
  
  console.log("✅ Aplicação inicializada com sucesso");
}

function loadSavedTheme() {
  const savedTheme = localStorage.getItem("theme");
  const body = document.body;
  const themeIcon = document.querySelector(".theme-icon");

  if (savedTheme === "light") {
    body.classList.remove("dark-mode");
    themeIcon.textContent = "🌙";
  } else {
    body.classList.add("dark-mode");
    themeIcon.textContent = "☀️";
  }
}

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('✅ Service Worker registrado:', registration);
        })
        .catch(error => {
          console.log('❌ Falha no Service Worker:', error);
        });
    });
  }
}

// Inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Exportar para testes (se necessário)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CNPJValidator, Formatters, ApiManager };
}