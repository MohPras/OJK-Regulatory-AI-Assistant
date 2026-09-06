/**
 * OJK Regulatory AI Assistant - Frontend Controller
 */

// ============================================================
// KONFIGURASI API BACKEND OJK
// ============================================================
const API_CONFIG = {
    BASE_URL: "http://localhost:8000",
    CHAT_ENDPOINT: "/api/chat",
    USE_MOCK: false
};

// State Management
const state = {
    sessions: [],          // Menyimpan daftar percakapan { id, title, messages: [] }
    currentSessionId: null, // ID percakapan yang sedang aktif
    isProcessing: false,
    settings: {
        theme: "light",
        detail: "balanced",
        topK: 5
    }
};

const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    chatContainer: document.getElementById('chatContainer'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    messagesList: document.getElementById('messagesList'),
    historyList: document.getElementById('historyList'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    
    // Modals
    modalKnowledgeBase: document.getElementById('modalKnowledgeBase'),
    modalAbout: document.getElementById('modalAbout'),
    modalSettings: document.getElementById('modalSettings'),
    
    // Nav Items
    navKnowledgeBase: document.getElementById('navKnowledgeBase'),
    navAbout: document.getElementById('navAbout'),
    navSettings: document.getElementById('navSettings'),
    headerSettingsBtn: document.getElementById('headerSettingsBtn'),
    
    settingTheme: document.getElementById('settingTheme'),
    settingDetail: document.getElementById('settingDetail'),
    settingTopK: document.getElementById('settingTopK')
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) lucide.createIcons();
    setupEventListeners();
    autoResizeTextarea();
    renderHistoryUI();
});

function setupEventListeners() {
    elements.toggleSidebarBtn.addEventListener('click', toggleSidebar);
    elements.closeSidebarBtn.addEventListener('click', toggleSidebar);
    elements.sidebarOverlay.addEventListener('click', toggleSidebar);

    elements.newChatBtn.addEventListener('click', startNewChatSession);

    elements.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    elements.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            const query = card.getAttribute('data-query');
            if (query) handleSuggestion(query);
        });
    });

    elements.navKnowledgeBase.addEventListener('click', () => openModal(elements.modalKnowledgeBase));
    elements.navAbout.addEventListener('click', () => openModal(elements.modalAbout));
    elements.navSettings.addEventListener('click', () => openModal(elements.modalSettings));
    elements.headerSettingsBtn.addEventListener('click', () => openModal(elements.modalSettings));

    document.querySelectorAll('.closeModal').forEach(btn => {
        btn.addEventListener('click', (e) => closeModal(e.target.closest('.modal')));
    });

    elements.settingTheme.addEventListener('change', (e) => {
        state.settings.theme = e.target.value;
        document.body.setAttribute('data-theme', state.settings.theme);
    });
}

function autoResizeTextarea() {
    elements.chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight < 150 ? this.scrollHeight : 150) + 'px';
    });
}

function toggleSidebar() {
    elements.sidebar.classList.toggle('open');
    elements.sidebarOverlay.classList.toggle('active');
}

function openModal(modal) { modal.classList.add('active'); }
function closeModal(modal) { modal.classList.remove('active'); }

function handleSuggestion(query) {
    elements.chatInput.value = query;
    sendMessage();
}

function startNewChatSession() {
    state.currentSessionId = null;
    elements.messagesList.innerHTML = '';
    elements.welcomeScreen.style.display = 'block';
    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';
    renderHistoryUI();
}

function renderHistoryUI() {
    elements.historyList.innerHTML = '';

    if (state.sessions.length === 0) {
        elements.historyList.innerHTML = `<li style="padding: 8px 12px; font-size: 0.75rem; color: var(--text-muted);">Belum ada riwayat analisis</li>`;
        return;
    }

    state.sessions.forEach(session => {
        const li = document.createElement('li');
        li.className = `history-item ${session.id === state.currentSessionId ? 'active' : ''}`;
        li.style.justifyContent = 'space-between';
        
        li.innerHTML = `
            <div class="history-title-wrapper" style="display:flex; align-items:center; gap:8px; overflow:hidden; cursor:pointer; flex:1;">
                <i data-lucide="scale" style="width:14px; flex-shrink:0;"></i>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(session.title)}</span>
            </div>
            <button class="delete-session-btn" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:2px; display:flex; align-items:center;" title="Hapus Chat">
                <i data-lucide="trash-2" style="width:14px;"></i>
            </button>
        `;

        li.querySelector('.history-title-wrapper').addEventListener('click', () => loadSession(session.id));
        li.querySelector('.delete-session-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(session.id);
        });

        elements.historyList.appendChild(li);
    });

    if (window.lucide) lucide.createIcons();
}

