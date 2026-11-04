package com.mockinterviewer.assistant;

import com.mockinterviewer.ai.AiProvider;
import com.mockinterviewer.ai.AiProvider.Chat;
import com.mockinterviewer.ai.AiProvider.ChatStep;
import com.mockinterviewer.ai.AiProvider.Effort;
import com.mockinterviewer.ai.AiProvider.ToolCall;
import com.mockinterviewer.ai.AiProvider.ToolOutcome;
import com.mockinterviewer.assistant.AssistantTools.ToolResult;
import com.mockinterviewer.common.AiResponseException;
import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Nikolai, the in-app assistant: a chat with the configured {@link AiProvider} that can act through
 * {@link AssistantTools} (the same tools the MCP server exposes). Conversations live in memory, keyed by id, and are
 * append-only: each provider {@link Chat} stores responses as returned (for Claude, thinking blocks included) and
 * replays them unchanged on the next call.
 */
@Service
public class NikolaiService {

    private static final int MAX_TOOL_ROUNDS = 8;
    private static final int MAX_CONVERSATIONS = 100;
    private static final Duration CONVERSATION_TTL = Duration.ofHours(6);

    static final String SYSTEM = """
            You are Nikolai, the friendly assistant inside "Interview Me", an app for practising job interviews \
            with AI interviewers. You are a Russian career coach: warm, encouraging and a little theatrical, with \
            dry humour and big-hearted confidence in the candidate. You speak English with a Russian flavour: \
            the occasional Russian word whose meaning is clear from context ("da", "nu", "khorosho", "molodets", \
            "davai"), now and then a Russian proverb or saying when it truly fits. Keep it light; never a \
            caricature, and never at the expense of being clear and useful.

            Your replies are read aloud by a voice, so write the way you would speak: plain sentences, no \
            markdown, no headings, no bullet lists, no emoji, no URLs. Usually one to three short sentences; \
            longer only when the user asks for detail.

            What you can do with your tools: list and add companies, list and add interviewers to a company's \
            panel, list interviews, list and read the resumes used in past interviews, and start a mock interview. The app also has a dashboard of past interviews \
            with reports, and an "Ask AI" button on every answer in a report for a better answer and what to \
            study.

            The chat window has already greeted the user with your name, so do not introduce yourself again. \
            Do not list or advertise what you can do unless the user asks; just help with what they ask for.

            How to act:
            - Look things up with the list tools instead of guessing ids or names.
            - When asked to add a well-known company with few details, fill in a sensible industry, description \
            and interview focus from what you know, then say briefly what you filled in. For interviewers, \
            invent a realistic persona suited to the company when details are missing.
            - Before starting an interview, confirm in one sentence: the company, one-on-one or panel, any round \
            or focus topics, and which resume will be used (the tool reuses the one from the last interview \
            unless the user attached a new one). Start once they agree, or straight away if they clearly asked \
            you to start with everything specified. Starting takes up to a minute while the questions are \
            planned; when it succeeds, tell them the room is opening and wish them luck.
            - A panel needs at least two interviewers at the company; if there are too few, offer to add some.
            - If a tool fails, explain the problem simply and suggest the fix.

            The user's messages may come from speech recognition, so forgive odd words and homophones.""";

    /** A link the chat window shows under Nikolai's reply. */
    public record Link(String label, String to) {
    }

    /** Nikolai's reply; {@code navigateTo} asks the app to open a page (the room of a newly started interview). */
    public record ChatReply(String conversationId, String reply, List<Link> links, String navigateTo,
            List<String> toolsUsed) {
    }

    private static final class Conversation {
        final Chat chat;
        ResumeUpload resume;
        Instant lastUsed = Instant.now();

        Conversation(Chat chat) {
            this.chat = chat;
        }
    }

    private final AiProvider provider;
    private final AssistantTools tools;
    private final List<AiProvider.Tool> toolParams;
    private final Map<String, Conversation> conversations = new ConcurrentHashMap<>();

    public NikolaiService(AiProvider provider, AssistantTools tools) {
        this.provider = provider;
        this.tools = tools;
        this.toolParams = tools.definitions().stream()
                .map(def -> new AiProvider.Tool(def.name(), def.description(), def.inputSchema()))
                .toList();
    }

    /**
     * Sends the user's message (and optional newly attached resume) and runs the model's tool calls until it replies.
     * A blank or unknown {@code conversationId} starts a new conversation.
     */
    public ChatReply chat(String conversationId, String text, ResumeUpload attachment) {
        evictStale();
        String id = conversationId == null || !conversations.containsKey(conversationId)
                ? UUID.randomUUID().toString() : conversationId;
        Conversation conversation = conversations.computeIfAbsent(id,
                k -> new Conversation(provider.newChat(SYSTEM, toolParams)));

        synchronized (conversation) {
            conversation.lastUsed = Instant.now();
            String userText = text == null || text.isBlank() ? "(no message)" : text.strip();
            if (attachment != null) {
                conversation.resume = attachment;
                userText += "\n\n[The user attached a resume: " + attachment.fileName()
                        + ". start_interview will use it instead of the last interview's resume.]";
            }
            int rollbackTo = conversation.chat.checkpoint();
            conversation.chat.addUserMessage(userText);

            List<Link> links = new ArrayList<>();
            List<String> used = new ArrayList<>();
            String navigateTo = null;
            try {
                for (int round = 0; round < MAX_TOOL_ROUNDS; round++) {
                    ChatStep step = conversation.chat.send(Effort.TURN);
                    if (step.refused()) {
                        return new ChatReply(id, "Izvini, my friend, I cannot help with that one. Let us talk "
                                + "about your interviews instead.", links, navigateTo, used);
                    }
                    if (!step.wantsTools()) {
                        return new ChatReply(id, step.text().isEmpty() ? "Da, done." : step.text(), links,
                                navigateTo, used);
                    }

                    // Run every tool call in this response and return all results together.
                    List<ToolOutcome> results = new ArrayList<>();
                    for (ToolCall call : step.toolCalls()) {
                        ToolResult result = tools.call(call.name(), call.arguments(), conversation.resume);
                        used.add(call.name());
                        if (!result.error() && result.navigateTo() != null) {
                            links.add(new Link(result.linkLabel(), result.navigateTo()));
                            if ("start_interview".equals(call.name())) {
                                navigateTo = result.navigateTo();
                            }
                        }
                        results.add(new ToolOutcome(call.id(), result.text(), result.error()));
                    }
                    conversation.chat.addToolResults(results);
                }
                throw new AiResponseException("Nikolai got stuck in a loop of actions. Please try again.");
            } catch (RuntimeException e) {
                // Keep the history valid (and append-only from the model's point of view) by dropping this turn.
                conversation.chat.rollback(rollbackTo);
                throw e;
            }
        }
    }

    /** Forgets a conversation (the chat's "New chat"); unknown ids are ignored. */
    public void forget(String conversationId) {
        if (conversationId != null) {
            conversations.remove(conversationId);
        }
    }

    private void evictStale() {
        Instant cutoff = Instant.now().minus(CONVERSATION_TTL);
        conversations.entrySet().removeIf(e -> e.getValue().lastUsed.isBefore(cutoff));
        if (conversations.size() >= MAX_CONVERSATIONS) {
            conversations.entrySet().stream()
                    .min((x, y) -> x.getValue().lastUsed.compareTo(y.getValue().lastUsed))
                    .ifPresent(oldest -> conversations.remove(oldest.getKey()));
        }
    }
}
