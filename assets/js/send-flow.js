import { state } from './state.js';
import { createConversation } from './api-client.js';

function mergeDocsById(existingDocs, newDocs) {
    const byId = new Map();
    for (const doc of existingDocs) byId.set(doc.id, doc);
    for (const doc of newDocs) byId.set(doc.id, doc);
    return [...byId.values()];
}

export async function ensureConversationForGeneration({
    firstMessage = '',
    fetchConversations,
    onConversationActivated,
}) {
    if (state.currentConversationId !== 0) {
        return state.currentConversationId;
    }

    try {
        const conversation = await createConversation({
            agentId: state.currentAgentId,
            title: firstMessage,
        });
        await fetchConversations?.();
        if (state.currentConversationId === 0 || state.currentConversationId === conversation.id) {
            state.currentConversationId = conversation.id;
            onConversationActivated?.(conversation.id);
        }
        return conversation.id;
    } catch (err) {
        console.error('[FCC] ensureConversationForGeneration:', err);
        return null;
    }
}

export async function preparePendingFilesForGeneration({
    conversationId,
    elMessages,
    docs,
    scrollToBottom,
    isViewingConversation,
    onEnsureConversation,
}) {
    const resolvedConversationId = conversationId ?? await onEnsureConversation?.();
    if (resolvedConversationId == null) {
        return { status: 'failed', conversationId: null, uploadedDocs: [], isViewingConversation: false };
    }

    const viewingConversation = !!isViewingConversation?.(resolvedConversationId);
    if (!state.pendingFiles.length) {
        return {
            status: 'ready',
            conversationId: resolvedConversationId,
            uploadedDocs: [],
            isViewingConversation: viewingConversation,
        };
    }

    const filesToUpload = [...state.pendingFiles];
    docs.clearPendingFiles();

    const uploadedDocs = [];
    for (const file of filesToUpload) {
        const showUploadProgress = !!isViewingConversation?.(resolvedConversationId);
        const loaderEl = showUploadProgress ? docs.createDocLoader(file.name) : null;
        if (loaderEl) {
            elMessages.appendChild(loaderEl);
            scrollToBottom?.(true);
        }

        const result = await docs.uploadOneFile(file, resolvedConversationId, { shouldReportError: showUploadProgress });
        if (result?.documentId) {
            const allDocs = await docs.fetchDocumentsRaw(resolvedConversationId);
            const fullDoc = allDocs.find((doc) => doc.id === result.documentId);
            if (fullDoc) {
                if (loaderEl && showUploadProgress) {
                    loaderEl.replaceWith(docs.createDocCard(fullDoc));
                } else {
                    loaderEl?.remove();
                }
                uploadedDocs.push(fullDoc);
            } else {
                loaderEl?.remove();
            }
        } else {
            loaderEl?.remove();
        }

        if (showUploadProgress) {
            scrollToBottom?.(true);
        }
    }

    if (uploadedDocs.length && viewingConversation) {
        docs.updateDocsPanel(mergeDocsById(docs.getCurrentDocs(), uploadedDocs));
        docs.openPanel();
    }

    if (uploadedDocs.length && viewingConversation) {
        return {
            status: 'deferred',
            conversationId: resolvedConversationId,
            uploadedDocs,
            isViewingConversation: true,
        };
    }

    return {
        status: 'ready',
        conversationId: resolvedConversationId,
        uploadedDocs,
        isViewingConversation: viewingConversation,
    };
}