function loadSession(sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    state.currentSessionId = session.id;
    elements.welcomeScreen.style.display = 'none';
    elements.messagesList.innerHTML = '';

    session.messages.forEach(msg => {
        if (msg.role === 'user') {
            addUserMessageToDOM(msg.content);
        } else {
            addAssistantMessageToDOM(msg);
        }
    });

    renderHistoryUI();
}

function deleteSession(sessionId) {
    state.sessions = state.sessions.filter(s => s.id !== sessionId);

    if (state.currentSessionId === sessionId) {
        startNewChatSession();
    } else {
        renderHistoryUI();
    }
}

async function sendMessage() {
    const text = elements.chatInput.value.trim();
    if (!text || state.isProcessing) return;

    if (!state.currentSessionId) {
        const newSession = {
            id: 'session-' + Date.now(),
            title: text.length > 30 ? text.substring(0, 30) + '...' : text,
            messages: []
        };
        state.sessions.unshift(newSession);
        state.currentSessionId = newSession.id;
    }

    const currentSession = state.sessions.find(s => s.id === state.currentSessionId);
    elements.welcomeScreen.style.display = 'none';

    currentSession.messages.push({ role: "user", content: text });
    addUserMessageToDOM(text);
    
    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';

    renderHistoryUI();

    state.isProcessing = true;
    showTypingIndicator();

    try {
        let responseData;
        if (API_CONFIG.USE_MOCK) {
            await new Promise(resolve => setTimeout(resolve, 1200));
            responseData = getMockResponse(text);
        } else {
            responseData = await sendToBackend(text);
        }

        removeTypingIndicator();

        const assistantMsgObj = { role: "assistant", ...responseData };
        currentSession.messages.push(assistantMsgObj);
        addAssistantMessageToDOM(responseData);

    } catch (error) {
        console.error("Backend Error:", error);
        removeTypingIndicator();

        const errorObj = {
            role: "assistant",
            answer: "Terjadi kesalahan saat menghubungkan ke server RAG OJK backend.",
            sources: []
        };
        currentSession.messages.push(errorObj);
        addAssistantMessageToDOM(errorObj);
    } finally {
        state.isProcessing = false;
    }
}

function addUserMessageToDOM(text) {
    const messageRow = document.createElement('div');
    messageRow.className = 'message-row user';
    messageRow.innerHTML = `
        <div class="message-content-wrapper">
            <div class="message-bubble"><p>${escapeHtml(text)}</p></div>
        </div>
    `;
    elements.messagesList.appendChild(messageRow);
    scrollToBottom();
}

function addAssistantMessageToDOM(data) {
    const messageId = 'msg-' + Date.now() + Math.random().toString(36).substring(2, 5);
    const messageRow = document.createElement('div');
    messageRow.className = 'message-row assistant';
    
    const formattedText = formatAssistantText(data.answer);

    let sourcesHTML = '';
    if (data.sources && data.sources.length > 0) {
        const primarySource = data.sources[0];
        const pdfUrl = primarySource.url || primarySource.pdf_path || `#`;

        sourcesHTML = `
            <div class="rag-sources-container">
                <div class="rag-sources-title">
                    <i data-lucide="book-open" style="width:14px;"></i> Kutipan Regulasi Terkait
                </div>
                <div class="source-card">
                    <div class="source-info">
                        <h5>📄 ${escapeHtml(primarySource.document || 'Peraturan OJK')}</h5>
                        <p>${escapeHtml(primarySource.title || 'Regulasi Sektor Jasa Keuangan')}</p>
                        <p>Otoritas Jasa Keuangan RI • Halaman/Pasal ${primarySource.page}</p>
                    </div>
                    <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="view-source-btn" title="Buka Dokumen PDF POJK">
                        <span>Lihat Dokumen</span>
                        <i data-lucide="external-link" style="width:14px;"></i>
                    </a>
                </div>

                <button class="toggle-retrieval-btn" onclick="toggleRetrievalDetails('${messageId}')">
                    <i data-lucide="layers" style="width:12px;"></i> Tampilkan Detail Vector Retrieval (FAISS)
                </button>

                <div class="retrieval-details-panel" id="retrieval-${messageId}">
                    <strong>Hasil Vector Retrieval RAG (FAISS):</strong>
                    ${data.sources.map((src, index) => {
                        const itemUrl = src.url || src.pdf_path || '#';
                        return `
                        <div class="retrieval-item" style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                            <div>
                                <div><strong>Hasil #${index + 1}</strong> — Score Kemiripan: <code>${src.score}</code></div>
                                <div>Sumber: <em>${escapeHtml(src.document)}</em> (Hal/Pasal ${src.page})</div>
                            </div>
                            ${src.url || src.pdf_path ? `
                                <a href="${itemUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--primary); font-size:0.75rem; font-weight:600; text-decoration:none;">
                                    [Buka Hal. ${src.page}]
                                </a>
                            ` : ''}
                        </div>
                    `}).join('')}
                </div>
            </div>
        `;
    }

    messageRow.innerHTML = `
        <div class="message-avatar">🏛️</div>
        <div class="message-content-wrapper">
            <div class="message-sender">OJK Regulatory Assistant</div>
            <div class="message-bubble">
                ${formattedText}
                ${sourcesHTML}
            </div>
        </div>
    `;

    elements.messagesList.appendChild(messageRow);
    if (window.lucide) lucide.createIcons();
    scrollToBottom();
}

