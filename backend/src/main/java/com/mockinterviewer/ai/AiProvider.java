package com.mockinterviewer.ai;

import java.util.List;
import java.util.Map;

/**
 * The AI provider behind interviews and Nikolai. One implementation per vendor ({@code ai.anthropic},
 * {@code ai.openai}); {@code config.AiProviderConfig} creates the one selected by {@code app.ai.provider}.
 * Implementations throw {@link com.mockinterviewer.common.AiResponseException} for refusals, truncated or
 * unusable output, and let their SDK's exceptions through for transport/auth/rate-limit failures
 * ({@code common.ApiExceptionHandler} maps both vendors').
 */
public interface AiProvider {

    /** Display name for logs and error messages, e.g. "Claude". */
    String displayName();

    /** The environment variable that holds the API key, for error messages. */
    String apiKeyVariable();

    /**
     * A single stateless request whose answer is the JSON shape of {@code type} (a record in {@link AiOutputs}).
     *
     * @param label  what the call is for, for logs (e.g. "TurnDecision for interview 12")
     */
    <T> T structured(Class<T> type, Effort effort, String system, List<Content> content, String label);

    /** Starts an in-memory, tool-using chat (Nikolai). The chat keeps its history in the provider's own format. */
    Chat newChat(String system, List<Tool> tools);

    /** Which configured effort to use: per-answer calls are latency sensitive, the rest favour quality. */
    enum Effort {
        TURN,
        FINAL
    }

    /** One part of the user message, in order. */
    sealed interface Content {
    }

    /**
     * Plain text. {@code cacheBreakpoint} marks the end of the stable prefix (providers with explicit prompt
     * caching cache everything up to here; others cache prefixes automatically and ignore it).
     */
    record Text(String text, boolean cacheBreakpoint) implements Content {
        public Text(String text) {
            this(text, false);
        }
    }

    /** A document: a PDF ({@code pdf}) or UTF-8 text. */
    record Document(String title, byte[] data, boolean pdf) implements Content {
    }

    /** A PNG image. */
    record Image(byte[] png) implements Content {
    }

    /** A tool the chat model may call; {@code inputSchema} is a JSON Schema object. */
    record Tool(String name, String description, Map<String, Object> inputSchema) {
    }

    /** A tool call the model made; {@code arguments} is the parsed JSON input. */
    record ToolCall(String id, String name, Map<String, Object> arguments) {
    }

    /** The result of running a tool call, sent back to the model. */
    record ToolOutcome(String toolCallId, String text, boolean error) {
    }

    /**
     * One model response in a chat: either tool calls to run (then {@link Chat#addToolResults} and send again) or
     * the final reply text. {@code refused} means the model declined.
     */
    record ChatStep(String text, List<ToolCall> toolCalls, boolean refused) {
        public boolean wantsTools() {
            return !toolCalls.isEmpty();
        }
    }

    /** A tool-using conversation. Not thread-safe: callers synchronise. */
    interface Chat {

        void addUserMessage(String text);

        void addToolResults(List<ToolOutcome> results);

        /** Sends the history so far and appends the model's response to it. */
        ChatStep send(Effort effort);

        /** The current history length, for {@link #rollback}. */
        int checkpoint();

        /** Drops everything added after {@code checkpoint}, keeping the history valid after a failed turn. */
        void rollback(int checkpoint);
    }
}
