/**
 * Comunidade Resiliente - Controlador Principal Frontend (cp2p Modern UI)
 * Experiência fluida, moderna e familiar sem marcas ou elementos proprietários.
 * Suporta canais, mensagens ricas, anexos chunked, previews de links,
 * encaminhamento, reações, convites com QR Code SVG, outbox e modo offline.
 */

class AppController {
  constructor() {
    this.state = {
      user: null,
      token: localStorage.getItem('cp2p_token') || null,
      communities: [],
      channels: [],
      activeCommunityId: 'geral',
      activeChannelId: 'avisos',
      messages: [],
      filteredMessages: [],
      activeFilter: 'all',
      searchQuery: '',
      network: null,
      pendingOutboxCount: 0,
      replyingTo: null,
      stagedAttachment: null, // { file, base64, name, size, type, isImage }
      forwardingMsg: null,
      currentTheme: localStorage.getItem('cp2p_theme') || 'dark'
    };

    this.liveSocket = null;
    this.reconnectTimer = null;

    window.cp2pApp = this;
    this.applyTheme(this.state.currentTheme);
    this.initElements();
    this.attachEventListeners();
    this.registerServiceWorker();
    this.connectLiveWebSocket();
    this.loadInitialData();
  }

  applyTheme(theme) {
    document.body.classList.remove('theme-light', 'theme-contrast');
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else if (theme === 'contrast') {
      document.body.classList.add('theme-contrast');
    }
    this.state.currentTheme = theme;
    localStorage.setItem('cp2p_theme', theme);
  }

  cycleTheme() {
    if (this.state.currentTheme === 'dark') {
      this.applyTheme('light');
      this.showToast('Tema Claro ativado');
    } else if (this.state.currentTheme === 'light') {
      this.applyTheme('contrast');
      this.showToast('Tema Alto Contraste ativado');
    } else {
      this.applyTheme('dark');
      this.showToast('Tema Escuro ativado');
    }
  }

  initElements() {
    // Dock Lateral de Comunidades
    this.communitiesContainer = document.getElementById('cp2p-communities-container');
    this.btnOpenCreateComm = document.getElementById('btn-open-create-comm');
    this.btnOpenJoinComm = document.getElementById('btn-open-join-comm');
    this.railMeshDot = document.getElementById('rail-mesh-dot');
    this.railUserAvatar = document.getElementById('rail-user-avatar');
    this.btnQuickStatus = document.getElementById('btn-quick-status');
    this.btnUserProfileQuick = document.getElementById('btn-user-profile-quick');

    // Sidebar de Canais & Navegação
    this.activeCommName = document.getElementById('cp2p-active-comm-name');
    this.activeCommRole = document.getElementById('cp2p-active-comm-role');
    this.btnInviteActiveComm = document.getElementById('btn-invite-active-comm');
    this.btnOpenCreateChannel = document.getElementById('btn-open-create-channel');
    this.btnCommMenu = document.getElementById('btn-comm-menu');
    this.searchInput = document.getElementById('cp2p-search-input');
    this.channelsList = document.getElementById('cp2p-channels-list');
    this.sidebarUserAvatar = document.getElementById('sidebar-user-avatar');
    this.sidebarUserName = document.getElementById('sidebar-user-name');
    this.sidebarUserRole = document.getElementById('sidebar-user-role');
    this.btnThemeToggle = document.getElementById('btn-theme-toggle');
    this.btnCopyPubkey = document.getElementById('btn-copy-pubkey');

    // Chat Header & Área Principal
    this.chatHeaderIcon = document.getElementById('chat-header-icon');
    this.chatHeaderTitle = document.getElementById('chat-header-title');
    this.chatHeaderSubtitle = document.getElementById('chat-header-subtitle');
    this.chatStatusDot = document.getElementById('chat-status-dot');
    this.cp2pNetworkBtnLabel = document.getElementById('cp2p-network-btn-label');
    this.btnOpenNetworkDashboard = document.getElementById('btn-open-network-dashboard');
    this.btnOpenAudit = document.getElementById('btn-open-audit');
    this.btnOpenStorageSettings = document.getElementById('btn-open-storage-settings');
    this.btnOpenAdmin = document.getElementById('btn-open-admin');
    this.btnAuthAction = document.getElementById('btn-auth-action');

    // Banners Informativos e Fixados
    this.pinnedBar = document.getElementById('cp2p-pinned-bar');
    this.pinnedSnippetText = document.getElementById('pinned-snippet-text');
    this.btnJumpPinned = document.getElementById('btn-jump-pinned');
    this.btnUnpinActive = document.getElementById('btn-unpin-active');
    this.vpsOfflineBanner = document.getElementById('vps-offline-banner');
    this.outboxPendingBanner = document.getElementById('outbox-pending-banner');
    this.outboxCountLabel = document.getElementById('outbox-count-label');
    this.btnFlushOutbox = document.getElementById('btn-flush-outbox');

    // Feed de Mensagens
    this.chatScroll = document.getElementById('cp2p-chat-scroll');
    this.messagesStream = document.getElementById('messages-stream');
    this.emptyStateView = document.getElementById('empty-state-view');

    // Composer
    this.adminComposer = document.getElementById('admin-composer');
    this.memberReadonlyBar = document.getElementById('member-readonly-bar');
    this.composerInput = document.getElementById('composer-input');
    this.btnAttachFile = document.getElementById('btn-attach-file');
    this.fileAttachmentInput = document.getElementById('file-attachment-input');
    this.btnQuickEmoji = document.getElementById('btn-quick-emoji');
    this.btnPublish = document.getElementById('btn-send-announcement');
    
    // Composer Previews (Reply & Attachment)
    this.composerReplyPreview = document.getElementById('composer-reply-preview');
    this.replyPreviewAuthor = document.getElementById('reply-preview-author');
    this.replyPreviewText = document.getElementById('reply-preview-text');
    this.btnCancelReply = document.getElementById('btn-cancel-reply');

    this.composerAttachmentPreview = document.getElementById('composer-attachment-preview');
    this.attachmentPreviewName = document.getElementById('attachment-preview-name');
    this.attachmentPreviewSize = document.getElementById('attachment-preview-size');
    this.btnRemoveAttachment = document.getElementById('btn-remove-attachment');
  }