// ============================================================
// INDIKATOR LOADING GEMINI
// ============================================================
function showTypingIndicator() {
    const typingRow = document.createElement('div');
    typingRow.className = 'message-row assistant';
    typingRow.id = 'typingIndicator';

    typingRow.innerHTML = `
        <div class="message-avatar">🏛️</div>
        <div class="message-content-wrapper">
            <div class="message-sender">OJK Regulatory Assistant</div>

            <div class="message-bubble">
                <div class="typing-text">
                    <span>Sedang menganalisis regulasi</span>
                    <span class="typing-dots">...</span>
                </div>
            </div>
        </div>
    `;

    elements.messagesList.appendChild(typingRow);
    scrollToBottom();
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function toggleRetrievalDetails(id) {
    const panel = document.getElementById(`retrieval-${id}`);
    if (panel) panel.classList.toggle('show');
}

async function sendToBackend(question) {
    const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.CHAT_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question, top_k: parseInt(state.settings.topK) })
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
}

// ============================================================
// FORMAT JAWABAN GEMINI: MARKDOWN → HTML
// ============================================================
function formatAssistantText(text) {
    if (!text) return '';

    // Jika Gemini sudah mengembalikan HTML, gunakan langsung
    if (text.includes('<p>') || text.includes('<h3>') || text.includes('<ul>')) {
        return text;
    }

    let formatted = escapeHtml(text);

    // Bold: **teks** → <strong>teks</strong>
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic: *teks* → <em>teks</em>
    formatted = formatted.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

    // Heading: ### Judul → <h3>Judul</h3>
    formatted = formatted.replace(/^### (.*?)$/gm, '<h3>$1</h3>');

    // Heading: ## Judul → <h3>Judul</h3>
    formatted = formatted.replace(/^## (.*?)$/gm, '<h3>$1</h3>');

    // Bullet point: - teks atau * teks
    formatted = formatted.replace(/^[*-]\s+(.*?)$/gm, '<li>$1</li>');

    // Gabungkan bullet yang berurutan menjadi <ul>
    formatted = formatted.replace(
        /(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs,
        '<ul>$1</ul>'
    );

    // Baris baru
    formatted = formatted.replace(/\n/g, '<br>');

    return `<p>${formatted}</p>`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

function scrollToBottom() {
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// Mock Response untuk pengujian UI tanpa backend
function getMockResponse(query) {
    return {
        answer: `<h3>Analisis Ketentuan Regulasi Otoritas Jasa Keuangan (OJK)</h3>
<p>Berdasarkan ketentuan resmi peraturan OJK yang berlaku, berikut ringkasan regulasi terkait kueri Anda:</p>
<ul>
    <li><strong>Kewajiban Pemenuhan:</strong> Setiap Pelaku Jasa Keuangan (PJK) wajib menerapkan prinsip kehati-hatian serta prinsip perlindungan konsumen dan masyarakat.</li>
    <li><strong>Kepatuhan Operasional:</strong> Laporan berkala harus disampaikan kepada OJK secara elektronik melalui sistem pelaporan terintegrasi.</li>
</ul>`,
        sources: [
            {
                document: "POJK_No_6_POJK07_2022.pdf",
                title: "POJK Nomor 6/POJK.07/2022 tentang Perlindungan Konsumen dan Masyarakat",
                page: 14,
                score: 0.8921,
                url: "https://www.ojk.go.id"
            },
            {
                document: "POJK_No_12_POJK03_2021.pdf",
                title: "POJK Nomor 12/POJK.03/2021 tentang Konsolidasi Bank Umum",
                page: 28,
                score: 0.8340,
                url: "https://www.ojk.go.id"
            }
        ]
    };
}