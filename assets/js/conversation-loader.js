import { state } from './state.js';

export async function loadConversationTimeline({
    conversationId,
    conversation,
    apiFetch,
    docs,
    messaging,
    elMessages,
    elWelcome,
    updateWorkflowUI,
    updateSendBtn,
    scrollToBottom,
}) {
    const [messages, docList] = await Promise.all([
        apiFetch('/api/conversations/' + conversationId + '/messages').then((response) => response.json()),
        docs.fetchDocumentsRaw(conversationId),
    ]);

    docs.updateDocsPanel(docList);

    const timeline = [
        ...messages.map((message) => ({ type: 'message', ts: new Date(message.created_at), data: message })),
        ...docList.map((doc) => ({ type: 'doc', ts: new Date(doc.uploaded_at), data: doc })),
    ].sort((a, b) => a.ts - b.ts);

    state.workflowDone = timeline.some((item) => item.type === 'message');
    if (!state.workflowDone && conversation?.workflow_step != null) {
        state.workflowStep = conversation.workflow_step;
        state.workflowAnswers = conversation.workflow_answers || {};
    }
    updateWorkflowUI?.();

    if (timeline.length && elWelcome) {
        elWelcome.style.display = 'none';
    }

    for (const item of timeline) {
        if (item.type === 'doc') {
            elMessages?.appendChild(docs.createDocCard(item.data));
            continue;
        }

        const bubbleEl = await messaging.renderMessage(item.data.role, item.data.content);
        if (item.data.is_partial && bubbleEl) {
            bubbleEl.classList.add('symbiose-msg__bubble--partial');
            const badge = document.createElement('div');
            badge.className = 'symbiose-partial-badge';
            badge.textContent = 'Réponse partielle — la génération a été interrompue';
            bubbleEl.appendChild(badge);
        }
    }

    const activeStream = messaging.getActiveStream(conversationId);
    if (activeStream && !activeStream.hasError) {
        if (elMessages && activeStream.wrapperEl) {
            elMessages.appendChild(activeStream.wrapperEl);
        }
        state.isStreaming = true;
        messaging.setStreamingButtons(true);
        updateSendBtn?.();
    }

    if (!activeStream && conversation?.streaming_status === 'generating') {
        state.isStreaming = true;
        messaging.setStreamingButtons(true);
        updateSendBtn?.();

        const joined = await messaging.rejoinStream(conversationId);
        if (!joined) {
            state.isStreaming = false;
            messaging.setStreamingButtons(false);
            updateSendBtn?.();

            if (elMessages) {
                const notice = document.createElement('div');
                notice.className = 'symbiose-recovery-notice';
                notice.innerHTML =
                    '<p>La génération a été interrompue (rechargement de page).</p>'
                    + '<button class="symbiose-wf-nav-btn symbiose-wf-nav-btn--primary symbiose-recovery-retry">Relancer</button>';
                notice.querySelector('.symbiose-recovery-retry').addEventListener('click', () => {
                    notice.remove();
                    apiFetch('/api/conversations/' + conversationId, {
                        method: 'PATCH',
                        body: JSON.stringify({ title: conversation?.title || 'Conversation' })
                    }).catch(() => {});
                    if (conversation) {
                        conversation.streaming_status = null;
                    }
                });
                elMessages.appendChild(notice);
            }
        }
    } else if (!activeStream && conversation?.streaming_status === 'uploading' && elMessages) {
        const notice = document.createElement('div');
        notice.className = 'symbiose-recovery-notice';
        notice.innerHTML = '<p>Un upload de documents était en cours. Les documents ci-dessus ont déjà été traités.</p>';
        elMessages.appendChild(notice);
    }

    scrollToBottom?.(true);
}