  attachEventListeners() {
    // Alternância de Tema
    if (this.btnThemeToggle) {
      this.btnThemeToggle.addEventListener('click', () => this.cycleTheme());
    }

    // Abertura de Modais de Comunidade
    if (this.btnOpenCreateComm) {
      this.btnOpenCreateComm.addEventListener('click', () => this.openModal('modal-create-comm'));
    }
    if (this.btnOpenJoinComm) {
      this.btnOpenJoinComm.addEventListener('click', () => this.openModal('modal-join-comm'));
    }
    if (this.btnInviteActiveComm) {
      this.btnInviteActiveComm.addEventListener('click', () => this.openInviteModal());
    }
    if (this.btnOpenCreateChannel) {
      this.btnOpenCreateChannel.addEventListener('click', () => this.openModal('modal-create-channel'));
    }

    // Abertura de Modais do Header
    if (this.btnOpenNetworkDashboard) {
      this.btnOpenNetworkDashboard.addEventListener('click', () => this.openNetworkDashboard());
    }
    if (this.btnQuickStatus) {
      this.btnQuickStatus.addEventListener('click', () => this.openNetworkDashboard());
    }
    if (this.btnOpenAudit) {
      this.btnOpenAudit.addEventListener('click', () => this.openAuditModal());
    }
    if (this.btnOpenStorageSettings) {
      this.btnOpenStorageSettings.addEventListener('click', () => this.openStorageModal());
    }
    if (this.btnOpenAdmin) {
      this.btnOpenAdmin.addEventListener('click', () => this.openNetworkDashboard('tab-members'));
    }
    if (this.btnAuthAction) {
      this.btnAuthAction.addEventListener('click', () => this.openModal('modal-auth-profile'));
    }
    if (this.btnUserProfileQuick) {
      this.btnUserProfileQuick.addEventListener('click', () => this.openModal('modal-auth-profile'));
    }

    // Copiar Chave Pública
    if (this.btnCopyPubkey) {
      this.btnCopyPubkey.addEventListener('click', () => {
        if (this.state.user && this.state.user.publicKey) {
          navigator.clipboard.writeText(this.state.user.publicKey);
          this.showToast('Chave pública Ed25519 copiada!');
        } else {
          this.showToast('Faça login para copiar sua chave.');
        }
      });
    }

    // Busca e Filtros
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.state.searchQuery = e.target.value.toLowerCase().trim();
        this.applyFilterAndSearch();
      });
    }

    document.querySelectorAll('.cp2p-filter-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.cp2p-filter-chip').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.state.activeFilter = e.currentTarget.getAttribute('data-filter') || 'all';
        this.applyFilterAndSearch();
      });
    });

    // Submissão de Formulários de Modais
    const btnSubmitCreateComm = document.getElementById('btn-submit-create-comm');
    if (btnSubmitCreateComm) btnSubmitCreateComm.addEventListener('click', () => this.handleCreateCommunity());

    const btnSubmitJoinComm = document.getElementById('btn-submit-join-comm');
    if (btnSubmitJoinComm) btnSubmitJoinComm.addEventListener('click', () => this.handleJoinCommunity());

    const btnSubmitCreateChannel = document.getElementById('btn-submit-create-channel');
    if (btnSubmitCreateChannel) btnSubmitCreateChannel.addEventListener('click', () => this.handleCreateChannel());

    const btnSaveStorageSettings = document.getElementById('btn-save-storage-settings');
    if (btnSaveStorageSettings) btnSaveStorageSettings.addEventListener('click', () => this.handleSaveStorageSettings());

    const btnSubmitForward = document.getElementById('btn-submit-forward');
    if (btnSubmitForward) btnSubmitForward.addEventListener('click', () => this.handleSubmitForward());

    const btnCopyInviteLink = document.getElementById('btn-copy-invite-link');
    if (btnCopyInviteLink) btnCopyInviteLink.addEventListener('click', () => this.copyInviteLink());

    const btnShareNative = document.getElementById('btn-share-native');
    if (btnShareNative) btnShareNative.addEventListener('click', () => this.shareNativeInvite());

    const btnFlushOutbox = document.getElementById('btn-flush-outbox');
    if (btnFlushOutbox) btnFlushOutbox.addEventListener('click', () => this.flushOutboxNow());

    // Cadastro Simples & Pseudônimo
    const btnEnterCommunity = document.getElementById('btn-enter-community');
    if (btnEnterCommunity) btnEnterCommunity.addEventListener('click', () => this.handleSimplePseudonymRegister());

    const pseudonymInput = document.getElementById('auth-pseudonym');
    if (pseudonymInput) {
      let debounceTimer = null;
      pseudonymInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => this.checkPseudonymAvailability(e.target.value), 350);
      });
      pseudonymInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleSimplePseudonymRegister();
      });
    }

    const btnToggleRecovery = document.getElementById('btn-toggle-recovery-view');
    if (btnToggleRecovery) {
      btnToggleRecovery.addEventListener('click', () => {
        document.getElementById('auth-simple-form-view').style.display = 'none';
        document.getElementById('auth-recovery-view').style.display = 'block';
      });
    }

    const btnBackToSimple = document.getElementById('btn-back-to-simple-auth');
    if (btnBackToSimple) {
      btnBackToSimple.addEventListener('click', () => {
        document.getElementById('auth-recovery-view').style.display = 'none';
        document.getElementById('auth-simple-form-view').style.display = 'block';
      });
    }

    const btnSubmitRecovery = document.getElementById('btn-submit-recovery');
    if (btnSubmitRecovery) btnSubmitRecovery.addEventListener('click', () => this.handleRecoverAccount());

    const btnCopyRecoveryCode = document.getElementById('btn-copy-recovery-code');
    if (btnCopyRecoveryCode) {
      btnCopyRecoveryCode.addEventListener('click', () => {
        const code = document.getElementById('display-created-recovery-code').textContent.trim();
        navigator.clipboard.writeText(code).then(() => this.showToast('Código de recuperação copiado!'));
      });
    }

    const btnProceedAfterReg = document.getElementById('btn-proceed-after-register');
    if (btnProceedAfterReg) {
      btnProceedAfterReg.addEventListener('click', () => {
        this.closeModal('modal-auth-profile');
        this.loadInitialData();
      });
    }

    // Modal de Pareamento de Dispositivos
    const btnOpenPairing = document.getElementById('btn-open-pairing');
    if (btnOpenPairing) {
      btnOpenPairing.addEventListener('click', () => {
        this.openModal('modal-device-pairing');
        this.loadPairingCodeAndDevices();
      });
    }

    // Anexo de Arquivos no Composer
    if (this.btnAttachFile) {
      this.btnAttachFile.addEventListener('click', () => this.fileAttachmentInput.click());
    }
    if (this.fileAttachmentInput) {
      this.fileAttachmentInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }
    if (this.btnRemoveAttachment) {
      this.btnRemoveAttachment.addEventListener('click', () => this.clearAttachment());
    }
    if (this.btnCancelReply) {
      this.btnCancelReply.addEventListener('click', () => this.clearReply());
    }

    // Envio de Mensagem
    if (this.btnPublish) {
      this.btnPublish.addEventListener('click', () => this.sendMessage());
    }
    if (this.composerInput) {
      this.composerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // Drag and Drop e Colar da Área de Transferência
    window.addEventListener('paste', (e) => this.handleClipboardPaste(e));
    
    const dropTarget = document.getElementById('cp2p-chat-pane');
    if (dropTarget) {
      dropTarget.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropTarget.style.outline = '2px dashed var(--cp2p-primary)';
      });
      dropTarget.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropTarget.style.outline = 'none';
      });
      dropTarget.addEventListener('drop', (e) => {
        e.preventDefault();
        dropTarget.style.outline = 'none';
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          this.stageFile(e.dataTransfer.files[0]);
        }
      });
    }

    // Fechar Modais
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-close');
        this.closeModal(id);
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });

    // Abas de Modais (ex: Dashboard de Rede)
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const parent = e.currentTarget.closest('.modal-body');
        if (!parent) return;
        parent.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        parent.querySelectorAll('.tab-content').forEach(p => p.style.display = 'none');
        e.currentTarget.classList.add('active');
        const tabId = e.currentTarget.getAttribute('data-tab');
        const target = document.getElementById(tabId);
        if (target) target.style.display = 'block';
      });
    });
  }

  // --- CARREGAMENTO INICIAL DE DADOS ---
  async loadInitialData() {
    await this.fetchCurrentUser();
    await this.loadCommunities();
    await this.loadChannels();
    await this.loadMessages();
    await this.loadOutboxStatus();
    await this.loadNetworkOverview();
  }

  async fetchCurrentUser() {
    try {
      const res = await this.apiGet('/api/auth/me');
      if (res && res.user) {
        this.state.user = res.user;
        this.updateUserUI(res.user);
      } else {
        this.openModal('modal-auth-profile');
      }
    } catch (e) {
      if (!this.state.user) {
        this.openModal('modal-auth-profile');
      }
    }
  }

  updateUserUI(user) {
    if (!user) return;
    this.sidebarUserName.textContent = user.username;
    this.sidebarUserRole.textContent = user.role;
    const initial = user.username ? user.username.charAt(0).toUpperCase() : '?';
    this.sidebarUserAvatar.textContent = initial;
    this.railUserAvatar.textContent = initial;
    this.btnAuthAction.textContent = user.username;
    this.updateComposerPermissions();
  }

  // --- COMUNIDADES ---
  async loadCommunities() {
    try {
      const res = await this.apiGet('/api/communities');
      this.state.communities = (res && res.communities) ? res.communities : [];
      this.renderCommunitiesList();
    } catch (e) {
      console.warn('Erro ao carregar comunidades:', e);
    }
  }

  renderCommunitiesList() {
    if (!this.communitiesContainer) return;
    this.communitiesContainer.innerHTML = '';

    this.state.communities.forEach(c => {
      const item = document.createElement('div');
      item.className = `cp2p-comm-item ${c.id === this.state.activeCommunityId ? 'active' : ''}`;
      item.title = c.name;
      item.textContent = c.name.charAt(0).toUpperCase();

      if (c.messageCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = c.messageCount > 99 ? '99+' : c.messageCount;
        item.appendChild(badge);
      }

      item.addEventListener('click', () => this.selectCommunity(c.id));
      this.communitiesContainer.appendChild(item);
    });

    const activeComm = this.state.communities.find(c => c.id === this.state.activeCommunityId);
    if (activeComm) {
      this.activeCommName.textContent = activeComm.name;
      this.activeCommRole.textContent = activeComm.isAdmin ? 'Admin' : 'Membro';
    }
  }

  selectCommunity(communityId) {
    this.state.activeCommunityId = communityId;
    this.state.activeChannelId = 'avisos';
    this.renderCommunitiesList();
    this.loadChannels();
    this.loadMessages();
  }

  // --- CANAIS ---
  async loadChannels() {
    try {
      const res = await this.apiGet(`/api/channels?communityId=${encodeURIComponent(this.state.activeCommunityId)}`);
      this.state.channels = (res && res.channels) ? res.channels : [];
      this.renderChannelsList();
    } catch (e) {
      console.warn('Erro ao carregar canais:', e);
    }
  }

  renderChannelsList() {
    if (!this.channelsList) return;
    this.channelsList.innerHTML = '';

    this.state.channels.forEach(ch => {
      const item = document.createElement('div');
      item.className = `cp2p-channel-item ${ch.id === this.state.activeChannelId ? 'active' : ''}`;

      const icon = ch.icon || (ch.id === 'avisos' ? '📢' : ch.id === 'documentos' ? '📁' : ch.id === 'conversas' ? '💬' : '📌');
      const lockIcon = ch.allow_member_posts === 0 ? '🔒' : '';

      item.innerHTML = `
        <div class="cp2p-ch-left">
          <span class="cp2p-ch-icon">${icon}</span>
          <span class="cp2p-ch-name">${this.escapeHtml(ch.name)}</span>
        </div>
        <div class="cp2p-ch-meta">
          ${lockIcon ? `<span class="cp2p-lock-icon" title="Apenas Administradores podem publicar">${lockIcon}</span>` : ''}
        </div>
      `;

      item.addEventListener('click', () => this.selectChannel(ch.id));
      this.channelsList.appendChild(item);
    });

    this.updateActiveChannelHeader();
    this.updateComposerPermissions();
  }

  selectChannel(channelId) {
    this.state.activeChannelId = channelId;
    this.renderChannelsList();
    this.loadMessages();
  }

  updateActiveChannelHeader() {
    const ch = this.state.channels.find(c => c.id === this.state.activeChannelId);
    if (!ch) return;

    this.chatHeaderIcon.textContent = ch.icon || '💬';
    this.chatHeaderTitle.textContent = ch.name;
    const permissionsText = ch.allow_member_posts === 1 ? 'Aberto para mensagens de todos os membros' : 'Canal exclusivo para comunicados oficiais de Administradores';
    this.chatHeaderSubtitle.textContent = `${ch.description || ''} • ${permissionsText}`;
  }

  updateComposerPermissions() {
    const ch = this.state.channels.find(c => c.id === this.state.activeChannelId);
    const allowMemberPosts = ch ? ch.allow_member_posts === 1 : false;
    const isAdmin = this.state.user && (this.state.user.role === 'Administrador' || this.state.user.role === 'Moderador');

    const canPost = isAdmin || allowMemberPosts;

    if (canPost) {
      this.adminComposer.style.display = 'block';
      this.memberReadonlyBar.style.display = 'none';
      if (this.composerInput) {
        this.composerInput.placeholder = `Escreva uma mensagem assinada em #${ch ? ch.name : 'canal'}...`;
      }
    } else {
      this.adminComposer.style.display = 'none';
      this.memberReadonlyBar.style.display = 'flex';
      this.memberReadonlyBar.textContent = `🔒 Apenas administradores podem publicar no canal #${ch ? ch.name : 'avisos'}.`;
    }
  }

  // --- MENSAGENS ---
  async loadMessages() {
    try {
      const url = `/api/messages?communityId=${encodeURIComponent(this.state.activeCommunityId)}&channelId=${encodeURIComponent(this.state.activeChannelId)}`;
      const res = await this.apiGet(url);
      this.state.messages = (res && res.messages) ? res.messages : [];
      this.applyFilterAndSearch();
      this.updatePinnedBanner();
    } catch (e) {
      console.warn('Erro ao carregar mensagens:', e);
    }
  }

  applyFilterAndSearch() {
    let list = this.state.messages;

    // Filtros rápidos
    if (this.state.activeFilter === 'images') {
      list = list.filter(m => m.attachmentType === 'image' || (m.file_mime && m.file_mime.startsWith('image/')));
    } else if (this.state.activeFilter === 'files') {
      list = list.filter(m => m.file_hash || m.attachmentType === 'file');
    } else if (this.state.activeFilter === 'links') {
      list = list.filter(m => m.link_preview || (m.text && m.text.includes('http')));
    } else if (this.state.activeFilter === 'pinned') {
      list = list.filter(m => m.is_pinned === 1);
    }

    // Busca textual
    if (this.state.searchQuery) {
      const q = this.state.searchQuery;
      list = list.filter(m => 
        (m.text && m.text.toLowerCase().includes(q)) ||
        (m.authorName && m.authorName.toLowerCase().includes(q)) ||
        (m.file_name && m.file_name.toLowerCase().includes(q))
      );
    }

    this.state.filteredMessages = list;
    this.renderMessagesStream();
  }

  renderMessagesStream() {
    if (!this.messagesStream) return;
    this.messagesStream.innerHTML = '';

    if (this.state.filteredMessages.length === 0) {
      this.emptyStateView.style.display = 'block';
      this.emptyStateView.textContent = this.state.searchQuery ? 'Nenhum resultado encontrado para a busca.' : 'Nenhuma publicação neste canal ainda.';
      this.messagesStream.appendChild(this.emptyStateView);
      return;
    }

    this.emptyStateView.style.display = 'none';

    this.state.filteredMessages.forEach(msg => {
      const card = this.createMessageCard(msg);
      this.messagesStream.appendChild(card);
    });

    this.scrollToBottom();
  }

  createMessageCard(msg) {
    const card = document.createElement('div');
    const isOutgoing = this.state.user && msg.author_pubkey && this.state.user.publicKey && 
      (msg.author_pubkey.replace(/-----[^\n]+-----|\s+/g, '') === this.state.user.publicKey.replace(/-----[^\n]+-----|\s+/g, ''));

    card.className = `cp2p-message-card ${isOutgoing ? 'outgoing' : ''} ${msg.is_pinned === 1 ? 'pinned' : ''}`;
    card.id = `msg-${msg.id}`;

    const dateStr = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Header da Mensagem
    let headerHtml = `
      <div class="cp2p-msg-header">
        <div class="cp2p-msg-author-row">
          <span class="cp2p-msg-author">${this.escapeHtml(msg.authorName || 'Membro')}</span>
          <span class="cp2p-role-tag ${msg.authorRole === 'Administrador' ? 'admin' : ''}">${msg.authorRole || 'Membro'}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${msg.is_pinned === 1 ? '<span title="Mensagem Fixada">📌</span>' : ''}
          <span class="cp2p-msg-time">#${msg.sequence} • ${dateStr}</span>
        </div>
      </div>
    `;

    // Proveniência se encaminhado
    let forwardedHtml = '';
    if (msg.forwarded_from_channel_id) {
      forwardedHtml = `
        <div class="cp2p-forwarded-tag">
          ↪️ Encaminhado de #${this.escapeHtml(msg.forwarded_from_channel_id)} ${msg.forwarded_origin_author ? `(por ${this.escapeHtml(msg.forwarded_origin_author)})` : ''}
        </div>
      `;
    }

    // Citação se for resposta
    let quoteHtml = '';
    if (msg.reply_to_id) {
      const parent = this.state.messages.find(m => m.id === msg.reply_to_id);
      quoteHtml = `
        <div class="cp2p-quote-box">
          <div class="cp2p-quote-author">↩️ Em resposta a ${parent ? this.escapeHtml(parent.authorName) : 'mensagem anterior'}</div>
          <div class="cp2p-quote-snippet">${parent ? this.escapeHtml(parent.text.slice(0, 80)) : 'Mensagem original'}</div>
        </div>
      `;
    }

    // Corpo de Texto Sanitizado com URLs Clicáveis
    const formattedText = this.formatMessageText(msg.text);
    let textHtml = `<div class="cp2p-msg-text">${formattedText}</div>`;

    // Preview de Link OpenGraph
    let linkPreviewHtml = '';
    if (msg.link_preview) {
      try {
        const preview = typeof msg.link_preview === 'string' ? JSON.parse(msg.link_preview) : msg.link_preview;
        if (preview && preview.title) {
          linkPreviewHtml = `
            <a href="${this.escapeHtml(preview.url)}" target="_blank" rel="noopener noreferrer" class="cp2p-link-card">
              ${preview.image ? `<img src="${this.escapeHtml(preview.image)}" class="cp2p-link-thumb" alt="Preview" loading="lazy">` : ''}
              <div class="cp2p-link-info">
                <div class="cp2p-link-title">${this.escapeHtml(preview.title)}</div>
                ${preview.description ? `<div class="cp2p-link-desc">${this.escapeHtml(preview.description)}</div>` : ''}
                <div class="cp2p-link-host">🌐 ${this.escapeHtml(new URL(preview.url).hostname)}</div>
              </div>
            </a>
          `;
        }
      } catch (e) {}
    }

    // Anexo de Imagem
    let imageAttachmentHtml = '';
    if (msg.attachmentType === 'image' && msg.attachmentData) {
      imageAttachmentHtml = `
        <div class="cp2p-image-attachment" onclick="app.openLightbox('${this.escapeHtml(msg.attachmentData)}')">
          <img src="${msg.attachmentData}" alt="Imagem do comunicado" loading="lazy">
        </div>
      `;
    }

    // Anexo de Arquivo com Download Chunked
    let fileAttachmentHtml = '';
    if (msg.file_hash) {
      const sizeStr = this.formatBytes(msg.file_size || 0);
      fileAttachmentHtml = `
        <div class="cp2p-file-card">
          <div class="cp2p-file-left">
            <span class="cp2p-file-icon">📁</span>
            <div>
              <div class="cp2p-file-name" title="${this.escapeHtml(msg.file_name || 'arquivo')}">${this.escapeHtml(msg.file_name || 'arquivo')}</div>
              <div class="cp2p-file-meta">${sizeStr} • Verificação SHA-256 Íntegra</div>
            </div>
          </div>
          <button class="cp2p-btn-download" onclick="app.downloadFile('${msg.file_hash}', '${this.escapeHtml(msg.file_name || 'anexo')}')">
            Baixar Arquivo
          </button>
        </div>
      `;
    }

    // Reações de Emojis
    const reactions = msg.reactions || [];
    let reactionsHtml = '<div class="cp2p-reactions-row">';
    reactions.forEach(r => {
      reactionsHtml += `
        <div class="cp2p-reaction-chip" onclick="app.toggleReaction('${msg.id}', '${r.emoji}')">
          <span>${r.emoji}</span>
          <span>${r.count}</span>
        </div>
      `;
    });
    reactionsHtml += '</div>';

    // Ações de Mensagem (Hover/Contextual)
    const isAdmin = this.state.user && (this.state.user.role === 'Administrador' || this.state.user.role === 'Moderador');
    const actionsHtml = `
      <div class="cp2p-msg-actions">
        <button class="cp2p-msg-action-btn" title="Responder" onclick="app.startReply('${msg.id}')">↩️</button>
        <button class="cp2p-msg-action-btn" title="Reagir com emoji" onclick="app.openReactionPalette('${msg.id}')">😊</button>
        <button class="cp2p-msg-action-btn" title="Encaminhar" onclick="app.startForward('${msg.id}')">↪️</button>
        ${isAdmin ? `<button class="cp2p-msg-action-btn" title="${msg.is_pinned ? 'Desafixar' : 'Fixar'}" onclick="app.togglePin('${msg.id}', ${msg.is_pinned ? 'false' : 'true'})">📌</button>` : ''}
        ${(isAdmin || isOutgoing) ? `<button class="cp2p-msg-action-btn" title="Excluir" onclick="app.deleteMessage('${msg.id}')">🗑️</button>` : ''}
      </div>
    `;

    // Footer da Mensagem
    let footerHtml = `
      <div class="cp2p-msg-footer">
        ${reactionsHtml}
        <div style="display: flex; align-items: center; gap: 8px;">
          ${actionsHtml}
          <span class="cp2p-msg-status" title="Assinado com Ed25519 e verificado na rede">✓✓</span>
        </div>
      </div>
    `;

    card.innerHTML = headerHtml + forwardedHtml + quoteHtml + textHtml + linkPreviewHtml + imageAttachmentHtml + fileAttachmentHtml + footerHtml;
    return card;
  }

  formatMessageText(text) {
    if (!text) return '';
    const escaped = this.escapeHtml(text);
    // Transforma links em âncoras clicáveis seguras
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  scrollToBottom() {
    if (this.chatScroll) {
      this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
    }
  }

  // --- COMPOSER: ANEXOS, DRAG & DROP E PASTE ---
  handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) this.stageFile(file);
  }

  handleClipboardPaste(event) {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          this.stageFile(file);
          this.showToast(`Arquivo colado da área de transferência: ${file.name}`);
          break;
        }
      }
    }
  }

  stageFile(file) {
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onload = (e) => {
      this.state.stagedAttachment = {
        file,
        base64: e.target.result.split(',')[1],
        dataUrl: e.target.result,
        name: file.name,
        size: file.size,
        type: file.type,
        isImage
      };

      this.attachmentPreviewName.textContent = file.name;
      this.attachmentPreviewSize.textContent = `(${this.formatBytes(file.size)})`;
      this.composerAttachmentPreview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }

  clearAttachment() {
    this.state.stagedAttachment = null;
    this.composerAttachmentPreview.style.display = 'none';
    if (this.fileAttachmentInput) this.fileAttachmentInput.value = '';
  }

  startReply(messageId) {
    const msg = this.state.messages.find(m => m.id === messageId);
    if (!msg) return;

    this.state.replyingTo = msg;
    this.replyPreviewAuthor.textContent = `Respondendo a ${msg.authorName || 'Membro'}:`;
    this.replyPreviewText.textContent = msg.text ? msg.text.slice(0, 70) : 'Anexo';
    this.composerReplyPreview.style.display = 'flex';
    if (this.composerInput) this.composerInput.focus();
  }

  clearReply() {
    this.state.replyingTo = null;
    this.composerReplyPreview.style.display = 'none';
  }

  // --- PUBLICAÇÃO DE MENSAGENS COM UPLOAD RESILIENTE ---
  async sendMessage() {
    const text = this.composerInput ? this.composerInput.value.trim() : '';
    if (!text && !this.state.stagedAttachment) return;

    this.btnPublish.disabled = true;

    try {
      let fileHash = null;
      let fileName = null;
      let fileSize = null;
      let fileMime = null;
      let fileChunksTotal = null;
      let attachmentType = null;
      let attachmentData = null;

      // Se há um anexo em estágio
      if (this.state.stagedAttachment) {
        const att = this.state.stagedAttachment;
        fileName = att.name;
        fileSize = att.size;
        fileMime = att.type;

        // Se for imagem pequena (< 300KB), pode usar inline attachmentData
        if (att.isImage && att.size < 300 * 1024) {
          attachmentType = 'image';
          attachmentData = att.dataUrl;
        } else {
          // Faz upload chunked com hash Merkle no nó
          const uploadRes = await this.apiPost('/api/files/upload', {
            filename: att.name,
            dataBase64: att.base64,
            communityId: this.state.activeCommunityId,
            channelId: this.state.activeChannelId
          });

          if (uploadRes && uploadRes.fileHash) {
            fileHash = uploadRes.fileHash;
            fileChunksTotal = uploadRes.chunksTotal;
            attachmentType = 'file';
          }
        }
      }

      const payload = {
        communityId: this.state.activeCommunityId,
        channelId: this.state.activeChannelId,
        text: text || `[Arquivo anexado: ${fileName || 'anexo'}]`,
        replyToId: this.state.replyingTo ? this.state.replyingTo.id : null,
        attachmentType,
        attachmentData,
        fileHash,
        fileName,
        fileSize,
        fileMime,
        fileChunksTotal
      };

      const res = await this.apiPost('/api/messages', payload);
      if (res && res.message) {
        this.composerInput.value = '';
        this.clearAttachment();
        this.clearReply();
        this.appendMessage(res.message);
      } else if (res && res.error) {
        alert(res.error);
      }
    } catch (err) {
      alert('Erro de conexão ao publicar mensagem.');
    } finally {
      this.btnPublish.disabled = false;
    }
  }

  appendMessage(msg) {
    if (this.state.messages.some(m => m.id === msg.id)) return;
    this.state.messages.push(msg);
    this.applyFilterAndSearch();
  }

  // --- REAÇÕES, FIXAÇÃO E EXCLUSÃO ---
  async toggleReaction(messageId, emoji) {
    try {
      await this.apiPost(`/api/messages/${messageId}/react`, { emoji });
      this.loadMessages();
    } catch (e) {}
  }

  openReactionPalette(messageId) {
    const emojis = ['👍', '❤️', '🎉', '👏', '🔥', '🤔', '🤝'];
    const chosen = prompt(`Escolha um emoji para reagir:\n${emojis.join('  ')}`, '👍');
    if (chosen) {
      this.toggleReaction(messageId, chosen.trim());
    }
  }

  async togglePin(messageId, pin) {
    try {
      const endpoint = pin ? `/api/messages/${messageId}/pin` : `/api/messages/${messageId}/unpin`;
      await this.apiPost(endpoint, {});
      this.loadMessages();
      this.showToast(pin ? 'Mensagem fixada!' : 'Mensagem desafixada!');
    } catch (e) {
      alert('Apenas Administradores podem fixar mensagens.');
    }
  }

  updatePinnedBanner() {
    const pinned = this.state.messages.filter(m => m.is_pinned === 1);
    if (pinned.length > 0) {
      const latestPin = pinned[pinned.length - 1];
      this.pinnedBar.style.display = 'flex';
      this.pinnedSnippetText.textContent = `${latestPin.authorName}: ${latestPin.text.slice(0, 80)}`;
      this.btnJumpPinned.onclick = () => {
        const el = document.getElementById(`msg-${latestPin.id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      const isAdmin = this.state.user && (this.state.user.role === 'Administrador' || this.state.user.role === 'Moderador');
      if (this.btnUnpinActive && isAdmin) {
        this.btnUnpinActive.style.display = 'block';
        this.btnUnpinActive.onclick = () => this.togglePin(latestPin.id, false);
      }
    } else {
      this.pinnedBar.style.display = 'none';
    }
  }

  async deleteMessage(messageId) {
    if (!confirm('Deseja realmente excluir esta mensagem?')) return;
    try {
      await this.apiDelete(`/api/messages/${messageId}`);
      this.state.messages = this.state.messages.filter(m => m.id !== messageId);
      this.applyFilterAndSearch();
      this.showToast('Mensagem excluída.');
    } catch (e) {
      alert('Sem permissão para excluir mensagem.');
    }
  }

  // --- ENCAMINHAMENTO ---
  startForward(messageId) {
    const msg = this.state.messages.find(m => m.id === messageId);
    if (!msg) return;

    this.state.forwardingMsg = msg;
    const authorEl = document.getElementById('forward-orig-author');
    const snippetEl = document.getElementById('forward-orig-snippet');
    if (authorEl) authorEl.textContent = msg.authorName || 'Membro';
    if (snippetEl) snippetEl.textContent = msg.text ? msg.text.slice(0, 100) : 'Anexo';

    // Preenche opções de canais da comunidade atual
    const select = document.getElementById('forward-target-channel');
    if (select) {
      select.innerHTML = '';
      this.state.channels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = `# ${ch.name}`;
        select.appendChild(opt);
      });
    }

    this.openModal('modal-forward-msg');
  }

  async handleSubmitForward() {
    if (!this.state.forwardingMsg) return;

    const targetChannel = document.getElementById('forward-target-channel').value;
    const comment = document.getElementById('forward-comment-input').value.trim();

    try {
      const res = await this.apiPost('/api/messages/forward', {
        messageId: this.state.forwardingMsg.id,
        targetCommunityId: this.state.activeCommunityId,
        targetChannelId: targetChannel,
        comment
      });

      if (res && res.success) {
        this.closeModal('modal-forward-msg');
        this.showToast(`Mensagem encaminhada para #${targetChannel}!`);
        if (targetChannel === this.state.activeChannelId) {
          this.loadMessages();
        }
      } else {
        alert(res.error || 'Erro ao encaminhar mensagem.');
      }
    } catch (e) {
      alert('Erro de conexão ao encaminhar.');
    }
  }

  // --- DOWNLOAD DE ARQUIVO RESILIENTE ---
  downloadFile(fileHash, filename) {
    const url = `/api/files/${fileHash}/download?filename=${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  openLightbox(dataUrl) {
    const img = document.getElementById('lightbox-full-img');
    if (img) img.src = dataUrl;
    this.openModal('modal-image-lightbox');
  }

  // --- CONVITES, QR CODES E CÓDIGOS CURTOS ---
  async openInviteModal() {
    try {
      const res = await this.apiGet(`/api/invites?communityId=${encodeURIComponent(this.state.activeCommunityId)}`);
      let invite = res && res.invites && res.invites[0];

      if (!invite) {
        const createRes = await this.apiPost('/api/invites', {
          communityId: this.state.activeCommunityId,
          expiresInHours: 48
        });
        invite = createRes ? createRes.invite : null;
      }

      if (!invite) {
        alert('Não foi possível gerar convite.');
        return;
      }

      const shortCodeLabel = document.getElementById('invite-short-code-label');
      const urlInput = document.getElementById('invite-url-input');
      const qrContainer = document.getElementById('invite-qrcode-container');

      if (shortCodeLabel) shortCodeLabel.textContent = invite.code;
      const inviteUrl = `${window.location.origin}/join/${invite.code}`;
      if (urlInput) urlInput.value = inviteUrl;

      // Renderiza QR Code vetorial SVG real
      if (qrContainer && window.QRCodeGenerator) {
        qrContainer.innerHTML = window.QRCodeGenerator.generateSVG(inviteUrl, 220);
      }

      this.openModal('modal-invite-share');
    } catch (e) {
      alert('Erro ao carregar convites.');
    }
  }

  copyInviteLink() {
    const input = document.getElementById('invite-url-input');
    if (input) {
      navigator.clipboard.writeText(input.value);
      this.showToast('Link de convite copiado!');
    }
  }

  shareNativeInvite() {
    const input = document.getElementById('invite-url-input');
    if (navigator.share && input) {
      navigator.share({
        title: 'Convite para Comunidade Resiliente',
        text: 'Entre no nosso canal seguro e descentralizado:',
        url: input.value
      }).catch(() => {});
    } else {
      this.copyInviteLink();
    }
  }

  // --- OUTBOX / FILA OFFLINE ---
  async loadOutboxStatus() {
    try {
      const res = await this.apiGet('/api/outbox');
      const count = res ? (res.count || 0) : 0;
      this.state.pendingOutboxCount = count;
      if (count > 0) {
        this.outboxPendingBanner.style.display = 'flex';
        this.outboxCountLabel.textContent = count;
      } else {
        this.outboxPendingBanner.style.display = 'none';
      }
    } catch (e) {}
  }

  async flushOutboxNow() {
    try {
      const res = await this.apiPost('/api/outbox/flush', {});
      if (res && res.flushedCount > 0) {
        this.showToast(`${res.flushedCount} comunicado(s) sincronizados com sucesso!`);
      } else {
        this.showToast('Nenhuma mensagem pendente ou aguardando conexão com outros nós.');
      }
      this.loadOutboxStatus();
      this.loadMessages();
    } catch (e) {}
  }

  // --- STATUS DA REDE E PAINEL VISÃO DA COMUNIDADE ---
  async loadNetworkOverview() {
    try {
      const res = await this.apiGet('/api/network/overview');
      if (res) {
        this.state.network = res;
        this.updateNetworkUI(res);
      }
    } catch (e) {}
  }

  updateNetworkUI(net) {
    if (!net) return;

    const isVpsOnline = net.vpsStatus === 'ONLINE';
    if (isVpsOnline) {
      this.vpsOfflineBanner.style.display = 'none';
      this.railMeshDot.className = 'pulse-dot online';
      this.chatStatusDot.className = 'pulse-dot online';
    } else {
      this.vpsOfflineBanner.style.display = 'flex';
      this.railMeshDot.className = 'pulse-dot relay';
      this.chatStatusDot.className = 'pulse-dot relay';
    }

    const peerCount = net.connectedNodesCount || 0;
    this.cp2pNetworkBtnLabel.textContent = `Visão da Comunidade (${peerCount})`;

    const vpsStatusEl = document.getElementById('dash-vps-status');
    if (vpsStatusEl) {
      vpsStatusEl.textContent = net.vpsStatus;
      vpsStatusEl.style.color = isVpsOnline ? 'var(--cp2p-online)' : 'var(--cp2p-offline)';
    }

    const meshModeEl = document.getElementById('dash-mesh-mode');
    if (meshModeEl) meshModeEl.textContent = net.p2pMeshState;

    const nodesCountEl = document.getElementById('dash-nodes-count');
    if (nodesCountEl) nodesCountEl.textContent = peerCount;

    const msgsCountEl = document.getElementById('dash-msgs-count');
    if (msgsCountEl) msgsCountEl.textContent = net.syncMessagesCount || 0;

    const natTypeEl = document.getElementById('dash-nat-type');
    if (natTypeEl) natTypeEl.textContent = `${net.natType || 'Direto'} (${net.externalIp || 'P2P'})`;
  }

  async openNetworkDashboard(targetTab = null) {
    await this.loadNetworkOverview();
    await this.loadPeersList();
    await this.loadMembersList();
    await this.loadJoinRequests();
    await this.loadNetworkEvents();

    if (targetTab) {
      const btn = document.querySelector(`[data-tab="${targetTab}"]`);
      if (btn) btn.click();
    }
    this.openModal('modal-network-dashboard');
  }

  async loadPeersList() {
    const container = document.getElementById('dash-peers-list');
    if (!container) return;
    try {
      const res = await this.apiGet('/api/network/nodes');
      const nodes = (res && res.nodes) ? res.nodes : [];
      if (nodes.length === 0) {
        container.innerHTML = '<p style="color: var(--cp2p-text-muted);">Nenhum outro nó conectado diretamente neste momento.</p>';
        return;
      }

      container.innerHTML = nodes.map(n => `
        <div style="background: var(--cp2p-bg-input); padding: 8px 12px; border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${this.escapeHtml(n.shortId)}</strong>
            <span style="font-size: 0.74rem; color: var(--cp2p-text-dim); margin-left: 8px;">${n.host}:${n.port}</span>
          </div>
          <span style="font-size: 0.74rem; padding: 2px 8px; border-radius: var(--radius-full); background: rgba(16, 185, 129, 0.2); color: var(--cp2p-online);">
            ${n.connectionMethod}
          </span>
        </div>
      `).join('');
    } catch (e) {}
  }

  async loadMembersList() {
    const container = document.getElementById('dash-members-list');
    if (!container) return;
    try {
      const res = await this.apiGet('/api/community/members');
      const members = (res && res.members) ? res.members : [];
      container.innerHTML = members.map(m => `
        <div style="background: var(--cp2p-bg-input); padding: 8px 12px; border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${this.escapeHtml(m.username)}</strong>
            <span style="font-size: 0.72rem; color: var(--cp2p-text-dim); margin-left: 8px;">${m.shortPublicKey || ''}</span>
          </div>
          <span style="font-size: 0.74rem; font-weight: 600; color: var(--cp2p-primary);">
            ${m.role}
          </span>
        </div>
      `).join('');
    } catch (e) {}
  }

  async loadJoinRequests() {
    const container = document.getElementById('dash-join-requests-list');
    if (!container) return;
    try {
      const res = await this.apiGet(`/api/join-requests?communityId=${encodeURIComponent(this.state.activeCommunityId)}`);
      const requests = (res && res.requests) ? res.requests : [];
      if (requests.length === 0) {
        container.innerHTML = '<p style="color: var(--cp2p-text-muted);">Nenhuma solicitação de entrada pendente.</p>';
        return;
      }

      container.innerHTML = requests.map(r => `
        <div style="background: var(--cp2p-bg-input); padding: 10px 14px; border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${this.escapeHtml(r.username)}</strong>
            <div style="font-size: 0.74rem; color: var(--cp2p-text-dim);">Convite: ${this.escapeHtml(r.invite_code || 'Direto')}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-primary" style="padding: 4px 10px; font-size: 0.76rem;" onclick="app.reviewJoinRequest('${r.id}', 'approved')">Aprovar</button>
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 0.76rem;" onclick="app.reviewJoinRequest('${r.id}', 'rejected')">Rejeitar</button>
          </div>
        </div>
      `).join('');
    } catch (e) {}
  }

  async reviewJoinRequest(requestId, status) {
    try {
      await this.apiPost(`/api/join-requests/${requestId}/review`, { status });
      this.showToast(status === 'approved' ? 'Membro aprovado com sucesso!' : 'Solicitação rejeitada.');
      this.loadJoinRequests();
      this.loadMembersList();
    } catch (e) {
      alert('Apenas Administradores podem revisar solicitações.');
    }
  }

  async loadNetworkEvents() {
    const container = document.getElementById('dash-events-list');
    if (!container) return;
    try {
      const res = await this.apiGet('/api/network/events');
      const events = (res && res.events) ? res.events : [];
      container.innerHTML = events.map(ev => `
        <div style="border-bottom: 1px solid var(--cp2p-border); padding: 4px 0;">
          <span style="color: var(--cp2p-text-dim);">${new Date(ev.timestamp).toLocaleTimeString()}</span>
          <strong style="color: var(--cp2p-primary); margin: 0 6px;">[${ev.event_type}]</strong>
          <span>${this.escapeHtml(ev.summary)}</span>
        </div>
      `).join('');
    } catch (e) {}
  }

  // --- ARMAZENAMENTO E COTAS ---
  async openStorageModal() {
    try {
      const res = await this.apiGet('/api/storage/settings');
      if (res) {
        document.getElementById('storage-total-msgs').textContent = res.totalMessages || 0;
        document.getElementById('storage-total-chunks').textContent = res.totalFileChunks || 0;
        document.getElementById('storage-used-mb').textContent = `${res.totalChunkMB || 0} MB`;
        document.getElementById('storage-policy-select').value = res.policy || 'all';
        document.getElementById('storage-max-mb').value = res.maxStorageMB || 500;
      }
      this.openModal('modal-storage-settings');
    } catch (e) {}
  }

  async handleSaveStorageSettings() {
    const policy = document.getElementById('storage-policy-select').value;
    const maxStorageMB = document.getElementById('storage-max-mb').value;

    try {
      const res = await this.apiPost('/api/storage/settings', { policy, maxStorageMB });
      if (res && res.success) {
        this.closeModal('modal-storage-settings');
        this.showToast('Configurações de armazenamento salvas!');
      } else {
        alert(res.error || 'Apenas Administradores podem alterar configurações.');
      }
    } catch (e) {
      alert('Erro ao salvar armazenamento.');
    }
  }

  // --- AUDITORIA CRIPTOGRÁFICA ---
  async openAuditModal() {
    try {
      const res = await this.apiGet('/api/audit');
      const logs = (res && res.logs) ? res.logs : [];
      const container = document.getElementById('audit-logs-container');
      if (container) {
        container.innerHTML = logs.map(l => `
          <div style="background: var(--cp2p-bg-input); padding: 6px 10px; border-radius: var(--radius-xs);">
            <span style="color: var(--cp2p-text-dim);">${new Date(l.timestamp).toLocaleString()}</span>
            <strong style="color: var(--cp2p-primary); margin: 0 6px;">${this.escapeHtml(l.action)}</strong>
            <span style="color: var(--cp2p-text-muted);">${this.escapeHtml(l.details)}</span>
          </div>
        `).join('');
      }
      this.openModal('modal-audit-view');
    } catch (e) {}
  }

  // --- WEBSOCKET REAL-TIME LIVE DISPATCH ---
  connectLiveWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/live`;

    try {
      this.liveSocket = new WebSocket(wsUrl);
    } catch (e) {
      this.reconnectTimer = setTimeout(() => this.connectLiveWebSocket(), 3000);
      return;
    }

    this.liveSocket.onopen = () => {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    };

    this.liveSocket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        this.handleLivePacket(packet);
      } catch (err) {}
    };

    this.liveSocket.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connectLiveWebSocket(), 3000);
    };
  }

  handleLivePacket(packet) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case 'NEW_MESSAGE':
        if (packet.message && packet.message.community_id === this.state.activeCommunityId) {
          if (packet.message.channel_id === this.state.activeChannelId) {
            this.appendMessage(packet.message);
          }
        }
        break;

      case 'MESSAGE_DELETED':
        this.state.messages = this.state.messages.filter(m => m.id !== packet.messageId);
        this.applyFilterAndSearch();
        break;

      case 'CHANNEL_CREATED':
      case 'CHANNEL_UPDATED':
      case 'CHANNEL_DELETED':
        this.loadChannels();
        break;

      case 'NETWORK_UPDATE':
      case 'PEER_CHANGE':
      case 'VPS_STATUS_CHANGE':
        this.loadNetworkOverview();
        break;

      case 'OUTBOX_SYNCED':
        this.loadOutboxStatus();
        this.loadMessages();
        break;
    }
  }

  // --- CRIAÇÃO DE CANAIS E COMUNIDADES ---
  async handleCreateChannel() {
    const name = document.getElementById('new-ch-name').value.trim();
    const id = document.getElementById('new-ch-id').value.trim();
    const icon = document.getElementById('new-ch-icon').value.trim();
    const description = document.getElementById('new-ch-desc').value.trim();
    const allowMemberPosts = document.getElementById('new-ch-allow-members').checked;

    if (!name || !id) {
      alert('Nome e identificador do canal são obrigatórios.');
      return;
    }

    try {
      const res = await this.apiPost('/api/channels', {
        id,
        name,
        icon: icon || '📢',
        description,
        allowMemberPosts,
        communityId: this.state.activeCommunityId
      });

      if (res && res.channel) {
        this.closeModal('modal-create-channel');
        this.showToast(`Canal #${name} criado com sucesso!`);
        await this.loadChannels();
        this.selectChannel(res.channel.id);
      } else {
        alert(res.error || 'Erro ao criar canal.');
      }
    } catch (e) {
      alert('Apenas Administradores podem criar canais.');
    }
  }

  async handleCreateCommunity() {
    const name = document.getElementById('new-comm-name').value.trim();
    const description = document.getElementById('new-comm-desc').value.trim();
    if (!name) return alert('Digite o nome da comunidade.');

    try {
      const res = await this.apiPost('/api/communities', { name, description });
      if (res && res.community) {
        this.closeModal('modal-create-comm');
        this.showToast(`Comunidade "${name}" criada com sucesso!`);
        await this.loadCommunities();
        this.selectCommunity(res.community.id);
      } else {
        alert(res.error || 'Erro ao criar comunidade.');
      }
    } catch (e) {
      alert('Erro de conexão.');
    }
  }

  async handleJoinCommunity() {
    const code = document.getElementById('join-comm-code').value.trim();
    if (!code) return alert('Digite o código ou link de convite.');

    try {
      const res = await this.apiPost('/api/communities/join', { inviteCode: code });
      if (res && res.community) {
        this.closeModal('modal-join-comm');
        this.showToast(res.message || 'Você entrou na comunidade!');
        await this.loadCommunities();
        this.selectCommunity(res.community.id);
      } else {
        alert(res.error || 'Código de convite inválido ou expirado.');
      }
    } catch (e) {
      alert('Erro de rede.');
    }
  }

  // --- AUTENTICAÇÃO SIMPLES & PSEUDÔNIMA ---
  async checkPseudonymAvailability(username) {
    const statusEl = document.getElementById('pseudonym-validation-status');
    const suggContainer = document.getElementById('pseudonym-suggestions-container');
    const suggList = document.getElementById('pseudonym-suggestions-list');
    if (!statusEl || !username || username.trim().length < 3) {
      if (statusEl) statusEl.style.display = 'none';
      if (suggContainer) suggContainer.style.display = 'none';
      return;
    }

    try {
      const res = await this.apiGet(`/api/auth/check-username?username=${encodeURIComponent(username.trim())}`);
      statusEl.style.display = 'block';

      if (res && res.available) {
        statusEl.style.color = 'var(--cp2p-success)';
        statusEl.textContent = '✓ Apelido disponível!';
        if (suggContainer) suggContainer.style.display = 'none';
      } else {
        statusEl.style.color = 'var(--cp2p-warning)';
        statusEl.textContent = `⚠️ ${res.error || 'Nome já em uso ou inválido.'}`;

        if (res && Array.isArray(res.suggestions) && res.suggestions.length > 0) {
          suggContainer.style.display = 'block';
          suggList.innerHTML = '';
          res.suggestions.forEach(sug => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'suggestion-chip';
            chip.textContent = sug;
            chip.addEventListener('click', () => {
              const input = document.getElementById('auth-pseudonym');
              if (input) {
                input.value = sug;
                this.checkPseudonymAvailability(sug);
              }
            });
            suggList.appendChild(chip);
          });
        }
      }
    } catch (e) {
      // Falha silenciosa de checagem online
    }
  }

  async handleSimplePseudonymRegister() {
    const input = document.getElementById('auth-pseudonym');
    const username = input ? input.value.trim() : '';

    if (!username || username.length < 3) {
      return alert('Escolha um apelido com no mínimo 3 caracteres.');
    }

    // Verifica se há convite na URL ou no campo de convite
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite') || (document.getElementById('join-comm-code') ? document.getElementById('join-comm-code').value.trim() : null);

    try {
      const btn = document.getElementById('btn-enter-community');
      if (btn) btn.disabled = true;

      const res = await this.apiPost('/api/auth/register-simple', { username, inviteCode });
      if (btn) btn.disabled = false;

      if (res && res.success) {
        if (res.token) {
          localStorage.setItem('cp2p_token', res.token);
          this.state.token = res.token;
          this.state.user = res.user;
          this.updateUserUI(res.user);
        }

        // Mostra a tela de sucesso com o código de recuperação
        const simpleView = document.getElementById('auth-simple-form-view');
        const successView = document.getElementById('auth-success-view');
        const codeDisplay = document.getElementById('display-created-recovery-code');

        if (simpleView) simpleView.style.display = 'none';
        if (successView) successView.style.display = 'block';
        if (codeDisplay && res.recoveryCode) {
          codeDisplay.textContent = res.recoveryCode;
        }

        this.showToast('Usuário criado com sucesso.');
        if (res.isPending) {
          this.showToast('Solicitação de entrada enviada para aprovação do moderador.');
        }
      } else {
        alert(res.error || 'Não foi possível cadastrar com este nome.');
        if (res.suggestions) {
          this.checkPseudonymAvailability(username);
        }
      }
    } catch (e) {
      const btn = document.getElementById('btn-enter-community');
      if (btn) btn.disabled = false;
      alert('Erro de conexão ao criar usuário.');
    }
  }

  async handleRecoverAccount() {
    const input = document.getElementById('recovery-input-code');
    const code = input ? input.value.trim() : '';
    if (!code) return alert('Digite o código de recuperação ou pareamento.');

    try {
      // Se for código de pareamento PAIR-
      const endpoint = code.toUpperCase().startsWith('PAIR-') ? '/api/devices/pair' : '/api/auth/recover';
      const payload = code.toUpperCase().startsWith('PAIR-') ? { pairingCode: code } : { recoveryCode: code };

      const res = await this.apiPost(endpoint, payload);
      if (res && res.success && res.token) {
        localStorage.setItem('cp2p_token', res.token);
        this.state.token = res.token;
        this.state.user = res.user;
        this.updateUserUI(res.user);
        this.closeModal('modal-auth-profile');
        this.showToast(res.message || 'Acesso restaurado com sucesso!');
        this.loadInitialData();
      } else {
        alert(res.error || 'Código inválido ou expirado.');
      }
    } catch (e) {
      alert('Erro de conexão ao recuperar acesso.');
    }
  }

  async loadPairingCodeAndDevices() {
    try {
      // 1. Gera ou recupera código de pareamento
      const pairRes = await this.apiPost('/api/devices/pairing-code', {});
      if (pairRes && pairRes.pairingCode) {
        const codeEl = document.getElementById('display-pairing-code');
        if (codeEl) codeEl.textContent = pairRes.pairingCode;

        const qrContainer = document.getElementById('pairing-qrcode-container');
        if (qrContainer && pairRes.qrcodeSvg) {
          qrContainer.innerHTML = pairRes.qrcodeSvg;
        }
      }

      // 2. Carrega lista de dispositivos do usuário
      const devRes = await this.apiGet('/api/devices');
      const listEl = document.getElementById('user-devices-list');
      if (listEl && devRes && Array.isArray(devRes.devices)) {
        if (devRes.devices.length === 0) {
          listEl.innerHTML = '<div style="font-size: 0.82rem; color: var(--cp2p-text-muted);">Nenhum dispositivo adicional registrado.</div>';
        } else {
          listEl.innerHTML = devRes.devices.map(d => `
            <div class="device-item-row">
              <div>
                <strong style="font-size: 0.84rem; color: var(--cp2p-text);">
                  ${d.device_type === 'mobile' ? '📱 Celular' : (d.device_type === 'desktop' ? '💻 Computador' : '🌐 Web')}
                </strong>
                <div style="font-size: 0.74rem; color: var(--cp2p-text-muted);">
                  Sessão: ${d.session_id.slice(0, 12)} • Ativo: ${new Date(d.last_seen).toLocaleTimeString('pt-BR')}
                </div>
              </div>
              <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; color: var(--cp2p-danger);" onclick="window.cp2pApp.revokeDevice('${d.session_id}')">
                Revogar
              </button>
            </div>
          `).join('');
        }
      }
    } catch (e) {
      console.error('Erro ao carregar dados de pareamento:', e);
    }
  }

  async revokeDevice(sessionId) {
    if (!confirm('Deseja realmente desconectar e revogar este dispositivo?')) return;
    try {
      const res = await this.apiPost(`/api/devices/${sessionId}/revoke`, {});
      if (res && res.success) {
        this.showToast('Dispositivo revogado com sucesso.');
        this.loadPairingCodeAndDevices();
      }
    } catch (e) {
      alert('Erro ao revogar dispositivo.');
    }
  }

  // --- SERVICE WORKER & NOTIFICAÇÕES ---
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  // --- HELPERS DE MODAIS E HTTP ---
  openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('open');
  }

  closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.background = 'rgba(15, 23, 42, 0.95)';
    toast.style.color = '#ffffff';
    toast.style.border = '1px solid var(--cp2p-primary)';
    toast.style.borderRadius = '8px';
    toast.style.padding = '10px 18px';
    toast.style.fontSize = '0.86rem';
    toast.style.fontWeight = '500';
    toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    toast.style.zIndex = '9999';
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async apiGet(url) {
    const headers = {};
    if (this.state.token) headers['Authorization'] = `Bearer ${this.state.token}`;
    const res = await fetch(url, { headers });
    return await res.json();
  }

  async apiPost(url, data) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.state.token) headers['Authorization'] = `Bearer ${this.state.token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
    return await res.json();
  }

  async apiDelete(url) {
    const headers = {};
    if (this.state.token) headers['Authorization'] = `Bearer ${this.state.token}`;
    const res = await fetch(url, { method: 'DELETE', headers });
    return await res.json();
  }
}

// Inicializa a aplicação quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
