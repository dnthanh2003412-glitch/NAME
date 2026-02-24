const CHAT_API_BASE = window.location.origin;

class ChatPreviewWidget {
    constructor() {
        this.enabled = false;
        this.history = [];
        this.sending = false;
        this.elements = {};
    }

    async init() {
        const config = await this.fetchConfig();
        if (!config?.enabled) {
            return;
        }

        this.enabled = true;
        this.render();
        this.bindEvents();
    }

    async fetchConfig() {
        try {
            const response = await fetch(`${CHAT_API_BASE}/api/chat/config`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) return { enabled: false };
            return await response.json();
        } catch {
            return { enabled: false };
        }
    }

    render() {
        const root = document.createElement('div');
        root.className = 'chatbot-root';
        root.innerHTML = `
            <button id="chatbot-toggle" class="chatbot-toggle" aria-label="Mở chatbot">
                AI
            </button>
            <section id="chatbot-panel" class="chatbot-panel" aria-hidden="true">
                <header class="chatbot-header">
                    <strong>Trợ lý AI</strong>
                    <div class="chatbot-header-actions">
                        <button id="chatbot-new" class="chatbot-action-btn" aria-label="Cuộc trò chuyện mới">Mới</button>
                        <button id="chatbot-clear" class="chatbot-action-btn" aria-label="Xóa cuộc trò chuyện">Xóa</button>
                        <button id="chatbot-close" class="chatbot-close" aria-label="Đóng chatbot">x</button>
                    </div>
                </header>
                <div id="chatbot-messages" class="chatbot-messages">
                    ${this.getWelcomeMessageHtml()}
                </div>
                <form id="chatbot-form" class="chatbot-form">
                    <input id="chatbot-input" type="text" maxlength="1500" placeholder="Nhập câu hỏi..." autocomplete="off" />
                    <button id="chatbot-send" type="submit">Gửi</button>
                </form>
            </section>
        `;

        document.body.appendChild(root);
        this.elements = {
            root,
            toggle: root.querySelector('#chatbot-toggle'),
            panel: root.querySelector('#chatbot-panel'),
            close: root.querySelector('#chatbot-close'),
            newChat: root.querySelector('#chatbot-new'),
            clear: root.querySelector('#chatbot-clear'),
            form: root.querySelector('#chatbot-form'),
            input: root.querySelector('#chatbot-input'),
            send: root.querySelector('#chatbot-send'),
            messages: root.querySelector('#chatbot-messages')
        };
    }

    getWelcomeMessageHtml() {
        return `
            <div class="chatbot-msg bot">
                Chào bạn. Đây là bản preview chatbot. Bạn có thể hỏi về báo cáo, sync, cache.
            </div>
        `;
    }

    startNewChat() {
        this.history = [];
        this.elements.messages.innerHTML = this.getWelcomeMessageHtml();
        this.elements.input.value = '';
        this.elements.input.focus();
    }

    bindEvents() {
        this.elements.toggle.addEventListener('click', () => this.openPanel());
        this.elements.close.addEventListener('click', () => this.closePanel());
        this.elements.newChat.addEventListener('click', () => this.startNewChat());
        this.elements.clear.addEventListener('click', () => this.startNewChat());
        this.elements.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.sendMessage();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.elements.panel.classList.contains('open')) {
                this.closePanel();
            }
        });
    }

    openPanel() {
        this.elements.panel.classList.add('open');
        this.elements.panel.setAttribute('aria-hidden', 'false');
        this.elements.input.focus();
    }

    closePanel() {
        this.elements.panel.classList.remove('open');
        this.elements.panel.setAttribute('aria-hidden', 'true');
    }

    appendMessage(role, text) {
        const msg = document.createElement('div');
        msg.className = `chatbot-msg ${role === 'user' ? 'user' : 'bot'}`;
        msg.textContent = text;
        this.elements.messages.appendChild(msg);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    getContext() {
        const reportSelect = document.getElementById('report-type-select');
        const selectedCount = document.getElementById('selected-count');
        const reportTitle = document.getElementById('report-title');
        const selectedDatabaseIds = window.app?.selectedDatabases
            ? Array.from(window.app.selectedDatabases)
            : [];

        return {
            report_type: reportSelect?.value || '',
            selected_count: selectedCount?.textContent?.trim() || '',
            page_title: reportTitle?.textContent?.trim() || 'Dashboard',
            sync_source: window.app?.latestSyncEvent?.type || '',
            selected_database_ids: selectedDatabaseIds
        };
    }

    async sendMessage() {
        const message = this.elements.input.value.trim();
        if (!message || this.sending) {
            return;
        }

        this.sending = true;
        this.elements.send.disabled = true;
        this.elements.input.value = '';

        this.appendMessage('user', message);
        const pending = document.createElement('div');
        pending.className = 'chatbot-msg bot pending';
        pending.textContent = 'Đang xử lý...';
        this.elements.messages.appendChild(pending);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;

        try {
            const response = await fetch(`${CHAT_API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    context: this.getContext(),
                    history: this.history.slice(-8)
                }),
                signal: AbortSignal.timeout(30000)
            });

            const payload = await response.json();
            pending.remove();

            if (!response.ok || !payload?.success) {
                const errorText = payload?.error || `Yêu cầu lỗi (${response.status})`;
                this.appendMessage('bot', errorText);
                return;
            }

            const reply = String(payload.reply || '').trim() || 'Không có nội dung trả lời.';
            this.appendMessage('bot', reply);

            this.history.push({ role: 'user', content: message });
            this.history.push({ role: 'assistant', content: reply });
            this.history = this.history.slice(-16);
        } catch (error) {
            pending.remove();
            this.appendMessage('bot', `Không gọi được chatbot: ${error.message}`);
        } finally {
            this.sending = false;
            this.elements.send.disabled = false;
            this.elements.input.focus();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const widget = new ChatPreviewWidget();
    widget.init();
});
